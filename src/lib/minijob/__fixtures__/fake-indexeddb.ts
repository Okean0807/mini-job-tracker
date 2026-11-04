/**
 * Tiny in-memory IndexedDB used ONLY by unit tests (the project may not add fake-indexeddb as a dependency).
 * It models what DocumentStore relies on: versioned open + upgrade, object stores with keyPath, transactions
 * with copy-on-write staging (commit on `complete`, discard on abort), request/transaction error events, `add`
 * rejecting duplicates with ConstraintError, and fault injection (quota error, aborted transaction, failing open).
 * The real engine behaviour is verified separately in a real browser (see the Phase 2.1 browser run).
 */
type Rec = Record<string, unknown>;
type Req<R = unknown> = {
  result?: R;
  error?: unknown;
  onsuccess: null | (() => void);
  onerror: null | (() => void);
};

export interface FaultPlan {
  /** Called before each write request; return an error name to make THAT request fail (aborting the transaction). */
  onWrite?:
    | undefined
    | ((op: "add" | "put" | "delete", storeName: string, value?: unknown) => string | undefined);
  /** Make open() fail with this error name. */
  openError?: string | undefined;
  /** Abort the transaction right after its first request completes (simulates an interrupted transaction). */
  abortAfterFirstRequest?: boolean | undefined;
}

export interface FakeIdb {
  factory: IDBFactory;
  faults: FaultPlan;
  /** Committed contents (for assertions): db -> store -> key -> value. */
  data: Map<string, Map<string, Map<string, unknown>>>;
  opens: number;
}

const dom = (name: string) => new DOMException(name, name);

export function createFakeIndexedDB(): FakeIdb {
  const data: FakeIdb["data"] = new Map();
  const versions = new Map<string, number>();
  const keyPaths = new Map<string, Map<string, string>>();
  const fake: FakeIdb = { factory: undefined as unknown as IDBFactory, faults: {}, data, opens: 0 };

  function makeDb(name: string) {
    const stores = data.get(name) as Map<string, Map<string, unknown>>;
    const kp = keyPaths.get(name) as Map<string, string>;
    const db = {
      name,
      onversionchange: null as null | (() => void),
      onclose: null as null | (() => void),
      objectStoreNames: { contains: (n: string) => stores.has(n) },
      createObjectStore(n: string, o: { keyPath: string }) {
        stores.set(n, new Map());
        kp.set(n, o.keyPath);
      },
      close() {},
      transaction(names: string | string[], mode: IDBTransactionMode) {
        const list = Array.isArray(names) ? names : [names];
        for (const n of list) if (!stores.has(n)) throw dom("NotFoundError");
        return makeTx(stores, kp, list, mode);
      },
    };
    return db;
  }

  function makeTx(
    stores: Map<string, Map<string, unknown>>,
    kp: Map<string, string>,
    list: string[],
    mode: IDBTransactionMode,
  ) {
    const staged = new Map<string, Map<string, unknown>>();
    for (const n of list) staged.set(n, new Map(stores.get(n) as Map<string, unknown>));
    let pending = 0;
    let done = false;
    let first = true;
    const tx = {
      error: null as unknown,
      oncomplete: null as null | (() => void),
      onabort: null as null | (() => void),
      onerror: null as null | (() => void),
      abort() {
        finishAbort(null);
      },
      objectStore(n: string) {
        if (!staged.has(n)) throw dom("NotFoundError");
        return store(n);
      },
    };
    function finishAbort(err: unknown) {
      if (done) return;
      done = true;
      tx.error = err;
      setTimeout(() => tx.onabort?.(), 0);
    }
    function schedule() {
      setTimeout(() => {
        if (!done && pending === 0) {
          done = true;
          for (const n of list) stores.set(n, staged.get(n) as Map<string, unknown>);
          tx.oncomplete?.();
        }
      }, 0);
    }
    function request<R>(
      exec: () => R,
      write?: { op: "add" | "put" | "delete"; storeName: string; value?: unknown },
    ): Req<R> {
      if (done) throw dom("TransactionInactiveError");
      if (write && mode === "readonly") throw dom("ReadOnlyError");
      const req: Req<R> = { onsuccess: null, onerror: null };
      pending += 1;
      setTimeout(() => {
        if (done) return;
        try {
          const injected = write
            ? fake.faults.onWrite?.(write.op, write.storeName, write.value)
            : undefined;
          if (injected) throw dom(injected);
          req.result = exec();
          pending -= 1;
          req.onsuccess?.();
          if (first && fake.faults.abortAfterFirstRequest) {
            first = false;
            finishAbort(dom("AbortError"));
            return;
          }
          first = false;
          schedule();
        } catch (e) {
          pending -= 1;
          req.error = e;
          req.onerror?.();
          finishAbort(e);
        }
      }, 0);
      return req;
    }
    function store(n: string) {
      const rows = staged.get(n) as Map<string, unknown>;
      const key = kp.get(n) as string;
      const keyOf = (v: unknown) => String((v as Rec)[key]);
      return {
        add: (v: unknown) =>
          request(
            () => {
              const k = keyOf(v);
              if (rows.has(k)) throw dom("ConstraintError");
              rows.set(k, v);
              return k;
            },
            { op: "add", storeName: n, value: v },
          ),
        put: (v: unknown) =>
          request(
            () => {
              const k = keyOf(v);
              rows.set(k, v);
              return k;
            },
            { op: "put", storeName: n, value: v },
          ),
        get: (k: string) => request(() => rows.get(k)),
        getAll: () => request(() => Array.from(rows.values())),
        getAllKeys: () => request(() => Array.from(rows.keys())),
        count: () => request(() => rows.size),
        delete: (k: string) =>
          request(
            () => {
              rows.delete(k);
              return undefined;
            },
            { op: "delete", storeName: n },
          ),
      };
    }
    return tx;
  }

  fake.factory = {
    open(name: string, version?: number) {
      fake.opens += 1;
      const req = {
        result: undefined as unknown,
        error: null as unknown,
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
        onupgradeneeded: null as null | (() => void),
        onblocked: null as null | (() => void),
      };
      setTimeout(() => {
        if (fake.faults.openError) {
          req.error = dom(fake.faults.openError);
          req.onerror?.();
          return;
        }
        const v = version ?? 1;
        const isNew = !data.has(name);
        if (isNew) {
          data.set(name, new Map());
          keyPaths.set(name, new Map());
        }
        const db = makeDb(name);
        req.result = db;
        if (isNew || (versions.get(name) ?? 0) < v) {
          versions.set(name, v);
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      }, 0);
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
  return fake;
}
