import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;
const allowed = new Set(["lib/minijob/xlsx-export.ts"]);
const violations = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(root, path).replaceAll("\\", "/");
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(name)) {
      const source = readFileSync(path, "utf8");
      if (/XLSX\.read(?:File)?\s*\(/.test(source)) {
        violations.push(`${rel}: spreadsheet read API detected`);
      }
      if (rel !== "lib/minijob/xlsx-export.ts" && /(?:from\s*["']xlsx["']|import\s*\(\s*["']xlsx["']\s*\))/.test(source)) {
        violations.push(`${rel}: direct xlsx import outside write-only adapter`);
      }
    }
  }
}

walk(root);
if (violations.length) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log("XLSX security boundary OK: write-only adapter is the sole direct SheetJS import.");
