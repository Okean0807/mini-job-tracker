import { isValidPayload } from "./payload";
import {
  ALLOWED_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  getDocumentStore,
  isValidDocumentId,
  validateFolder,
  validateStoredDocument,
  type DocumentStore,
  type StoredDocument,
  type StoredFolder,
} from "./document-store";
import type { AppData } from "./types";
import { ZipError, buildZip, crcOfBlob, looksLikeZip, openZip } from "./zip-store";

/**
 * Backup / restore of the app data TOGETHER WITH locally stored documents.
 *
 * Formats
 * - v1 (existing): a plain JSON file with the app data. Still exported when there are no documents/folders and
 *   still imported exactly as before (handled by local-backup-restore.ts, untouched).
 * - v2: a ZIP container (stored entries, see zip-store.ts) with
 *     manifest.json            { format, version, createdAt, app{size,crc}, counts, documents[], folders[] }
 *     data.json                the app data (same JSON as v1)
 *     documents/<id>           the original bytes of each document
 *   Integrity: sizes + CRC-32 per entry (detects corruption). The archive is NOT encrypted and NOT signed.
 *
 * Restore: parse + validate EVERYTHING first (no write), show a preview, then stage -> commit -> rollback:
 *   1. documents/folders are added in ONE IndexedDB transaction (all or nothing; existing ids are never overwritten),
 *   2. the app data is replaced (existing behaviour of the JSON restore),
 *   3. if step 2 fails, the app data snapshot is put back and the documents added in step 1 are removed again.
 * Existing documents are never deleted or overwritten by a restore.
 */
export const BACKUP_FORMAT = "minijob-backup";
export const BACKUP_VERSION = 2;
export const MAX_BACKUP_BYTES = 1024 * 1024 * 1024;
export const MAX_BACKUP_DOCUMENTS = 500;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_DATA_BYTES = 64 * 1024 * 1024;

export type BackupErrorCode =
  | "not-a-backup"
  | "corrupt"
  | "unsupported"
  | "newer-version"
  | "bad-manifest"
  | "missing-file"
  | "extra-file"
  | "integrity"
  | "bad-document"
  | "duplicate-id"
  | "too-large"
  | "invalid-data"
  | "quota"
  | "storage-unavailable"
  | "commit-failed";

export class BackupError extends Error {
  constructor(
    public readonly code: BackupErrorCode,
    /** True when a rollback could not remove everything that was staged (user is told to retry/inspect). */
    public readonly rollbackIncomplete = false,
  ) {
    super(code); // never contains names, ids or contents
    this.name = "BackupError";
  }
}

interface ManifestDoc {
  id: string;
  file: string;
  name: string;
  mimeType: string;
  size: number;
  crc: number;
  category: string;
  jobId: string | null;
  folderId: string | null;
  tags: string[];
  note: string | null;
  createdAt: string;
  uploadedAt: string;
}
export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  app: { file: "data.json"; size: number; crc: number };
  counts: { documents: number; folders: number; totalBytes: number };
  documents: ManifestDoc[];
  folders: StoredFolder[];
}

const enc = new TextEncoder();
const jsonBlob = (v: unknown, type = "application/json") =>
  new Blob([enc.encode(JSON.stringify(v))], { type });

export interface ExportResult {
  blob: Blob;
  filename: string;
  kind: "json" | "zip";
  documents: number;
  /** Records that failed validation and were therefore not exported (never deleted). */
  skippedCorrupt: number;
}

export async function exportBackup(
  data: AppData,
  opts: { store?: DocumentStore; now?: Date; withDocuments?: boolean } = {},
): Promise<ExportResult> {
  const now = opts.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const withDocs = opts.withDocuments ?? true;
  const store = opts.store ?? getDocumentStore();
  let metas: Awaited<ReturnType<DocumentStore["list"]>> = { docs: [], corrupt: 0 };
  let folders: StoredFolder[] = [];
  if (withDocs) {
    try {
      metas = await store.list();
      folders = await store.listFolders();
    } catch {
      throw new BackupError("storage-unavailable"); // never silently export a backup that lacks the documents
    }
  }
  if (metas.docs.length === 0 && folders.length === 0 && metas.corrupt === 0) {
    return {
      blob: jsonBlob(data),
      filename: `minijob-backup-${day}.json`,
      kind: "json",
      documents: 0,
      skippedCorrupt: 0,
    };
  }
  const entries: { name: string; data: Blob }[] = [];
  const mdocs: ManifestDoc[] = [];
  let totalBytes = 0;
  for (const m of metas.docs) {
    let full: StoredDocument;
    try {
      full = await store.get(m.id);
    } catch {
      throw new BackupError("storage-unavailable");
    }
    const crc = await crcOfBlob(full.blob);
    const { blob, ...meta } = full;
    mdocs.push({ ...meta, file: `documents/${m.id}`, crc });
    entries.push({ name: `documents/${m.id}`, data: blob });
    totalBytes += blob.size;
  }
  const dataBlob = jsonBlob(data);
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    app: { file: "data.json", size: dataBlob.size, crc: await crcOfBlob(dataBlob) },
    counts: { documents: mdocs.length, folders: folders.length, totalBytes },
    documents: mdocs,
    folders,
  };
  const zip = await buildZip([
    { name: "manifest.json", data: jsonBlob(manifest) },
    { name: "data.json", data: dataBlob },
    ...entries,
  ]);
  // Self-check: never hand out an archive that this app could not read back.
  await prepareRestore(zip, { store: undefined, skipExistingCheck: true });
  return {
    blob: zip,
    filename: `minijob-backup-${day}.zip`,
    kind: "zip",
    documents: mdocs.length,
    skippedCorrupt: metas.corrupt,
  };
}

export interface RestoreSummary {
  documents: number;
  folders: number;
  totalBytes: number;
  shifts: number;
  jobs: number;
  /** Documents of the backup whose id already exists on this device: they are kept as they are (not overwritten). */
  alreadyPresent: number;
  toAdd: number;
}

export type RestorePlan =
  | { kind: "json" }
  | {
      kind: "zip";
      data: AppData;
      documents: StoredDocument[];
      folders: StoredFolder[];
      summary: RestoreSummary;
    };

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function zipToBackupError(e: unknown): BackupError {
  if (e instanceof BackupError) return e;
  if (e instanceof ZipError) {
    if (e.code === "unsupported") return new BackupError("unsupported");
    if (
      e.code === "entry-too-large" ||
      e.code === "archive-too-large" ||
      e.code === "too-many-entries"
    )
      return new BackupError("too-large");
    if (e.code === "crc-mismatch") return new BackupError("integrity");
    if (e.code === "missing-entry") return new BackupError("missing-file");
    return new BackupError("corrupt");
  }
  return new BackupError("corrupt");
}

/**
 * Validates a backup file completely WITHOUT writing anything. `{kind:"json"}` means "not a ZIP: use the
 * existing JSON restore". Throws BackupError for anything wrong with a ZIP backup.
 */
export async function prepareRestore(
  file: Blob,
  opts: { store?: DocumentStore | undefined; skipExistingCheck?: boolean } = {},
): Promise<RestorePlan> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!looksLikeZip(head)) return { kind: "json" };
  if (file.size > MAX_BACKUP_BYTES) throw new BackupError("too-large");
  try {
    const zip = await openZip(file, {
      maxEntryBytes: MAX_DOCUMENT_BYTES > MAX_DATA_BYTES ? MAX_DOCUMENT_BYTES : MAX_DATA_BYTES,
      maxTotalBytes: MAX_BACKUP_BYTES,
    });
    const names = new Set(zip.entries.map((e) => e.name));
    if (!names.has("manifest.json")) throw new BackupError("not-a-backup");
    const mInfo = zip.entries.find((e) => e.name === "manifest.json");
    if (!mInfo || mInfo.size > MAX_MANIFEST_BYTES) throw new BackupError("bad-manifest");
    let mraw: unknown;
    try {
      mraw = JSON.parse(await (await zip.read("manifest.json")).text());
    } catch (e) {
      throw e instanceof ZipError ? e : new BackupError("bad-manifest");
    }
    if (!isRec(mraw) || mraw["format"] !== BACKUP_FORMAT) throw new BackupError("not-a-backup");
    if (!isInt(mraw["version"])) throw new BackupError("bad-manifest");
    if (mraw["version"] > BACKUP_VERSION) throw new BackupError("newer-version");
    if (mraw["version"] !== BACKUP_VERSION) throw new BackupError("unsupported");
    const app = mraw["app"],
      counts = mraw["counts"],
      mdocs = mraw["documents"],
      mfolders = mraw["folders"];
    if (!isRec(app) || app["file"] !== "data.json" || !isInt(app["size"]) || !isInt(app["crc"]))
      throw new BackupError("bad-manifest");
    if (
      !isRec(counts) ||
      !isInt(counts["documents"]) ||
      !isInt(counts["folders"]) ||
      !isInt(counts["totalBytes"])
    )
      throw new BackupError("bad-manifest");
    if (!Array.isArray(mdocs) || !Array.isArray(mfolders)) throw new BackupError("bad-manifest");
    if (
      mdocs.length > MAX_BACKUP_DOCUMENTS ||
      counts["documents"] !== mdocs.length ||
      counts["folders"] !== mfolders.length
    )
      throw new BackupError("integrity");

    // exact file set: manifest + data + one file per listed document (nothing missing, nothing extra)
    const expected = new Set<string>(["manifest.json", "data.json"]);
    const ids = new Set<string>();
    for (const d of mdocs) {
      if (!isRec(d) || !isValidDocumentId(d["id"])) throw new BackupError("bad-document");
      if (ids.has(d["id"] as string)) throw new BackupError("duplicate-id");
      ids.add(d["id"] as string);
      if (d["file"] !== `documents/${d["id"] as string}`) throw new BackupError("bad-document");
      expected.add(d["file"] as string);
    }
    for (const n of names) if (!expected.has(n)) throw new BackupError("extra-file");
    for (const n of expected) if (!names.has(n)) throw new BackupError("missing-file");

    const dInfo = zip.entries.find((e) => e.name === "data.json");
    if (
      !dInfo ||
      dInfo.size !== app["size"] ||
      dInfo.crc !== app["crc"] ||
      dInfo.size > MAX_DATA_BYTES
    )
      throw new BackupError("integrity");
    let data: unknown;
    try {
      data = JSON.parse(await (await zip.read("data.json")).text());
    } catch (e) {
      throw e instanceof ZipError ? e : new BackupError("invalid-data");
    }
    if (!isValidPayload(data)) throw new BackupError("invalid-data");

    const documents: StoredDocument[] = [];
    let total = 0;
    for (const d of mdocs as Record<string, unknown>[]) {
      const info = zip.entries.find((e) => e.name === d["file"]);
      if (!info || info.size !== d["size"] || info.crc !== d["crc"])
        throw new BackupError("integrity");
      if (info.size > MAX_DOCUMENT_BYTES) throw new BackupError("too-large");
      const mime = d["mimeType"];
      if (typeof mime !== "string" || !(ALLOWED_MIME_TYPES as readonly string[]).includes(mime))
        throw new BackupError("bad-document");
      const blob = await zip.read(info.name, mime);
      const rec = validateStoredDocument({ ...d, blob });
      if (!rec) throw new BackupError("bad-document");
      total += rec.size;
      documents.push(rec);
    }
    if (total !== counts["totalBytes"]) throw new BackupError("integrity");
    const folders: StoredFolder[] = [];
    const fids = new Set<string>();
    for (const f of mfolders) {
      const v = validateFolder(f);
      if (!v) throw new BackupError("bad-manifest");
      if (fids.has(v.id)) throw new BackupError("duplicate-id");
      fids.add(v.id);
      folders.push(v);
    }

    let alreadyPresent = 0;
    if (!opts.skipExistingCheck) {
      const store = opts.store ?? getDocumentStore();
      let have: Set<string>;
      try {
        have = new Set(await store.ids());
      } catch {
        throw new BackupError("storage-unavailable");
      }
      alreadyPresent = documents.filter((d) => have.has(d.id)).length;
    }
    const payload = data as AppData;
    return {
      kind: "zip",
      data: payload,
      documents,
      folders,
      summary: {
        documents: documents.length,
        folders: folders.length,
        totalBytes: total,
        shifts: payload.shifts?.length ?? 0,
        jobs: payload.jobs?.length ?? 0,
        alreadyPresent,
        toAdd: documents.length - alreadyPresent,
      },
    };
  } catch (e) {
    throw zipToBackupError(e);
  }
}

export interface RestoreDeps {
  store: DocumentStore;
  getData(): AppData;
  replaceAll(data: Partial<AppData>): void;
  isPersistFailed(): boolean;
}

export interface RestoreResult {
  addedDocuments: number;
  keptExistingDocuments: number;
  addedFolders: number;
}

/**
 * Stage -> commit -> rollback. Call only after the user confirmed the preview.
 * Nothing existing is deleted or overwritten: documents/folders already on the device are skipped.
 */
export async function commitRestore(
  plan: Extract<RestorePlan, { kind: "zip" }>,
  deps: RestoreDeps,
): Promise<RestoreResult> {
  const snapshot = deps.getData();
  let have: Set<string>;
  let haveFolders: Set<string>;
  try {
    have = new Set(await deps.store.ids());
    haveFolders = new Set((await deps.store.listFolders()).map((f) => f.id));
  } catch {
    throw new BackupError("storage-unavailable");
  }
  const docs = plan.documents.filter((d) => !have.has(d.id));
  const folders = plan.folders.filter((f) => !haveFolders.has(f.id));
  // 1. stage: one IndexedDB transaction for all new documents + folders. Failure => nothing was written.
  try {
    await deps.store.addMany(docs, folders);
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    throw new BackupError(
      code === "quota"
        ? "quota"
        : code === "unavailable" || code === "blocked"
          ? "storage-unavailable"
          : "commit-failed",
    );
  }
  // 2. commit the app data; 3. roll back everything staged if that fails
  let failed = false;
  try {
    deps.replaceAll(plan.data);
    if (deps.isPersistFailed()) failed = true;
  } catch {
    failed = true;
  }
  if (failed) {
    let incomplete = false;
    try {
      deps.replaceAll(snapshot);
    } catch {
      incomplete = true;
    }
    try {
      await deps.store.deleteMany(
        docs.map((d) => d.id),
        folders.map((f) => f.id),
      );
    } catch {
      incomplete = true;
    }
    throw new BackupError("commit-failed", incomplete);
  }
  return {
    addedDocuments: docs.length,
    keptExistingDocuments: plan.documents.length - docs.length,
    addedFolders: folders.length,
  };
}
