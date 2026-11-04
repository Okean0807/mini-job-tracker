/**
 * Reads the .env files Vite would load from the project root (NAME=value lines) so the build
 * gate also sees values that never pass through process.env. Node only - never imported by the
 * application bundle. Returns a plain object; values are never logged.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** @param {string} text */
export function parseEnvText(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[m[1]] = value;
  }
  return out;
}

/**
 * The `.env` and `.env.*` files in `root` (except `*.example` templates) in a stable order.
 * @param {string} root
 * @returns {string[]}
 */
function envFileNames(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => n === ".env" || (n.startsWith(".env.") && !n.endsWith(".example")))
    .sort();
}

/**
 * One object per env file (no merging) - lets the public-local gate reject a risky value in ANY
 * file even if a higher-priority file would override it for one particular Vite mode.
 * @param {string} root
 * @returns {Record<string, string>[]}
 */
export function loadEnvFileViewsSync(root) {
  /** @type {Record<string, string>[]} */
  const views = [];
  for (const n of envFileNames(root)) {
    try {
      views.push(parseEnvText(readFileSync(join(root, n), "utf8")));
    } catch {
      /* unreadable file or directory: ignore (Vite would fail on its own) */
    }
  }
  return views;
}

/**
 * All env files merged in a stable order (later names win).
 * @param {string} root
 * @returns {Record<string, string>}
 */
export function loadEnvFilesSync(root) {
  return Object.assign({}, ...loadEnvFileViewsSync(root));
}
