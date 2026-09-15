/**
 * XLSX import is off for v1 — DataMigration must not open/mount ImportDialog.
 * Export (CSV/Excel) stays available.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcPath = join(dirname(fileURLToPath(import.meta.url)), "einstellungen.tsx");
const src = readFileSync(srcPath, "utf8");

describe("einstellungen XLSX import off", () => {
  it("does not import or mount ImportDialog", () => {
    expect(src).not.toMatch(/ImportDialog/);
    expect(src).not.toMatch(/setImportOpen/);
    expect(src).not.toMatch(/importOpen/);
  });

  it("keeps export paths and notes import unavailable", () => {
    expect(src).toMatch(/exportXlsx/);
    expect(src).toMatch(/shiftsToCsv/);
    expect(src).toMatch(/set\.migration\.importUnavailable/);
  });

  it("DataMigration body has no open ImportDialog for xlsx", () => {
    const start = src.indexOf("function DataMigration");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = src.slice(start, src.indexOf("\n}\n", start) + 3);
    expect(body).not.toMatch(/ImportDialog/);
    expect(body).not.toMatch(/\.xlsx|\.xls/);
    expect(body).toMatch(/importUnavailable/);
  });
});
