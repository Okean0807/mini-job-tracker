import { supabase } from "@/integrations/supabase/client";

import {
  GENERATED_DOC_CATEGORIES,
  type GeneratedDocCategory,
} from "./generated-docs";

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
export const HUB_DOC_CATEGORIES = [
  ...DOC_CATEGORIES,
  ...GENERATED_DOC_CATEGORIES,
] as const;

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

export async function listDocuments(): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from("documents")
    .select(SELECT)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as DocumentRow[]).map((d) => ({ ...d, tags: d.tags ?? [] }));
}

export async function listFolders(): Promise<FolderRow[]> {
  const { data, error } = await supabase
    .from("document_folders")
    .select("id,name,color")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as FolderRow[];
}

export async function createFolder(name: string, color: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("not-signed-in");
  const { error } = await supabase
    .from("document_folders")
    .insert({ user_id: userId, name, color });
  if (error) throw error;
}

export async function updateFolder(id: string, patch: Partial<FolderRow>): Promise<void> {
  const { error } = await supabase.from("document_folders").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteFolder(id: string): Promise<void> {
  const { error } = await supabase.from("document_folders").delete().eq("id", id);
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

export async function uploadDocument(
  file: File,
  meta: { category: string; jobId?: string; note?: string; folderId?: string; tags?: string[] },
): Promise<void> {
  if (file.size <= 0 || file.size > MAX_DOCUMENT_SIZE) {
    throw new DocumentUploadError("file-too-large");
  }
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.type as (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number])) {
    throw new DocumentUploadError("file-type-not-allowed");
  }

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.id) throw new DocumentUploadError("not-signed-in");

  const body = new FormData();
  body.append("file", file, file.name);
  body.append("category", meta.category);
  if (meta.jobId) body.append("jobId", meta.jobId);
  if (meta.folderId) body.append("folderId", meta.folderId);
  if (meta.note) body.append("note", meta.note);
  body.append("tags", JSON.stringify(meta.tags ?? []));

  const { error } = await supabase.functions.invoke("upload-document", { body });
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
  const { error } = await supabase.from("documents").update(patch).eq("id", id);
  if (error) throw error;
}

export async function documentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error || !data) throw error ?? new Error("no-url");
  return data.signedUrl;
}

export async function deleteDocument(doc: DocumentRow): Promise<void> {
  await supabase.storage.from(BUCKET).remove([doc.path]);
  const { error } = await supabase.from("documents").delete().eq("id", doc.id);
  if (error) throw error;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
