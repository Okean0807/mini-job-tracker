/**
 * Stage 1 – Beobachtbarkeit der Cloud-Abgleiche: ZÄHLER, keine Ereignisprotokolle.
 *
 * Gespeichert werden nur Anzahlen je Ereignisart und der Zeitpunkt des letzten Ereignisses, je
 * Konto-Scope (nie Nutzlast, PIN, Datensatz-Ids, Konto-Kennungen oder Fehlertexte). Die Zähler sind
 * gedeckelt und werden höchstens einmal je Ereignis geschrieben (kein Logging im Sekundentakt).
 * Sie dienen dem Support ("wie oft kollidieren Schreiber?") und der Entscheidung, wann ältere
 * Clients ausgelaufen sind – nicht der Anzeige für Nutzer.
 *
 * Ereignisarten:
 *  - `cas-stale`            : unser bedingtes Schreiben traf 0 Zeilen (parallel geändert).
 *  - `remote-advanced`      : die Cloud-Revision ist seit dem letzten Stand gestiegen, der Token
 *                             (`updated_at`) ebenfalls (üblicher Schreiber: aktueller oder alter Client).
 *  - `remote-advanced-token-flat`: Revision gestiegen, Token GLEICH oder ÄLTER. Aktuelle Clients
 *                             erhöhen den Token immer → deutet auf einen Schreiber hin, der ihn nicht
 *                             fortschreibt (älterer Client mit falscher Uhr, direkter API-Aufruf, Betrieb).
 *  - `token-regression`     : Token älter als der zuletzt gesehene (Rollback/falsche Uhr).
 *  - `rev-fallback`         : das Schema hat keine Spalte `rev` (alter Stand) → `updated_at`-CAS.
 *  - `ambiguous-write`      : Schreibergebnis unklar (Zeitüberschreitung/Netzwerk).
 */
import { scopeSuffix, type StorageScope } from "./storage-scope";

export const DIAGNOSTIC_EVENTS = [
  "cas-stale",
  "remote-advanced",
  "remote-advanced-token-flat",
  "token-regression",
  "rev-fallback",
  "ambiguous-write",
] as const;
export type DiagnosticEvent = (typeof DIAGNOSTIC_EVENTS)[number];

export interface SyncDiagnostics {
  counts: Record<DiagnosticEvent, number>;
  /** Zeitpunkt (ms) des letzten Ereignisses je Art. */
  lastAt: Partial<Record<DiagnosticEvent, number>>;
}

const KEY_BASE = "minijob-sync-diagnostics-v1";
const MAX_COUNT = 1_000_000;

export function diagnosticsKey(scope: StorageScope): string {
  return `${KEY_BASE}:${scopeSuffix(scope)}`;
}

function empty(): SyncDiagnostics {
  return {
    counts: Object.fromEntries(DIAGNOSTIC_EVENTS.map((e) => [e, 0])) as Record<
      DiagnosticEvent,
      number
    >,
    lastAt: {},
  };
}

export function readSyncDiagnostics(scope: StorageScope): SyncDiagnostics {
  const out = empty();
  try {
    const raw = globalThis.localStorage?.getItem(diagnosticsKey(scope));
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Partial<SyncDiagnostics>;
    for (const e of DIAGNOSTIC_EVENTS) {
      const n = parsed.counts?.[e];
      if (typeof n === "number" && Number.isFinite(n) && n >= 0)
        out.counts[e] = Math.min(n, MAX_COUNT);
      const t = parsed.lastAt?.[e];
      if (typeof t === "number" && Number.isFinite(t)) out.lastAt[e] = t;
    }
  } catch {
    /* unlesbar: neu beginnen */
  }
  return out;
}

/** Zählt ein Ereignis (still bei blockiertem Speicher; wirft nie). */
export function recordSyncEvent(
  scope: StorageScope,
  event: DiagnosticEvent,
  now: number = Date.now(),
): void {
  try {
    const current = readSyncDiagnostics(scope);
    current.counts[event] = Math.min(current.counts[event] + 1, MAX_COUNT);
    current.lastAt[event] = now;
    globalThis.localStorage?.setItem(diagnosticsKey(scope), JSON.stringify(current));
  } catch {
    /* Diagnose darf den Abgleich nie beeinträchtigen */
  }
}
