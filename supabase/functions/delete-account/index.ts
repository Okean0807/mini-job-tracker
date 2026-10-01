import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method-not-allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "not-signed-in" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return new Response(JSON.stringify({ error: "server-not-configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const token = authHeader.slice("Bearer ".length);
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) return new Response(JSON.stringify({ error: "not-signed-in" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const prefix = `${user.id}/`;
  // Storage.list() is paginated. Deleting only the first 1000 entries could
  // leave personal documents behind if an account has a large archive.
  const paths: string[] = [];
  let offset = 0;
  const pageSize = 1000;
  for (;;) {
    const { data: objects, error: listError } = await admin.storage
      .from("documents")
      .list(user.id, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });
    if (listError) return new Response(JSON.stringify({ error: "storage-list-failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const page = (objects ?? []).filter((o) => o.name).map((o) => `${prefix}${o.name}`);
    paths.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  for (let i = 0; i < paths.length; i += 1000) {
    const { error: removeError } = await admin.storage.from("documents").remove(paths.slice(i, i + 1000));
    if (removeError) return new Response(JSON.stringify({ error: "storage-delete-failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  for (const table of ["documents", "document_folders", "backups"] as const) {
    const { error } = await admin.from(table).delete().eq("user_id", user.id);
    if (error) return new Response(JSON.stringify({ error: `data-delete-failed:${table}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteUserError) return new Response(JSON.stringify({ error: "auth-delete-failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
