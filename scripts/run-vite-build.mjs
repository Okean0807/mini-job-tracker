#!/usr/bin/env node
/**
 * Official build runner (P1.2) - the ONLY supported way to produce a deployable build
 * (`npm run build`, `npm run build:dev`, `bun run build`, ...).
 *
 *   1. accepts only an optional Vite mode (see src/lib/cloud/build-runner-args.mjs); `--config`, `--root`,
 *      positional directories and every other argument are refused, so a caller cannot make Vite load
 *      another config file that lacks the in-config gate;
 *   2. runs the Build Gate (scripts/assert-build-profile.mjs) BEFORE Vite is started;
 *   3. starts Vite with the project's vite.config.ts pinned by absolute path and cwd = project root
 *      (the in-config gate plugin then runs a second time - defence in depth).
 *
 * Output: profile name, variable NAMES and codes only - never values.
 * Limits: this protects the official entry points. Running `vite build --config <other>` directly (outside
 * these scripts) cannot be prevented by repository code; see the P1.2 report.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBuildRunnerArgs } from "../src/lib/cloud/build-runner-args.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const refuse = (msg) => {
  console.error(`run-vite-build: FAIL - ${msg}`);
  process.exit(1);
};

const parsed = parseBuildRunnerArgs(process.argv.slice(2));
if (!parsed.ok) {
  refuse(
    `build refused (${parsed.code}). The official build accepts only an optional --mode <name>; ` +
      "--config, --root and any other argument are not allowed (the Build Gate lives in the pinned vite.config.ts).",
  );
}

const gate = spawnSync(process.execPath, [resolve(root, "scripts/assert-build-profile.mjs")], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
if (gate.error || gate.status !== 0) process.exit(1);

const config = resolve(root, "vite.config.ts");
const viteBin = resolve(root, "node_modules/vite/bin/vite.js");
if (!existsSync(config)) refuse("vite.config.ts not found.");
if (!existsSync(viteBin))
  refuse("vite is not installed (node_modules/vite/bin/vite.js not found).");

const viteArgs = [viteBin, "build", "--config", config];
if (parsed.mode !== null) viteArgs.push("--mode", parsed.mode);
const build = spawnSync(process.execPath, viteArgs, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
process.exit(build.error || build.status === null ? 1 : build.status);
