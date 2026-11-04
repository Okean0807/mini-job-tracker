import { cloudClient } from "@/integrations/supabase/guarded-client";
import { isCloudMode } from "@/lib/cloud/cloud-mode";

import {
  DocumentStoreError,
  getDocumentStore,
  newDocumentId,
  notifyDocumentsChanged,
  requestPersistentStorage,
  type DocumentMeta,
  type PersistenceResult,
} from "./document-store";

import { GENERATED_DOC_CATEGORIES, type GeneratedDocCategory } from "./generated-docs";

export { GENERATED_DOC_CATEGORIES };
export type { GeneratedDocCategory };

export const DOC_CATEGORIES = [
  "vertrag",
  "lohnabrechnung",
  "bescheinigung",
  "quittung",
  "sonstiges",
] as const;

export type DocCategory = (typeof DOC_CATEGORIES)[number];

/** Upload categories + generated export categories for hub filters. */
export const HUB_DOC_CATEGORIES = [...DOC_CATEGORIES, ...GENERATED_DOC_CATEGORIES] as const;

export type HubDocCategory = (typeof HUB_DOC_CATEGORIES)[number];

export const FOLDER_COLORS = ["#0d9488", "#2563eb", "#16a34a", "#ea580c", "#dc2626", "#7c3aed"];

export interface DocumentRow {
  id: string;
  name: string;
  path: string;
  category: string;
  job_id: string | null;
  folder_id: string | null;
  tags: string[];
  size: number;
  mime_type: string | null;
  note: string | null;
  created_at: string | null;
}

export interface FolderRow {
  id: string;
  name: string;
  color: string;
}

const BUCKET = "documents";
const SELECT = "id,name,path,category,job_id,folder_id,tags,size,mime_type,note,created_at";

/** YYYY-MM-DD prefix for list display; empty when created_at is null/short. */
export function documentCreatedDay(createdAt: string | null | undefined): string {
  if (typeof createdAt !== "string" || createdAt.length < 10) return "";
  return createdAt.slice(0, 10);
}

export function parseTags(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean)
        .map((t) => t.slice(0, 32)),
    ),
  ).slice(0, 12);
}

/** Row shape of the Documents UI, filled from a local record (Public Local build). */
function rowFromMeta(m: DocumentMeta): DocumentRow {
  return {
    id: m.id,
    name: m.name,
    path: m.id,
    category: m.category,
    job_id: m.jobId,
    folder_id: m.folderId,
    tags: m.tags,
    size: m.size,
    mime_type: m.mimeType,
    note: m.note,
    created_at: m.uploadedAt,
  };
}

/** Number of stored records that failed validation in the last local listing (never deleted automatically). */
let lastCorruptCount = 0;
export function localCorruptDocumentCount(): number {
  return lastCorruptCount;
}

export async function listDocuments(): Promise<DocumentRow[]> {
  if (!isCloudMode()) {
    const { docs, corrupt } = await getDocumentStore().list();
    lastCorruptCount = corrupt;
    return docs.map(rowFromMeta);
  }
  const { data, error } = await cloudClient()
    .from("documents")
    .select(SELECT)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as DocumentRow[]).map((d) => ({ ...d, tags: d.tags ?? [] }));
}

export async function listFolders(): Promise<FolderRow[]> {
  if (!isCloudMode()) return getDocumentStore().listFolders();
  const { data, error } = await cloudClient()
    .from("document_folders")
    .select("id,name,color")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as FolderRow[];
}

export async function createFolder(name: string, color: string): Promise<void> {
  if (!isCloudMode()) {
    await getDocumentStore().addFolder({ id: newDocumentId(), name, color });
    notifyDocumentsChanged();
    return;
  }
  const { data: auth } = await cloudClient().auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("not-signed-in");
  const { error } = await cloudClient()
    .from("document_folders")
    .insert({ user_id: userId, name, color });
  if (error) throw error;
}

export async function updateFolder(id: string, patch: Partial<FolderRow>): Promise<void> {
  if (!isCloudMode()) {
    const { name, color } = patch;
    await getDocumentStore().updateFolder(id, {
      ...(name !== undefined ? { name } : {}),
      ...(color !== undefined ? { color } : {}),
    });
    notifyDocumentsChanged();
    return;
  }
  const { error } = await cloudClient().from("document_folders").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteFolder(id: string): Promise<void> {
  if (!isCloudMode()) {
    await getDocumentStore().deleteFolder(id);
    notifyDocumentsChanged();
    return;
  }
  const { error } = await cloudClient().from("document_folders").delete().eq("id", id);
  if (error) throw error;
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(-80);
}

export const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024;
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export class DocumentUploadError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DocumentUploadError";
  }
}

/** Browser's answer to the persistent-storage request after the last successful local save (best effort). */
let lastPersistence: PersistenceResult | null = null;
export function lastPersistenceResult(): PersistenceResult | null {
  return lastPersistence;
}

function uploadErrorFor(e: unknown): DocumentUploadError {
  const code = e instanceof DocumentStoreError ? e.code : "failed";
  return new DocumentUploadError(
    code === "quota"
      ? "storage-full"
      : code === "unavailable" || code === "blocked"
        ? "storage-unavailable"
        : "storage-failed",
  );
}

async function saveLocalDocument(
  file: File,
  meta: { category: string; jobId?: string; note?: string; folderId?: string; tags?: string[] },
): Promise<void> {
  const now = new Date().toISOString();
  const lm =
    Number.isFinite(file.lastModified) && file.lastModified > 0
      ? new Date(file.lastModified).toISOString()
      : now;
  // The Blob is stored as is (never read into a string, never turned into a Blob URL).
  const base = {
    name: file.name.slice(0, 255) || "document",
    mimeType: file.type,
    size: file.size,
    category: meta.category,
    jobId: meta.jobId ?? null,
    folderId: meta.folderId ?? null,
    tags: meta.tags ?? [],
    note: meta.note ?? null,
    createdAt: lm,
    uploadedAt: now,
    blob: file as Blob,
  };
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // resolves only after the IndexedDB transaction has completed
      await getDocumentStore().add({ ...base, id: newDocumentId() });
      notifyDocumentsChanged();
      void requestPersistentStorage().then((r) => {
        lastPersistence = r;
      });
      return;
    } catch (e) {
      lastErr = e;
      if (!(e instanceof DocumentStoreError && e.code === "duplicate-id")) break;
    }
  }
  throw uploadErrorFor(lastErr);
}

export async function uploadDocument(
  file: File,
  meta: { category: string; jobId?: string; note?: string; folderId?: string; tags?: string[] },
): Promise<void> {
  if (file.size <= 0 || file.size > MAX_DOCUMENT_SIZE) {
    throw new DocumentUploadError("file-too-large");
  }
  if (
    !ALLOWED_DOCUMENT_MIME_TYPES.includes(file.type as (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number])
  ) {
    throw new DocumentUploadError("file-type-not-allowed");
  }

  if (!isCloudMode()) {
    await saveLocalDocument(file, meta);
    return;
  }

  const { data: auth } = await cloudClient().auth.getUser();
  if (!auth.user?.id) throw new DocumentUploadError("not-signed-in");

  const body = new FormData();
  body.append("file", file, file.name);
  body.append("category", meta.category);
  if (meta.jobId) body.append("jobId", meta.jobId);
  if (meta.folderId) body.append("folderId", meta.folderId);
  if (meta.note) body.append("note", meta.note);
  body.append("tags", JSON.stringify(meta.tags ?? []));

  const { error } = await cloudClient().functions.invoke("upload-document", { body });
  if (error) throw error;
}

export async function updateDocument(
  id: string,
  patch: {
    name?: string;
    category?: string;
    job_id?: string | null;
    folder_id?: string | null;
    tags?: string[];
    note?: string | null;
  },
): Promise<void> {
  if (!isCloudMode()) {
    const { name, category, job_id, folder_id, tags, note } = patch;
    await getDocumentStore().update(id, {
      ...(name !== undefined ? { name } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(job_id !== undefined ? { jobId: job_id } : {}),
      ...(folder_id !== undefined ? { folderId: folder_id } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(note !== undefined ? { note } : {}),
    });
    notifyDocumentsChanged();
    return;
  }
  const { error } = await cloudClient().from("documents").update(patch).eq("id", id);
  if (error) throw error;
}

/** Temporary Blob URL for the stored file (Public Local). It is only a viewing handle, never the stored data. */
const BLOB_URL_TTL_MS = 120_000;
async function localBlobUrl(id: string): Promise<string> {
  const doc = await getDocumentStore().get(id);
  const url = URL.createObjectURL(doc.blob);
  globalThis.setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_TTL_MS);
  return url;
}

/** Saves the stored file to the user's disk under its original name (Public Local). */
export async function downloadLocalDocument(doc: Pick<DocumentRow, "id" | "name">): Promise<void> {
  const stored = await getDocumentStore().get(doc.id);
  const url = URL.createObjectURL(stored.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = stored.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function documentUrl(path: string): Promise<string> {
  if (!isCloudMode()) return localBlobUrl(path);
  const { data, error } = await cloudClient().storage.from(BUCKET).createSignedUrl(path, 600);
  if (error || !data) throw error ?? new Error("no-url");
  return data.signedUrl;
}

export async function deleteDocument(doc: DocumentRow): Promise<void> {
  if (!isCloudMode()) {
    // one transaction removes metadata and Blob together
    await getDocumentStore().delete(doc.id);
    notifyDocumentsChanged();
    return;
  }
  await cloudClient().storage.from(BUCKET).remove([doc.path]);
  const { error } = await cloudClient().from("documents").delete().eq("id", doc.id);
  if (error) throw error;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
