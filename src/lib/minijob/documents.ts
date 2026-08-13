import { supabase } from "@/integrations/supabase/client";

export const DOC_CATEGORIES = [
  "vertrag",
  "lohnabrechnung",
  "bescheinigung",
  "quittung",
  "sonstiges",
] as const;

export type DocCategory = (typeof DOC_CATEGORIES)[number];

export interface DocumentRow {
  id: string;
  name: string;
  path: string;
  category: string;
  job_id: string | null;
  size: number;
  mime_type: string | null;
  note: string | null;
  created_at: string;
}

const BUCKET = "documents";

export async function listDocuments(): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id,name,path,category,job_id,size,mime_type,note,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DocumentRow[];
}

function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(-80);
}

export async function uploadDocument(
  file: File,
  meta: { category: string; jobId?: string; note?: string },
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("not-signed-in");

  const path = `${userId}/${Date.now().toString(36)}-${safeName(file.name)}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (upErr) throw upErr;

  const { error } = await supabase.from("documents").insert({
    user_id: userId,
    name: file.name,
    path,
    category: meta.category,
    job_id: meta.jobId ?? null,
    size: file.size,
    mime_type: file.type || null,
    note: meta.note ?? null,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
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
