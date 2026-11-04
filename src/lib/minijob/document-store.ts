import { scopeSuffix } from "./storage-scope";
import { getActiveScope } from "./store";

/**
 * Local storage of uploaded documents (Public Local build) in IndexedDB.
 *
 * Design:
 * - One database per storage scope (guest / demo / account), same isolation rule as every other local store.
 * - Object store `documents`: ONE record per document = metadata + the original Blob. A record is written with
 *   a single `add`, so "metadata without file" or "file without metadata" cannot exist by construction.
 * - Object store `folders`: folder metadata (name, colour) used by the existing Documents UI.
 * - Every write resolves only on the transaction's `complete` event (never on a request's success), so the UI
 *   can not report "saved" before the browser has committed the data.
 * - Errors are mapped to a small code set (quota / unavailable / duplicate-id / not-found / invalid-record / ...).
 * - Nothing here deletes anything on its own (no eviction, no quota clean-up).
 * - Nothing here touches the network.
 */
export const DOCUMENT_DB_BASE = "minijob-documents-v1";
const DB_VERSION = 1;
const DOCS = "documents";
const FOLDERS = "folders";

export type DocumentStoreErrorCode =
  | "unavailable"
  | "quota"
  | "duplicate-id"
  | "not-found"
  | "invalid-record"
  | "blocked"
  | "aborted"
  | "failed";

export class DocumentStoreError extends Error {
  constructor(public readonly code: DocumentStoreErrorCode) {
    super(code); // the message never contains file names, ids or contents
    this.name = "DocumentStoreError";
  }
}

export interface DocumentMeta {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  category: string;
  jobId: string | null;
  folderId: string | null;
  tags: string[];
  note: string | null;
  /** Creation time of the original file (File.lastModified) - falls back to the upload time. */
  createdAt: string;
  /** When the document was added to this device. */
  uploadedAt: string;
}

export interface StoredDocument extends DocumentMeta {
  blob: Blob;
}

export interface StoredFolder {
  id: string;
  name: string;
  color: string;
}

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function newDocumentId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isValidDocumentId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

const isStr = (v: unknown): v is string => typeof v === "string";

/** Structural validation of a stored/imported record. Returns the record or null. */
export function validateStoredDocument(raw: unknown): StoredDocument | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isValidDocumentId(r["id"])) return null;
  if (!isStr(r["name"]) || r["name"].trim() === "" || r["name"].length > 255) return null;
  if (!isStr(r["mimeType"]) || !(ALLOWED_MIME_TYPES as readonly string[]).includes(r["mimeType"]))
    return null;
  if (!(r["blob"] instanceof Blob)) return null;
  if (
    typeof r["size"] !== "number" ||
    r["size"] !== r["blob"].size ||
    r["size"] <= 0 ||
    r["size"] > MAX_DOCUMENT_BYTES
  )
    return null;
  if (!isStr(r["category"]) || r["category"].length > 64) return null;
  for (const k of ["jobId", "folderId", "note"] as const) {
    if (r[k] !== null && !isStr(r[k])) return null;
  }
  if (
    !Array.isArray(r["tags"]) ||
    r["tags"].length > 50 ||
    !r["tags"].every((t) => isStr(t) && t.length <= 64)
  )
    return null;
  if (!isStr(r["createdAt"]) || !isStr(r["uploadedAt"])) return null;
  return {
    id: r["id"],
    name: r["name"],
    mimeType: r["mimeType"],
    size: r["size"],
    category: r["category"],
    jobId: r["jobId"] as string | null,
    folderId: r["folderId"] as string | null,
    tags: r["tags"] as string[],
    note: r["note"] as string | null,
    createdAt: r["createdAt"],
    uploadedAt: r["uploadedAt"],
    blob: r["blob"],
  };
}

export function validateFolder(raw: unknown): StoredFolder | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    !isValidDocumentId(r["id"]) ||
    !isStr(r["name"]) ||
    r["name"].trim() === "" ||
    r["name"].length > 100 ||
    !isStr(r["color"]) ||
    r["color"].length > 32
  )
    return null;
  return { id: r["id"], name: r["name"], color: r["color"] };
}

function mapError(err: unknown, fallback: DocumentStoreErrorCode = "failed"): DocumentStoreError {
  if (err instanceof DocumentStoreError) return err;
  const name = (err as { name?: string } | null)?.name ?? "";
  if (name === "QuotaExceededError") return new DocumentStoreError("quota");
  if (name === "ConstraintError") return new DocumentStoreError("duplicate-id");
  if (name === "SecurityError" || name === "InvalidStateError" || name === "NotSupportedError")
    return new DocumentStoreError("unavailable");
  if (name === "AbortError") return new DocumentStoreError("aborted");
  return new DocumentStoreError(fallback);
}

type Tx = IDBTransaction;

export class DocumentStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory | undefined,
    readonly dbName: string,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    const factory = this.factory;
    if (!factory) return Promise.reject(new DocumentStoreError("unavailable"));
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try {
        req = factory.open(this.dbName, DB_VERSION);
      } catch (e) {
        reject(mapError(e, "unavailable"));
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(FOLDERS))
          db.createObjectStore(FOLDERS, { keyPath: "id" });
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another tab wants to upgrade/delete: let go, the next call reopens.
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        db.onclose = () => {
          this.dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(mapError(req.error, "unavailable"));
      req.onblocked = () => reject(new DocumentStoreError("blocked"));
    });
    this.dbPromise.catch(() => {
      this.dbPromise = null; // allow a retry after a failed open
    });
    return this.dbPromise;
  }

  /**
   * Runs `work` inside ONE transaction and resolves with its result only after the transaction completed.
   * An exception thrown by `work`, a failed request or a quota error aborts the whole transaction.
   */
  private async run<T>(
    mode: IDBTransactionMode,
    stores: string[],
    work: (tx: Tx) => Promise<T> | T,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let tx: Tx;
      try {
        tx = db.transaction(stores, mode);
      } catch (e) {
        reject(mapError(e));
        return;
      }
      let result: T;
      let have = false;
      tx.oncomplete = () => {
        if (have) resolve(result);
        else reject(new DocumentStoreError("failed"));
      };
      tx.onabort = () => reject(mapError(tx.error, "aborted"));
      tx.onerror = () => undefined; // surfaces through onabort
      Promise.resolve()
        .then(() => work(tx))
        .then(
          (v) => {
            result = v;
            have = true;
          },
          (e) => {
            try {
              tx.abort();
            } catch {
              /* already finished */
            }
            reject(mapError(e));
          },
        );
    });
  }

  private static req<R>(r: IDBRequest<R>): Promise<R> {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error("request-failed"));
    });
  }

  /** Adds one document (record = metadata + Blob). Fails with `duplicate-id` instead of overwriting. */
  async add(doc: StoredDocument): Promise<void> {
    if (!validateStoredDocument(doc)) throw new DocumentStoreError("invalid-record");
    await this.run("readwrite", [DOCS], (tx) => {
      DocumentStore.req(tx.objectStore(DOCS).add(doc)).catch(() => undefined); // failure aborts the tx -> onabort
    });
  }

  /** All-or-nothing: either every document/folder is added or nothing is (used by backup restore). */
  async addMany(docs: StoredDocument[], folders: StoredFolder[] = []): Promise<void> {
    for (const d of docs)
      if (!validateStoredDocument(d)) throw new DocumentStoreError("invalid-record");
    for (const f of folders) if (!validateFolder(f)) throw new DocumentStoreError("invalid-record");
    await this.run("readwrite", [DOCS, FOLDERS], (tx) => {
      const ds = tx.objectStore(DOCS);
      const fs = tx.objectStore(FOLDERS);
      for (const d of docs) DocumentStore.req(ds.add(d)).catch(() => undefined);
      for (const f of folders) DocumentStore.req(fs.add(f)).catch(() => undefined);
    });
  }

  async get(id: string): Promise<StoredDocument> {
    const raw = await this.run("readonly", [DOCS], (tx) =>
      DocumentStore.req(tx.objectStore(DOCS).get(id)),
    );
    if (raw === undefined) throw new DocumentStoreError("not-found");
    const doc = validateStoredDocument(raw);
    if (!doc) throw new DocumentStoreError("invalid-record");
    return doc;
  }

  /** Valid documents (without Blob) newest first; `corrupt` counts records that failed validation (never deleted). */
  async list(): Promise<{ docs: DocumentMeta[]; corrupt: number }> {
    const rows = await this.run("readonly", [DOCS], (tx) =>
      DocumentStore.req(tx.objectStore(DOCS).getAll()),
    );
    const docs: DocumentMeta[] = [];
    let corrupt = 0;
    for (const r of rows as unknown[]) {
      const d = validateStoredDocument(r);
      if (!d) {
        corrupt += 1;
        continue;
      }
      const { blob: _blob, ...meta } = d;
      void _blob;
      docs.push(meta);
    }
    docs.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : a.uploadedAt > b.uploadedAt ? -1 : 0));
    return { docs, corrupt };
  }

  async count(): Promise<number> {
    return this.run("readonly", [DOCS], (tx) => DocumentStore.req(tx.objectStore(DOCS).count()));
  }

  async ids(): Promise<string[]> {
    const keys = await this.run("readonly", [DOCS], (tx) =>
      DocumentStore.req(tx.objectStore(DOCS).getAllKeys()),
    );
    return (keys as IDBValidKey[]).filter((k): k is string => typeof k === "string");
  }

  /** Read-modify-write of the metadata in one transaction; the Blob is never touched. */
  async update(
    id: string,
    patch: Partial<
      Pick<DocumentMeta, "name" | "category" | "jobId" | "folderId" | "tags" | "note">
    >,
  ): Promise<void> {
    await this.run("readwrite", [DOCS], async (tx) => {
      const store = tx.objectStore(DOCS);
      const raw = await DocumentStore.req(store.get(id));
      if (raw === undefined) throw new DocumentStoreError("not-found");
      const cur = validateStoredDocument(raw);
      if (!cur) throw new DocumentStoreError("invalid-record");
      const next = { ...cur, ...patch };
      if (!validateStoredDocument(next)) throw new DocumentStoreError("invalid-record");
      await DocumentStore.req(store.put(next));
    });
  }

  /** Deletes the whole record (metadata and Blob together). Deleting a missing id is a no-op. */
  async delete(id: string): Promise<void> {
    await this.run("readwrite", [DOCS], (tx) => {
      DocumentStore.req(tx.objectStore(DOCS).delete(id)).catch(() => undefined);
    });
  }

  /** Rollback helper for restore: removes exactly the given documents and folders (separate id spaces). */
  async deleteMany(docIds: string[], folderIds: string[] = []): Promise<void> {
    if (docIds.length === 0 && folderIds.length === 0) return;
    await this.run("readwrite", [DOCS, FOLDERS], (tx) => {
      for (const id of docIds)
        DocumentStore.req(tx.objectStore(DOCS).delete(id)).catch(() => undefined);
      for (const id of folderIds)
        DocumentStore.req(tx.objectStore(FOLDERS).delete(id)).catch(() => undefined);
    });
  }

  async listFolders(): Promise<StoredFolder[]> {
    const rows = await this.run("readonly", [FOLDERS], (tx) =>
      DocumentStore.req(tx.objectStore(FOLDERS).getAll()),
    );
    return (rows as unknown[])
      .map(validateFolder)
      .filter((f): f is StoredFolder => f !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async addFolder(folder: StoredFolder): Promise<void> {
    if (!validateFolder(folder)) throw new DocumentStoreError("invalid-record");
    await this.run("readwrite", [FOLDERS], (tx) => {
      DocumentStore.req(tx.objectStore(FOLDERS).add(folder)).catch(() => undefined);
    });
  }

  async updateFolder(
    id: string,
    patch: Partial<Pick<StoredFolder, "name" | "color">>,
  ): Promise<void> {
    await this.run("readwrite", [FOLDERS], async (tx) => {
      const store = tx.objectStore(FOLDERS);
      const cur = validateFolder(await DocumentStore.req(store.get(id)));
      if (!cur) throw new DocumentStoreError("not-found");
      const next = { ...cur, ...patch };
      if (!validateFolder(next)) throw new DocumentStoreError("invalid-record");
      await DocumentStore.req(store.put(next));
    });
  }

  /** Deletes a folder; documents that were in it are kept and become "no folder" (same transaction). */
  async deleteFolder(id: string): Promise<void> {
    await this.run("readwrite", [FOLDERS, DOCS], async (tx) => {
      const docs = tx.objectStore(DOCS);
      const rows = (await DocumentStore.req(docs.getAll())) as unknown[];
      for (const r of rows) {
        const d = validateStoredDocument(r);
        if (d && d.folderId === id) await DocumentStore.req(docs.put({ ...d, folderId: null }));
      }
      await DocumentStore.req(tx.objectStore(FOLDERS).delete(id));
    });
  }

  close(): void {
    const p = this.dbPromise;
    this.dbPromise = null;
    void p?.then((db) => db.close()).catch(() => undefined);
  }
}

/* ---------- per-scope instances, persistence request, change notification ---------- */

let factoryOverride: IDBFactory | null | undefined;
/** Test hook: inject a factory (or `null` to simulate "IndexedDB unavailable"); `undefined` restores the default. */
export function __setIndexedDbForTests(f: IDBFactory | null | undefined): void {
  factoryOverride = f;
  for (const s of instances.values()) s.close();
  instances.clear();
}

const instances = new Map<string, DocumentStore>();

export function documentDbName(): string {
  return `${DOCUMENT_DB_BASE}:${scopeSuffix(getActiveScope())}`;
}

export function getDocumentStore(): DocumentStore {
  const name = documentDbName();
  let s = instances.get(name);
  if (!s) {
    const factory =
      factoryOverride === undefined
        ? typeof indexedDB === "undefined"
          ? undefined
          : indexedDB
        : (factoryOverride ?? undefined);
    s = new DocumentStore(factory, name);
    instances.set(name, s);
  }
  return s;
}

export type PersistenceResult = "granted" | "denied" | "unsupported";

/**
 * Asks the browser to mark this origin's storage as persistent. Best effort only: a refusal (or no support)
 * is reported as such and never treated as a guarantee either way.
 */
export async function requestPersistentStorage(): Promise<PersistenceResult> {
  try {
    const s = globalThis.navigator?.storage;
    if (!s || typeof s.persist !== "function") return "unsupported";
    if (typeof s.persisted === "function" && (await s.persisted())) return "granted";
    return (await s.persist()) ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}

const CHANNEL = "minijob-documents-v1";
export function notifyDocumentsChanged(): void {
  try {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ type: "changed", db: documentDbName() });
    ch.close();
  } catch {
    /* best effort */
  }
}

/** Other tabs/windows of the same origin changed the documents of the active scope. */
export function onDocumentsChangedElsewhere(cb: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e: MessageEvent) => {
    if ((e.data as { db?: string } | null)?.db === documentDbName()) cb();
  };
  return () => ch.close();
}
