// Runtime-agnostic core of the `delete-account` Edge Function.
//
// Kept free of Deno globals and remote (esm.sh) imports so the exact same
// code can be unit-tested with Vitest. `index.ts` wires it to Deno.serve and
// the real supabase-js client.
//
// Consistency note: Storage, Postgres and Auth are separate systems with no
// shared transaction. Deletion is NOT atomic. The order below is chosen so a
// partial failure is always safe to retry:
//   1. list every object under `<user.id>/` (recursive, paginated)
//   2. remove objects in batches of <= 1000
//   3. re-list to verify nothing is left
//   4. delete rows in documents, document_folders, backups (user_id filter)
//   5. delete the Auth user
// Any failure returns a non-2xx response and stops before later steps, so the
// Auth user (and with it the ability to re-run the request) is only removed
// after Storage and DB cleanup succeeded.

export const BUCKET = "documents";
export const LIST_PAGE_SIZE = 1000;
export const REMOVE_BATCH_SIZE = 1000;
export const MAX_FOLDER_DEPTH = 32;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Subset of storage-js `FileObject` we rely on: folders have `id === null`. */
export interface StorageListItem {
  name: string;
  id: string | null;
}

export interface StorageBucketLike {
  list(
    path: string,
    options: { limit: number; offset: number; sortBy: { column: string; order: string } },
  ): PromiseLike<{ data: StorageListItem[] | null; error: unknown }>;
  remove(paths: string[]): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface AdminClientLike {
  auth: {
    getUser(token: string): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>;
    admin: { deleteUser(id: string): PromiseLike<{ error: unknown }> };
  };
  storage: { from(bucket: string): StorageBucketLike };
  from(table: string): {
    delete(): { eq(column: string, value: string): PromiseLike<{ error: unknown }> };
  };
}

export interface DeleteAccountDeps {
  getEnv(name: string): string | undefined;
  createAdmin(url: string, serviceRoleKey: string): AdminClientLike;
}

export class StorageCleanupError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "StorageCleanupError";
  }
}

function assertSafeSegment(segment: string): void {
  if (!segment || segment === "." || segment === ".." || segment.includes("/")) {
    throw new StorageCleanupError("storage-path-invalid");
  }
}

/**
 * Recursively lists every object path below `<userId>/`.
 * - folders are detected by `id === null` (storage-js FileObject contract),
 *   never by the absence of a file extension;
 * - each folder is paginated with `limit`/`offset` until a short page;
 * - traversal is breadth-first and sequential (no parallel list calls);
 * - every produced path is guarded to stay inside `<userId>/`.
 */
export async function listAllUserObjectPaths(
  bucket: StorageBucketLike,
  userId: string,
  pageSize = LIST_PAGE_SIZE,
): Promise<string[]> {
  assertSafeSegment(userId);
  const root = userId;
  const rootPrefix = `${root}/`;
  const paths: string[] = [];
  const visited = new Set<string>();
  const queue: { prefix: string; depth: number }[] = [{ prefix: root, depth: 0 }];

  while (queue.length > 0) {
    const { prefix, depth } = queue.shift()!;
    if (visited.has(prefix)) continue;
    visited.add(prefix);
    if (depth > MAX_FOLDER_DEPTH) throw new StorageCleanupError("storage-list-too-deep");

    let offset = 0;
    for (;;) {
      const { data, error } = await bucket.list(prefix, {
        limit: pageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new StorageCleanupError("storage-list-failed");
      const rows = data ?? [];
      for (const item of rows) {
        assertSafeSegment(item.name);
        const path = `${prefix}/${item.name}`;
        if (!path.startsWith(rootPrefix)) throw new StorageCleanupError("storage-path-invalid");
        if (item.id === null) queue.push({ prefix: path, depth: depth + 1 });
        else paths.push(path);
      }
      if (rows.length < pageSize) break;
      offset += rows.length;
    }
  }
  return paths;
}

/** Removes paths in batches of at most `batchSize`; throws on the first failing batch. */
export async function removeInBatches(
  bucket: StorageBucketLike,
  userId: string,
  paths: string[],
  batchSize = REMOVE_BATCH_SIZE,
): Promise<void> {
  const rootPrefix = `${userId}/`;
  for (const p of paths) {
    if (!p.startsWith(rootPrefix) || p.split("/").includes("..")) {
      throw new StorageCleanupError("storage-path-invalid");
    }
  }
  for (let i = 0; i < paths.length; i += batchSize) {
    const { error } = await bucket.remove(paths.slice(i, i + batchSize));
    if (error) throw new StorageCleanupError("storage-delete-failed");
  }
}

/** Full Storage cleanup for one user, including a verification re-list. */
export async function cleanupUserStorage(
  bucket: StorageBucketLike,
  userId: string,
): Promise<number> {
  const paths = await listAllUserObjectPaths(bucket, userId);
  await removeInBatches(bucket, userId, paths);
  if (paths.length > 0) {
    const remaining = await listAllUserObjectPaths(bucket, userId);
    if (remaining.length > 0) throw new StorageCleanupError("storage-delete-incomplete");
  }
  return paths.length;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export async function handleDeleteAccount(
  req: Request,
  deps: DeleteAccountDeps,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method-not-allowed" });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "not-signed-in" });
  const token = authHeader.slice("Bearer ".length);
  if (!token.trim()) return json(401, { error: "not-signed-in" });

  const url = deps.getEnv("SUPABASE_URL");
  const serviceRoleKey = deps.getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return json(500, { error: "server-not-configured" });

  const admin = deps.createAdmin(url, serviceRoleKey);
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);
  if (userError || !user) return json(401, { error: "not-signed-in" });

  try {
    await cleanupUserStorage(admin.storage.from(BUCKET), user.id);
  } catch (e) {
    const code = e instanceof StorageCleanupError ? e.code : "storage-delete-failed";
    return json(500, { error: code });
  }

  for (const table of ["documents", "document_folders", "backups"] as const) {
    const { error } = await admin.from(table).delete().eq("user_id", user.id);
    if (error) return json(500, { error: `data-delete-failed:${table}` });
  }

  const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteUserError) return json(500, { error: "auth-delete-failed" });

  return json(200, { ok: true });
}
