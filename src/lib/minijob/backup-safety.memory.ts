/**
 * In-Memory-Double für `SnapshotStorage` (Tests). Strukturiertes Klonen wie IndexedDB, damit
 * Verfälschungen/Aliasing auffallen. Fehler lassen sich pro Operation einspielen.
 */
import {
  SnapshotError,
  type SnapshotKind,
  type SnapshotMeta,
  type SnapshotRecord,
  type SnapshotStorage,
} from "./backup-safety";

export type MemoryOp =
  | "put"
  | "get"
  | "markVerified"
  | "listByScope"
  | "listByScopeKind"
  | "listPending"
  | "delete"
  | "deleteMany"
  | "deleteByScope";

export interface MemoryStorage extends SnapshotStorage {
  records: Map<string, SnapshotRecord>;
  /** Nächster Aufruf von `op` schlägt (einmalig) mit diesem Fehler fehl. */
  failNext(op: MemoryOp, error: SnapshotError): void;
  /** Jeder Aufruf von `op` schlägt fehl, bis `clearFailures()`. */
  failAlways(op: MemoryOp, error: SnapshotError): void;
  clearFailures(): void;
  /** Datensatz direkt verändern (Korruption simulieren). */
  tamper(id: string, patch: Partial<SnapshotRecord>): void;
  calls: MemoryOp[];
}

const clone = <T>(value: T): T => structuredClone(value);

function meta(record: SnapshotRecord): SnapshotMeta {
  const { payload: _payload, ...rest } = record;
  return clone(rest);
}

export function createMemoryStorage(): MemoryStorage {
  const records = new Map<string, SnapshotRecord>();
  const once = new Map<MemoryOp, SnapshotError>();
  const always = new Map<MemoryOp, SnapshotError>();
  const calls: MemoryOp[] = [];

  async function enter(op: MemoryOp): Promise<void> {
    calls.push(op);
    await Promise.resolve();
    const a = always.get(op);
    if (a) throw a;
    const o = once.get(op);
    if (o) {
      once.delete(op);
      throw o;
    }
  }

  return {
    records,
    calls,
    failNext: (op, error) => void once.set(op, error),
    failAlways: (op, error) => void always.set(op, error),
    clearFailures: () => {
      once.clear();
      always.clear();
    },
    tamper(id, patch) {
      const current = records.get(id);
      if (current) records.set(id, { ...current, ...patch });
    },
    async put(record) {
      await enter("put");
      records.set(record.id, clone(record));
    },
    async get(id) {
      await enter("get");
      const r = records.get(id);
      return r ? clone(r) : undefined;
    },
    async markVerified(id, verifiedAt) {
      await enter("markVerified");
      const r = records.get(id);
      if (!r) throw new SnapshotError("not-found");
      records.set(id, { ...r, state: "verified", verifiedAt });
    },
    async listByScope(scope) {
      await enter("listByScope");
      return [...records.values()].filter((r) => r.scope === scope).map(meta);
    },
    async listByScopeKind(scope, kind: SnapshotKind) {
      await enter("listByScopeKind");
      return [...records.values()].filter((r) => r.scope === scope && r.kind === kind).map(meta);
    },
    async listPending() {
      await enter("listPending");
      return [...records.values()].filter((r) => r.state === "pending").map(meta);
    },
    async delete(id) {
      await enter("delete");
      records.delete(id);
    },
    async deleteMany(ids) {
      await enter("deleteMany");
      for (const id of ids) records.delete(id);
    },
    async deleteByScope(scope) {
      await enter("deleteByScope");
      let n = 0;
      for (const [id, r] of [...records]) {
        if (r.scope === scope) {
          records.delete(id);
          n += 1;
        }
      }
      return n;
    },
  };
}
