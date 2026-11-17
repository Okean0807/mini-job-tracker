/**
 * Anbindung des Ablaufs an die laufende App: aktiver Scope, Store, IndexedDB-Snapshots und
 * Bestätigungsdialog. Die Ports werden zu BEGINN einer Operation gebildet und halten Scope und
 * Epoche fest (ein späterer Kontowechsel macht sie ungültig).
 */
import {
  createSnapshot,
  ensureBackupSafetyReady,
  getDefaultSnapshotStorage,
  getSnapshotFile,
  type SnapshotDeps,
} from "./backup-safety";
import { notifySnapshotsChanged } from "./backup-safety-active";
import { requestConfirmation } from "./guarded-confirm";
import type { GuardedPorts, ScopeGuard } from "./guarded-operation";
import {
  getActiveScope,
  getActiveScopeOwner,
  getData,
  getScopeGeneration,
  isScopeCurrent,
} from "./store";
import { scopeSuffix } from "./storage-scope";

export function createActivePorts(extraGuard?: () => boolean): GuardedPorts {
  const scope = getActiveScope();
  const generation = getScopeGeneration();
  const owner = getActiveScopeOwner();
  const current = () =>
    isScopeCurrent(generation) && getActiveScopeOwner() === owner && (extraGuard?.() ?? true);
  const deps = (): SnapshotDeps => ({
    backend: getDefaultSnapshotStorage(),
    isScopeCurrent: current,
  });
  return {
    scopeKey: scopeSuffix(scope),
    captureScope: (): ScopeGuard => ({ isCurrent: current }),
    readLocal: () => getData(),
    confirm: requestConfirmation,
    async createSnapshot(kind, data) {
      await ensureBackupSafetyReady();
      try {
        return (await createSnapshot({ kind, scope, data }, deps())).summary;
      } finally {
        notifySnapshotsChanged();
      }
    },
    async verifySnapshot(id) {
      await getSnapshotFile(id, scope, deps());
    },
  };
}
