#!/usr/bin/env node
/**
 * Build gate (P1): validates MJC_BUILD_PROFILE and the profile's variables before `vite build`.
 * Profiles: public-local | cloud-enabled | d41-pilot (missing or unknown profile = failure).
 * Runs on every platform (not only VERCEL=1). Prints variable NAMES and codes only - never values.
 * Optional: --root <dir> (where .env files are read from; default: project root; used by tests).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatBuildProfileFailure, validateBuildEnv } from "../src/lib/cloud/build-profile.mjs";
import { loadEnvFilesSync } from "../src/lib/cloud/env-files.mjs";

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const root =
  rootIdx >= 0 && args[rootIdx + 1]
    ? resolve(args[rootIdx + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Same precedence as Vite: real process environment wins over .env files.
const env = { ...loadEnvFilesSync(root), ...process.env };
const result = validateBuildEnv(env);

if (!result.ok) {
  console.error(
    "assert-build-profile: FAIL - build stopped (names only, values are never printed):",
  );
  for (const line of formatBuildProfileFailure(result)) console.error(`  - ${line}`);
  console.error("Set MJC_BUILD_PROFILE to exactly one of: public-local, cloud-enabled, d41-pilot.");
  process.exit(1);
}

console.log(`assert-build-profile: OK - profile=${result.profile}; ${result.notes.join("; ")}`);
process.exit(0);
