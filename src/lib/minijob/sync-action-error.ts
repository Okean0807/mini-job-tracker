import { StaleSyncError } from "./cloud";

/**
 * Fehlertext für manuelle Sync-Aktionen (Sichern/Wiederherstellen/Konflikt).
 * `null` = still bleiben: StaleSyncError bedeutet, dass Konto/Namensraum
 * während des Abgleichs gewechselt hat – das ist kein Fehler des Nutzers und
 * der neue Namensraum hat seinen eigenen Sync-Status.
 */
export function syncActionErrorMessage(error: unknown, fallback: string): string | null {
  if (error instanceof StaleSyncError) return null;
  return error instanceof Error && error.message ? error.message : fallback;
}
