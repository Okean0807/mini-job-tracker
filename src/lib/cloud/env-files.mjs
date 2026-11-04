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
 * All `.env` and `.env.*` files in `root` except `*.example` templates, merged in a stable order.
 * @param {string} root
 * @returns {Record<string, string>}
 */
export function loadEnvFilesSync(root) {
  if (!existsSync(root)) return {};
  const names = readdirSync(root)
    .filter((n) => n === ".env" || (n.startsWith(".env.") && !n.endsWith(".example")))
    .sort();
  /** @type {Record<string, string>} */
  const merged = {};
  for (const n of names) {
    try {
      Object.assign(merged, parseEnvText(readFileSync(join(root, n), "utf8")));
    } catch {
      /* unreadable file: ignore (Vite would fail on its own) */
    }
  }
  return merged;
}
