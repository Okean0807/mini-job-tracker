/**
 * Data-safety Phase 4: der EINE Ablauf für jede zerstörerische Datenoperation
 * (Cloud-Backup/-Überschreiben, Cloud-Wiederherstellung, JSON-Import, Konfliktentscheidung,
 * Snapshot-Wiederherstellung).
 *
 * Reihenfolge (jede Pflichtstufe bricht bei Fehlschlag OHNE Änderung ab):
 *  1 Sperre je Scope · 2 Konto/Scope-Epoche festhalten · 3 lokalen Stand lesen ·
 *  4 Cloud inspizieren bzw. Datei einlesen · 5 Nutzlast prüfen · 6 Manifest, Diff, Integrität ·
 *  7 lokalen Fingerprint und Remote-Token/Datei-Hash festhalten · 8 Vergleich zeigen und
 *  ausdrücklich bestätigen lassen · 9 Snapshot der VERLIERENDEN Seite · 10 Snapshot erneut
 *  verifizieren · 11 Konto/Scope/lokalen Fingerprint erneut prüfen · 12 Remote-Token erneut
 *  prüfen · 13 erst jetzt committen (synchron nach der letzten Prüfung).
 *
 * Das Modul kennt weder Store noch Supabase: alles Äußere kommt über `GuardedPorts` bzw. die
 * Operation (so ist jede Stufe einzeln testbar). Es wirft nicht – das Ergebnis nennt den Grund.
 */
import {
  buildManifest,
  COLLECTION_NAMES,
  diffBackups,
  fullFingerprint,
  validateIntegrity,
  type BackupLike,
  type CollectionName,
  type IntegrityIssue,
} from "./backup-compare";
import type { SnapshotKind, SnapshotSummary } from "./backup-safety";
import { isValidPayload } from "./payload";
import type { AppData } from "./types";

export type GuardedOperationKind =
  | "cloud-backup"
  | "cloud-restore"
  | "conflict-keep-local"
  | "conflict-keep-cloud"
  | "local-import"
  | "snapshot-restore";

export type AbortReason =
  | "lock-busy"
  | "scope-changed"
  | "local-changed"
  | "remote-changed"
  | "invalid-payload"
  | "prepare-failed"
  | "remote-missing"
  | "snapshot-failed"
  | "verification-failed"
  | "commit-failed";

/* ------------------------------------------------------------------ Vorschau */

export interface ManifestSummary {
  counts: Record<CollectionName, number>;
  totalRecords: number;
  shiftDateRange: { earliest: string; latest: string } | null;
}

export interface CollectionPreview {
  name: CollectionName;
  /** Nur auf der verlierenden Seite → gehen verloren. */
  lost: number;
  /** Nur auf der eingehenden Seite → kommen hinzu. */
  added: number;
  changed: number;
  same: number;
}

export interface GuardedPreview {
  kind: GuardedOperationKind;
  /** Welche Seite ersetzt wird. */
  replaces: "local" | "cloud";
  /** Die Seite, die überschrieben wird (leer, wenn es sie nicht gibt). */
  current: ManifestSummary;
  incoming: ManifestSummary;
  collections: CollectionPreview[];
  /** Nur Schlüsselnamen der abweichenden Einstellungen, nie Werte. */
  settingsChangedKeys: string[];
  integrity: Pick<IntegrityIssue, "code" | "collection">[];
  identical: boolean;
  snapshot: { kind: SnapshotKind; required: boolean };
  /**
   * Gerätesperre (PIN/Biometrie): `kept` = die lokale bleibt unverändert; `adopted` = ein ALTER
   * Cloud-Stand enthält noch eine Klartext-PIN und dieses Gerät hat keine: sie würde hier gesetzt
   * (Alt-Migration). Wird dem Nutzer vor der Bestätigung angezeigt.
   */
  deviceAuth: "kept" | "adopted";
}

function summarize(data: BackupLike | null): ManifestSummary {
  const m = buildManifest(data);
  return { counts: m.counts, totalRecords: m.totalRecords, shiftDateRange: m.shiftDateRange };
}

export function buildPreview(
  kind: GuardedOperationKind,
  replaces: "local" | "cloud",
  losing: AppData | null,
  incoming: AppData,
  snapshotKind: SnapshotKind,
  deviceAuth: "kept" | "adopted" = "kept",
): GuardedPreview {
  const diff = diffBackups(losing as BackupLike | null, incoming as unknown as BackupLike);
  const identical = losing !== null && diff.identical;
  return {
    kind,
    replaces,
    current: summarize(losing as BackupLike | null),
    incoming: summarize(incoming as unknown as BackupLike),
    collections: COLLECTION_NAMES.map((name) => {
      const c = diff.collections[name];
      return {
        name,
        lost: c.onlyLocal.length,
        added: c.onlyOther.length,
        changed: c.changed.length,
        same: c.unchangedCount,
      };
    }),
    settingsChangedKeys: diff.settings.changedKeys,
    integrity: validateIntegrity(incoming as unknown as BackupLike).map((i) => ({
      code: i.code,
      collection: i.collection,
    })),
    identical,
    snapshot: { kind: snapshotKind, required: losing !== null && !identical },
    deviceAuth,
  };
}

/* ------------------------------------------------------------------- Sperre */

const held = new Set<string>();

type LockManagerLike = {
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<void> | undefined,
  ): Promise<unknown>;
};

/**
 * Sperre je Scope: im Tab immer, zusätzlich tab-übergreifend über die Web Locks API, wo es sie
 * gibt. `null` = belegt (andere Operation läuft).
 */
export async function acquireScopeLock(scopeKey: string): Promise<(() => void) | null> {
  if (held.has(scopeKey)) return null;
  held.add(scopeKey);
  const manager = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
  let releaseWeb: (() => void) | null = null;
  if (manager?.request) {
    const hold = new Promise<void>((resolve) => {
      releaseWeb = resolve;
    });
    let acquired: boolean;
    try {
      acquired = await new Promise<boolean>((resolve, reject) => {
        manager
          .request(`minijob-guarded:${scopeKey}`, { ifAvailable: true }, (lock) => {
            if (!lock) {
              resolve(false);
              return undefined;
            }
            resolve(true);
            return hold;
          })
          .catch(reject);
      });
    } catch {
      acquired = true; // Web Locks nicht nutzbar: Sperre im Tab genügt
      releaseWeb = null;
    }
    if (!acquired) {
      held.delete(scopeKey);
      return null;
    }
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    held.delete(scopeKey);
    (releaseWeb as (() => void) | null)?.();
  };
}

/* -------------------------------------------------------- Operation und Ports */

export interface ScopeGuard {
  /** `false`, sobald Konto oder Scope-Epoche gewechselt haben. */
  isCurrent(): boolean;
}

export interface GuardedPorts {
  scopeKey: string;
  captureScope(): ScopeGuard;
  readLocal(): AppData;
  confirm(preview: GuardedPreview): Promise<boolean>;
  /** Legt einen Snapshot an und verifiziert ihn (wirft bei jedem Fehler). */
  createSnapshot(kind: SnapshotKind, data: AppData): Promise<SnapshotSummary>;
  /** Liest den Snapshot erneut und prüft ihn vollständig (wirft bei jedem Fehler). */
  verifySnapshot(id: string): Promise<void>;
  acquireLock?(scopeKey: string): Promise<(() => void) | null>;
}

export interface Prepared {
  /** Stand, der den Zielort ERSETZT. */
  incoming: AppData;
  /** Stand, der dabei VERLOREN geht (`null` = es gibt nichts zu verlieren, z. B. keine Cloud-Zeile). */
  losing: AppData | null;
  snapshotKind: SnapshotKind;
  replaces: "local" | "cloud";
  /** Für Cloud-Operationen: der inspizierte Token (`null` = keine Zeile). */
  remoteToken?: string | null;
  /** Cloud-Operationen: inspizierte Serverrevision (Stage 1), falls das Schema sie hat. */
  remoteRev?: string | null;
  /** Für Dateiimporte: SHA-256 der Datei (festgehalten mit dem Vergleich). */
  sourceHash?: string;
  /** Wird eine Gerätesperre aus dem eingehenden Stand übernommen? (Standard: nein) */
  deviceAuth?: "kept" | "adopted";
}

export interface GuardedOperation {
  kind: GuardedOperationKind;
  /** Cloud inspizieren bzw. Datei einlesen; wirft bei ungültigem Material. */
  prepare(ctx: { local: AppData; scope: ScopeGuard }): Promise<Prepared>;
  /** Cloud-Operationen: Token unverändert? (zweite Prüfung vor dem Commit) */
  revalidateRemote?(prepared: Prepared): Promise<boolean>;
  /** Wird SYNCHRON nach der letzten Prüfung aufgerufen. */
  commit(prepared: Prepared, ctx: { local: AppData }): Promise<void> | void;
  /** Beide Seiten gleich: nichts ersetzen, nur ggf. Metadaten bereinigen. */
  onIdentical?(prepared: Prepared): Promise<void> | void;
}

export type GuardedResult =
  | {
      status: "done";
      preview: GuardedPreview;
      snapshot: SnapshotSummary | null;
      unchanged: boolean;
    }
  | { status: "cancelled"; preview: GuardedPreview }
  | { status: "aborted"; reason: AbortReason; error?: unknown; preview?: GuardedPreview };

/** Sprechender Abbruch aus `prepare`/`commit` (nur Ursache, keine Nutzdaten). */
export class GuardedAbort extends Error {
  readonly reason: AbortReason;
  constructor(reason: AbortReason) {
    super(reason);
    this.name = "GuardedAbort";
    this.reason = reason;
  }
}

export async function runGuardedOperation(
  op: GuardedOperation,
  ports: GuardedPorts,
): Promise<GuardedResult> {
  const release = await (ports.acquireLock ?? acquireScopeLock)(ports.scopeKey);
  if (!release) return { status: "aborted", reason: "lock-busy" };
  let preview: GuardedPreview | undefined;
  try {
    // 2–4: Epoche, lokaler Stand, Inspektion/Datei.
    const scope = ports.captureScope();
    // Die Sperre kann erst nach einem Konto-/Scope-Wechsel frei geworden sein.
    if (!scope.isCurrent()) return { status: "aborted", reason: "scope-changed" };
    const local = ports.readLocal();
    const localFingerprint = fullFingerprint(local as unknown as BackupLike);
    let prepared: Prepared;
    try {
      prepared = await op.prepare({ local, scope });
    } catch (error) {
      if (error instanceof GuardedAbort) return { status: "aborted", reason: error.reason, error };
      return { status: "aborted", reason: "prepare-failed", error };
    }
    if (!scope.isCurrent()) return { status: "aborted", reason: "scope-changed" };
    // 5: Struktur der eingehenden (und der zu sichernden) Seite.
    if (!isValidPayload(prepared.incoming)) return { status: "aborted", reason: "invalid-payload" };
    if (prepared.losing !== null && !isValidPayload(prepared.losing)) {
      return { status: "aborted", reason: "invalid-payload" };
    }
    // 6–7: Vergleich.
    preview = buildPreview(
      op.kind,
      prepared.replaces,
      prepared.losing,
      prepared.incoming,
      prepared.snapshotKind,
      prepared.deviceAuth ?? "kept",
    );
    // 8: ausdrückliche Bestätigung des angezeigten Vergleichs.
    let confirmed = false;
    try {
      confirmed = (await ports.confirm(preview)) === true;
    } catch {
      confirmed = false;
    }
    if (!confirmed) return { status: "cancelled", preview };

    // 9–10: Snapshot der verlierenden Seite, erneut verifiziert.
    let snapshot: SnapshotSummary | null = null;
    if (preview.snapshot.required && prepared.losing !== null) {
      try {
        snapshot = await ports.createSnapshot(prepared.snapshotKind, prepared.losing);
      } catch (error) {
        // Konto/Scope-Wechsel während des Snapshots ist ein stiller Abbruch, kein Snapshot-Fehler.
        const reason = scope.isCurrent() ? "snapshot-failed" : "scope-changed";
        return { status: "aborted", reason, error, preview };
      }
      try {
        await ports.verifySnapshot(snapshot.id);
      } catch (error) {
        const reason = scope.isCurrent() ? "verification-failed" : "scope-changed";
        return { status: "aborted", reason, error, preview };
      }
    }

    // 11–12: nichts darf sich seit dem bestätigten Vergleich verändert haben.
    if (!scope.isCurrent()) return { status: "aborted", reason: "scope-changed", preview };
    if (op.revalidateRemote) {
      let same = false;
      try {
        same = await op.revalidateRemote(prepared);
      } catch {
        same = false;
      }
      if (!same) {
        // Konto/Scope gewechselt während der Prüfung ist KEINE Cloud-Änderung.
        const reason = scope.isCurrent() ? "remote-changed" : "scope-changed";
        return { status: "aborted", reason, preview };
      }
    }
    if (!scope.isCurrent()) return { status: "aborted", reason: "scope-changed", preview };
    const latest = ports.readLocal();
    if (fullFingerprint(latest as unknown as BackupLike) !== localFingerprint) {
      return { status: "aborted", reason: "local-changed", preview };
    }

    // 13: Commit direkt nach der letzten (synchronen) Prüfung.
    try {
      if (preview.identical && op.onIdentical) {
        await op.onIdentical(prepared);
        return { status: "done", preview, snapshot, unchanged: true };
      }
      await op.commit(prepared, { local: latest });
    } catch (error) {
      if (error instanceof GuardedAbort) {
        return { status: "aborted", reason: error.reason, error, preview };
      }
      return { status: "aborted", reason: "commit-failed", error, preview };
    }
    return { status: "done", preview, snapshot, unchanged: false };
  } finally {
    release();
  }
}
