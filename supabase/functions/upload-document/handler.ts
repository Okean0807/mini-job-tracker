// Runtime-agnostic core of the `upload-document` Edge Function.
//
// Behaviour and response contract are identical to the previous single-file
// version (same status codes and `{ error: <code> }` bodies), with two fixes:
//  - after a failed `documents` insert, the result AND any exception of the
//    compensating `remove([path])` are checked; a failed cleanup is logged
//    server-side (codes only) and the response stays `document-record-failed`;
//  - any unexpected throw becomes a generic JSON 500 `internal-error` with CORS.
// Only the exact path uploaded in this request is ever removed. No retries.

export const BUCKET = "documents";
export const MAX_SIZE = 20 * 1024 * 1024;
export const ALLOWED = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);
const ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp"]);

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Result<T = unknown> = PromiseLike<{ data: T; error: unknown }>;

export interface UploadAdminLike {
  auth: { getUser(token: string): Result<{ user: { id: string } | null }> };
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Uint8Array,
        options: { contentType: string; upsert: boolean },
      ): Result;
      remove(paths: string[]): Result;
    };
  };
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(column: string, value: string): { maybeSingle(): Result<{ id: string } | null> };
      };
    };
    insert(row: Record<string, unknown>): PromiseLike<{ error: unknown }>;
  };
}

export interface UploadLog {
  error(event: string, fields: Record<string, string | number | boolean | null>): void;
}

export interface UploadDeps {
  getEnv(name: string): string | undefined;
  createAdmin(url: string, serviceRoleKey: string): UploadAdminLike;
  now(): number;
  uuid(): string;
  log: UploadLog;
}

export const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export const safeName = (name: string) => name.replace(/[^\w.-]+/g, "_").slice(-80);

export function detectType(b: Uint8Array): string | null {
  const ascii = (s: number, e: number) => new TextDecoder().decode(b.slice(s, e));
  if (b.length >= 5 && ascii(0, 5) === "%PDF-") return "application/pdf";
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (b.length >= 8 && b.slice(0, 8).every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i]))
    return "image/png";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Short, non-sensitive description of an error for server logs (no messages/values). */
export function errorCode(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { code?: unknown; name?: unknown; statusCode?: unknown };
    for (const v of [o.code, o.statusCode, o.name])
      if (typeof v === "string" || typeof v === "number") return String(v);
  }
  return "unknown";
}

export async function handleUploadDocument(req: Request, deps: UploadDeps): Promise<Response> {
  try {
    return await handleUnsafe(req, deps);
  } catch (e) {
    deps.log.error("upload-document.unhandled", { cause: errorCode(e) });
    return json(500, { error: "internal-error" });
  }
}

async function handleUnsafe(req: Request, deps: UploadDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method-not-allowed" });
  const h = req.headers.get("Authorization");
  if (!h?.startsWith("Bearer ")) return json(401, { error: "not-signed-in" });
  const url = deps.getEnv("SUPABASE_URL");
  const key = deps.getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json(500, { error: "server-not-configured" });
  const admin = deps.createAdmin(url, key);
  const {
    data: { user },
    error: ue,
  } = await admin.auth.getUser(h.slice(7));
  if (ue || !user) return json(401, { error: "not-signed-in" });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "invalid-form" });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json(400, { error: "file-required" });
  if (file.size <= 0 || file.size > MAX_SIZE) return json(413, { error: "file-too-large" });
  const mime = file.type;
  const ext = ALLOWED.get(mime);
  if (!ext) return json(415, { error: "file-type-not-allowed" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (detectType(bytes) !== mime) return json(415, { error: "file-content-mismatch" });
  const name = file.name || `document${ext}`;
  const givenExt = name.includes(".") ? `.${name.split(".").pop()!.toLowerCase()}` : "";
  if (!ALLOWED_EXT.has(givenExt)) return json(415, { error: "file-extension-not-allowed" });

  const category = String(form.get("category") ?? "sonstiges").slice(0, 64);
  const jobId = form.get("jobId") ? String(form.get("jobId")) : null;
  const folderId = form.get("folderId") ? String(form.get("folderId")) : null;
  const note = form.get("note") ? String(form.get("note")).slice(0, 2000) : null;
  let tags: string[] = [];
  try {
    const p = JSON.parse(String(form.get("tags") ?? "[]"));
    if (Array.isArray(p))
      tags = p
        .filter((x): x is string => typeof x === "string")
        .slice(0, 12)
        .map((x) => x.slice(0, 32));
  } catch {
    return json(400, { error: "invalid-tags" });
  }
  if (folderId) {
    const { data: folder, error: fe } = await admin
      .from("document_folders")
      .select("id")
      .eq("id", folderId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (fe) return json(500, { error: "folder-check-failed" });
    if (!folder) return json(403, { error: "folder-not-owned" });
  }

  const path = `${user.id}/${deps.now().toString(36)}-${deps.uuid()}-${safeName(name)}`;
  const bucket = admin.storage.from(BUCKET);
  const { error: up } = await bucket.upload(path, bytes, { contentType: mime, upsert: false });
  if (up) return json(500, { error: "storage-upload-failed" });

  let ins: unknown = null;
  try {
    ({ error: ins } = await admin.from("documents").insert({
      user_id: user.id,
      name,
      path,
      category,
      job_id: jobId,
      folder_id: folderId,
      tags,
      size: file.size,
      mime_type: mime,
      note,
    }));
  } catch (e) {
    // A thrown insert (network) must still trigger the compensating remove.
    ins = e ?? new Error("insert-threw");
  }
  if (ins) {
    deps.log.error("upload-document.insert-failed", { cause: errorCode(ins) });
    let cleanup: "ok" | "error" | "threw" = "ok";
    let cleanupCause = "";
    try {
      const { error: rmErr } = await bucket.remove([path]);
      if (rmErr) {
        cleanup = "error";
        cleanupCause = errorCode(rmErr);
      }
    } catch (e) {
      cleanup = "threw";
      cleanupCause = errorCode(e);
    }
    if (cleanup !== "ok")
      deps.log.error("upload-document.cleanup-failed", {
        result: cleanup,
        cause: cleanupCause,
        orphan: true,
      });
    return json(500, { error: "document-record-failed" });
  }
  return json(200, { ok: true });
}
