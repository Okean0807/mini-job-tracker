/**
 * Data-safety Phase 1: Zustand der Datensicherung (reine Funktion).
 *
 * Wichtig: Der Zustand "gesichert" wird NIE allein aus `pending === false` abgeleitet. Er verlangt
 * eine verifizierte Sicherung UND "nicht schmutzig" (`dirty`), wobei `dirty` aus den
 * Änderungsmarken stammt (unabhängig von Auto-Backup) – siehe `computeDirty`. Keine
 * Premium-Abhängigkeit: Datensicherung ist nie ein bezahltes Merkmal.
 */
import type { OriginClass } from "./origin-check";

/** Sicherung gilt als veraltet, wenn sie MEHR als sieben Tage zurückliegt und Daten ungesichert sind. */
export const STALE_BACKUP_MS = 7 * 24 * 60 * 60 * 1000;

export type BackupHealthState =
  | "clean"
  | "dirty"
  | "dirty-autobackup-off"
  | "offline-pending"
  | "failed"
  | "conflict"
  | "no-verified-backup"
  | "stale"
  | "local-only";

export type BackupSeverity = "ok" | "info" | "warning" | "error";

export type BackupSyncStatus = "idle" | "syncing" | "synced" | "offline" | "error" | "conflict";

export type BackupScopeKind = "user" | "demo" | "guest";

export interface BackupHealthInput {
  signedIn: boolean;
  scopeKind: BackupScopeKind;
  /** Ergebnis von `classifyOrigin`. */
  origin: OriginClass;
  /** Enthält das Gerät Nutzerdaten (nicht `isUserDataEmpty`)? */
  hasData: boolean;
  autoBackup: boolean;
  online: boolean;
  syncStatus: BackupSyncStatus;
  /** Ungesicherte lokale Änderungen laut Änderungsmarken (nicht aus `pending`!). */
  dirty: boolean;
  /** Zeitpunkt der letzten verifizierten Übereinstimmung mit der Cloud (ms) oder `null`. */
  lastVerifiedAt: number | null;
  now: number;
}

export interface BackupHealth {
  state: BackupHealthState;
  severity: BackupSeverity;
  /** Maschinenlesbare Gründe (für Texte und Tests). */
  reasons: string[];
  /** Tage seit der letzten verifizierten Sicherung (nur wenn bekannt). */
  daysSinceVerified: number | null;
  /**
   * Fremde Adresse (nicht kanonisch, nicht Entwicklung). UNABHÄNGIG vom Zustand: sie verdeckt nie
   * ungesicherte Daten, Fehler, Konflikte oder fehlende verifizierte Sicherungen.
   */
  originWarning: boolean;
}

/**
 * `dirty` aus den Änderungsmarken: eine Änderung seit dem letzten Abgleich ODER (mit Daten) nie
 * abgeglichen. Unabhängig von `autoBackup` und von `pending`.
 */
export function computeDirty(meta: {
  localChangedAt: number | null | undefined;
  localWorkChangedAt?: number | null | undefined;
  lastSyncedAt: number | null | undefined;
  hasData: boolean;
}): boolean {
  if (meta.localChangedAt != null || meta.localWorkChangedAt != null) return true;
  return meta.hasData && meta.lastSyncedAt == null;
}

function daysBetween(from: number | null, now: number): number | null {
  if (from == null) return null;
  return Math.floor((now - from) / (24 * 60 * 60 * 1000));
}

export function deriveBackupHealth(input: BackupHealthInput): BackupHealth {
  const daysSinceVerified = daysBetween(input.lastVerifiedAt, input.now);
  const originWarning = input.origin === "non-canonical";
  const done = (
    state: BackupHealthState,
    severity: BackupSeverity,
    ...reasons: string[]
  ): BackupHealth => ({ state, severity, reasons, daysSinceVerified, originWarning });

  // Ein Konflikt oder Fehler im Abgleich ist immer sichtbar – wichtiger als jeder andere Hinweis.
  if (input.syncStatus === "conflict") return done("conflict", "error", "conflict-unresolved");
  if (input.syncStatus === "error") return done("failed", "error", "sync-error");

  const signedInUser = input.signedIn && input.scopeKind === "user";
  if (!signedInUser) {
    if (!input.hasData) return done("clean", "ok", "no-data");
    const reason =
      input.scopeKind === "demo" ? "test-mode" : input.signedIn ? "other-scope" : "signed-out";
    return done("local-only", "warning", reason);
  }
  if (!input.hasData) return done("clean", "ok", "no-data");

  const isOffline = !input.online || input.syncStatus === "offline";
  if (isOffline && input.dirty) return done("offline-pending", "info", "offline", "dirty");

  const stale =
    input.dirty &&
    input.lastVerifiedAt != null &&
    input.now - input.lastVerifiedAt > STALE_BACKUP_MS;
  if (stale) return done("stale", "warning", "stale-over-7-days", "dirty");

  if (input.lastVerifiedAt == null) return done("no-verified-backup", "warning", "never-verified");

  if (input.dirty) {
    return input.autoBackup
      ? done("dirty", "info", "dirty")
      : done("dirty-autobackup-off", "warning", "dirty", "autobackup-off");
  }
  return done("clean", "ok", "verified-and-clean");
}
