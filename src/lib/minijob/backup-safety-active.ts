/**
 * Aktiver-Scope-Anbindung der Wiederherstellungspunkte: bindet `backup-safety` an den Store
 * (aktiver Scope + Scope-Epoche). Kein Cloud-Zugriff, keine Premium-Prüfung.
 */
import {
  createSnapshot,
  deleteAllSnapshots,
  deleteSnapshot,
  ensureBackupSafetyReady,
  getDefaultSnapshotStorage,
  getSnapshotFile,
  listSnapshots,
  purgeScopeSnapshots,
  type CreatedSnapshot,
  type SnapshotDeps,
  type SnapshotFile,
  type SnapshotKind,
  type SnapshotSummary,
} from "./backup-safety";
import { getActiveScope, getScopeGeneration, isScopeCurrent } from "./store";
import type { StorageScope } from "./storage-scope";
import type { AppData } from "./types";

function activeDeps(): { scope: StorageScope; deps: SnapshotDeps } {
  const scope = getActiveScope();
  const generation = getScopeGeneration();
  return {
    scope,
    deps: {
      backend: getDefaultSnapshotStorage(),
      isScopeCurrent: () => isScopeCurrent(generation),
    },
  };
}

/** Vorab-Snapshot der aktiven Seite (für Phase 4). */
export async function createActiveSnapshot(
  kind: SnapshotKind,
  data: AppData,
): Promise<CreatedSnapshot> {
  await ensureBackupSafetyReady();
  const { scope, deps } = activeDeps();
  return createSnapshot({ kind, scope, data }, deps);
}

export async function listActiveSnapshots(): Promise<SnapshotSummary[]> {
  await ensureBackupSafetyReady();
  const { scope, deps } = activeDeps();
  return listSnapshots(scope, deps);
}

export async function getActiveSnapshotFile(id: string): Promise<SnapshotFile> {
  const { scope, deps } = activeDeps();
  return getSnapshotFile(id, scope, deps);
}

export async function deleteActiveSnapshot(id: string): Promise<void> {
  const { scope, deps } = activeDeps();
  return deleteSnapshot(id, scope, deps);
}

export async function deleteAllActiveSnapshots(): Promise<number> {
  const { scope, deps } = activeDeps();
  return deleteAllSnapshots(scope, deps);
}

/** Nach erfolgreicher Konto-Löschung: genau die Snapshots dieses Kontos entfernen. */
export async function purgeDeletedAccountSnapshots(scope: StorageScope): Promise<void> {
  await purgeScopeSnapshots(scope, { backend: getDefaultSnapshotStorage() });
}
