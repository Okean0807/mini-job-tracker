/**
 * Dependabot #1/#2 (GHSA-4r6h-8v6p-xvw6 / CVE-2023-30533, GHSA-5pgg-2g8v-p4x9 /
 * CVE-2024-22363): SheetJS must be >= 0.20.2 (npm "xlsx" stops at 0.18.5, fixed
 * builds only via cdn.sheetjs.com). The app keeps SheetJS write-only.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { appendXlsxSheet, createXlsxBook, createXlsxSheet, writeXlsx } from "./xlsx-export";

const atLeast = (v: string, min: [number, number, number]) => {
  const p = v.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((p[i] ?? 0) !== min[i]) return (p[i] ?? 0) > min[i]!;
  }
  return true;
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("SheetJS version and write-only boundary", () => {
  it("installed SheetJS is >= 0.20.2 (both advisories patched)", () => {
    expect(atLeast(XLSX.version, [0, 20, 2])).toBe(true);
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["xlsx"]).toBe("https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz");
  });

  it("only the write-only adapter imports xlsx in app code", () => {
    const importers = sourceFiles(resolve(process.cwd(), "src"))
      .filter((f) =>
        /from\s+["']xlsx["']|import\(\s*["']xlsx["']\s*\)/.test(readFileSync(f, "utf8")),
      )
      .map((f) => f.slice(f.indexOf("src/")));
    expect(importers).toEqual(["src/lib/minijob/xlsx-export.ts"]);
  });

  it("export still produces a valid workbook with the same rows (read back only in this test)", () => {
    const book = createXlsxBook();
    appendXlsxSheet(
      book,
      createXlsxSheet([
        { Datum: "2026-10-05", Stunden: 5, Verdienst: 70, Notiz: 'a<b & "c"' },
        { Datum: "Summe", Stunden: 5, Verdienst: 70, Notiz: "" },
      ]),
      "Bericht",
    );
    const bytes = new Uint8Array(writeXlsx(book));
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe("PK");
    const back = XLSX.read(bytes, { type: "array" });
    expect(back.SheetNames).toEqual(["Bericht"]);
    const rows = XLSX.utils
      .sheet_to_json<Record<string, unknown>>(back.Sheets["Bericht"]!)
      .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "__rowNum__")));
    expect(rows).toEqual([
      { Datum: "2026-10-05", Stunden: 5, Verdienst: 70, Notiz: 'a<b & "c"' },
      { Datum: "Summe", Stunden: 5, Verdienst: 70, Notiz: "" },
    ]);
  });

  // Korrektur zu 5ae8a48 (Commit-Text): Leere Strings werden NICHT anders
  // behandelt als in 0.18.5. Verifiziert am 2026-10-16: json_to_sheet([{A:"x",N:""}])
  // → write → read ergibt in 0.18.5 und 0.20.3 identisch [{"A":"x","N":""}];
  // die Excel-Exporte aus dem Browser waren in beiden Versionen bytegleich.
  it("leere Strings bleiben als leere Zelle erhalten (wie in 0.18.5)", () => {
    const book = createXlsxBook();
    appendXlsxSheet(book, createXlsxSheet([{ A: "x", N: "" }]), "S");
    const back = XLSX.read(new Uint8Array(writeXlsx(book)), { type: "array" });
    const rows = XLSX.utils
      .sheet_to_json<Record<string, unknown>>(back.Sheets["S"]!)
      .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "__rowNum__")));
    expect(rows).toEqual([{ A: "x", N: "" }]);
  });
});
