import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("XLSX security boundary", () => {
  it("keeps spreadsheet parsing out of the client import path", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/minijob/ImportDialog.tsx"), "utf8");
    expect(source).not.toMatch(/import\(\s*["']xlsx["']\s*\)/);
    expect(source).not.toMatch(/XLSX\.read\s*\(/);
  });

  it("uses xlsx only for generated exports, not untrusted workbook reads", () => {
    const adapterSource = readFileSync(resolve(process.cwd(), "src/lib/minijob/xlsx-export.ts"), "utf8");
    const exportSource = readFileSync(resolve(process.cwd(), "src/lib/minijob/export.ts"), "utf8");
    const annualSource = readFileSync(resolve(process.cwd(), "src/lib/minijob/annual-export.ts"), "utf8");
    expect(`${adapterSource}\n${exportSource}\n${annualSource}`).not.toMatch(/XLSX\.read(?:File)?\s*\(/);
    expect(adapterSource).toMatch(/XLSX\.write\s*\(/);
    expect(`${exportSource}\n${annualSource}`).not.toMatch(/from ["']xlsx["']/);
  });
});
