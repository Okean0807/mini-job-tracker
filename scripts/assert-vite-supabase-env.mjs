#!/usr/bin/env node
/**
 * Vercel build gate: ensure Supabase public URL/key are present so Vite can
 * bake VITE_* into the client bundle. Never prints secret values — only
 * ok/length/source names.
 */
function nonEmpty(name) {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pick(viteName, supabaseName) {
  const fromVite = nonEmpty(viteName);
  if (fromVite) return { name: viteName, length: fromVite.length };
  const fromSupabase = nonEmpty(supabaseName);
  if (fromSupabase) return { name: supabaseName, length: fromSupabase.length };
  return null;
}

if (process.env.VERCEL !== "1") {
  console.log("assert-vite-supabase-env: skip (VERCEL!==\"1\")");
  process.exit(0);
}

const url = pick("VITE_SUPABASE_URL", "SUPABASE_URL");
const key = pick("VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY");

const missing = [];
if (!url) missing.push("VITE_SUPABASE_URL or SUPABASE_URL");
if (!key) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY or SUPABASE_PUBLISHABLE_KEY");

if (missing.length) {
  console.error(
    `assert-vite-supabase-env: FAIL — missing non-empty env: ${missing.join(", ")}.`,
  );
  console.error(
    "Owner: In Vercel → Project → Settings → Environment Variables, set non-empty",
  );
  console.error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (and/or SUPABASE_*) for",
  );
  console.error(
    "Production + Preview, then Redeploy (do not create/rotate keys if they already exist).",
  );
  process.exit(1);
}

console.log(
  `assert-vite-supabase-env: OK — url source=${url.name} length=${url.length}; key source=${key.name} length=${key.length}`,
);
process.exit(0);
