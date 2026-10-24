#!/usr/bin/env node
/**
 * Vercel build gate: ensure Supabase public URL/key are present so Vite can
 * bake VITE_* into the client bundle. Never prints secret values — only
 * ok/length/source names.
 *
 * Preview isolation: when VERCEL_ENV=preview the build also fails if any
 * Supabase URL/project id resolves to the Production project (ref from
 * supabase/config.toml) or if Production-only server credentials are present.
 */
import { readFileSync } from "node:fs";

/** Server credentials that must never be exposed to Preview builds. */
const PREVIEW_FORBIDDEN = ["SUPABASE_SERVICE_ROLE_KEY", "LOVABLE_API_KEY"];
/** Every variable that can select the Supabase project, including fallbacks. */
const SUPABASE_TARGET_VARS = [
  "VITE_SUPABASE_URL",
  "SUPABASE_URL",
  "VITE_SUPABASE_PROJECT_ID",
  "SUPABASE_PROJECT_ID",
];

function productionProjectRef() {
  const toml = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const match = toml.match(/^\s*project_id\s*=\s*"([a-z0-9]+)"/m);
  return match ? match[1] : null;
}

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

if (process.env.VERCEL_ENV === "preview") {
  const prodRef = productionProjectRef();
  if (!prodRef) {
    console.error(
      "assert-vite-supabase-env: FAIL — cannot read the Production project ref from supabase/config.toml.",
    );
    process.exit(1);
  }
  const problems = [];
  for (const name of SUPABASE_TARGET_VARS) {
    const value = nonEmpty(name);
    if (value && value.includes(prodRef)) problems.push(`${name} points to the Production project`);
  }
  for (const name of PREVIEW_FORBIDDEN) {
    if (nonEmpty(name)) problems.push(`${name} must not be set for Preview`);
  }
  if (problems.length) {
    console.error(`assert-vite-supabase-env: FAIL — Preview isolation: ${problems.join("; ")}.`);
    console.error(
      "Owner: In Vercel → Project → Settings → Environment Variables, give Preview its own values " +
        "(Preview Supabase project) and remove Production-only credentials from the Preview target, then redeploy.",
    );
    process.exit(1);
  }
  console.log("assert-vite-supabase-env: Preview isolation OK");
}

console.log(
  `assert-vite-supabase-env: OK — url source=${url.name} length=${url.length}; key source=${key.name} length=${key.length}`,
);
process.exit(0);
