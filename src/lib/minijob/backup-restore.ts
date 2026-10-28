import { validateBackup, type BackupIssue } from "./backup-validate";
import { MAX_IMPORT_BYTES } from "./import-file-kind";
import { getData, getScopeGeneration, isScopeCurrent, restoreAll } from "./store";
import type { AppData } from "./types";

/**
 * Wiederherstellung einer JSON-Sicherung in zwei getrennten Schritten:
 *
 * 1. `prepareBackupFile` – Größe prüfen (vor dem Lesen), lesen, parsen, streng
 *    validieren. Ändert nie den Speicher. Liefert die Sicht für die Bestätigung.
 * 2. `applyPreparedBackup` – erst nach ausdrücklicher Bestätigung: ersetzt den
 *    Gesamtstand, merkt sich den vorherigen Stand für „Rückgängig“.
 *
 * Gemeinsam genutzt von „Daten importieren“ und „Lokales Backup → Importieren“.
 */

export const MAX_BACKUP_BYTES = MAX_IMPORT_BYTES;

export interface BackupCounts {
  shifts: number;
  jobs: number;
}

export interface PreparedBackup {
  /** Unveränderter, validierter Inhalt der Datei (Normalisierung erfolgt beim Anwenden). */
  readonly data: Partial<AppData>;
  readonly current: BackupCounts;
  readonly incoming: BackupCounts;
  /** Namensraum-Generation beim Start; wechselt das Konto, wird nichts geschrieben. */
  readonly generation: number;
}

export type PrepareResult =
  | { status: "ready"; prepared: PreparedBackup }
  | { status: "too-large" }
  | { status: "read-error" }
  | { status: "parse-error" }
  | { status: "invalid"; issues: BackupIssue[] }
  | { status: "stale" };

export type ApplyResult =
  | { status: "restored"; previous: AppData }
  | { status: "stale" }
  | { status: "persist-failed" }
  | { status: "error" };

export interface BackupSource {
  size?: number;
  text(): Promise<string>;
}

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

export function countsOf(data: Pick<AppData, "shifts" | "jobs">): BackupCounts {
  return { shifts: data.shifts.length, jobs: data.jobs.length };
}

export async function prepareBackupFile(file: BackupSource): Promise<PrepareResult> {
  const generation = getScopeGeneration();
  // Größe zuerst: eine zu große Datei wird weder gelesen noch geparst.
  if (typeof file.size === "number" && file.size > MAX_BACKUP_BYTES) {
    return { status: "too-large" };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { status: "read-error" };
  }
  if (!isScopeCurrent(generation)) return { status: "stale" };
  // Fehlt `size` (kein echtes File), zählt die tatsächliche Länge; geparst wird erst danach.
  const bytes = encoder ? encoder.encode(text).length : text.length;
  if (bytes > MAX_BACKUP_BYTES) return { status: "too-large" };

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { status: "parse-error" };
  }
  const validation = validateBackup(data);
  if (!validation.ok) return { status: "invalid", issues: validation.issues };

  const backup = data as Partial<AppData> & Pick<AppData, "shifts" | "jobs">;
  return {
    status: "ready",
    prepared: {
      data: backup,
      current: countsOf(getData()),
      incoming: countsOf(backup),
      generation,
    },
  };
}

export function applyPreparedBackup(prepared: PreparedBackup): ApplyResult {
  if (!isScopeCurrent(prepared.generation)) return { status: "stale" };
  const previous = getData();
  try {
    return restoreAll(prepared.data) === "ok"
      ? { status: "restored", previous }
      : { status: "persist-failed" };
  } catch {
    // restoreAll baut den neuen Stand vollständig auf, bevor es etwas ändert.
    return { status: "error" };
  }
}

/** Vorherigen Stand nach einer Wiederherstellung zurückholen („Rückgängig“). */
export function undoBackupRestore(previous: AppData, generation: number): ApplyResult {
  if (!isScopeCurrent(generation)) return { status: "stale" };
  const current = getData();
  try {
    return restoreAll(previous) === "ok"
      ? { status: "restored", previous: current }
      : { status: "persist-failed" };
  } catch {
    return { status: "error" };
  }
}

export function issueSummary(issues: BackupIssue[]): string {
  const first = issues[0];
  return first
    ? `${first.path} (${first.code})${issues.length > 1 ? ` +${issues.length - 1}` : ""}`
    : "";
}
