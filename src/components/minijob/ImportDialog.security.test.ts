/**
 * Import hardening: spreadsheets never reach a parser, malformed input never
 * throws out of the dialog, and failed imports never touch stored data.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseCsv } from "@/lib/minijob/csv";
import { importFileKind, MAX_IMPORT_BYTES } from "@/lib/minijob/import-file-kind";

const dialogSrc = readFileSync(
  resolve(process.cwd(), "src/components/minijob/ImportDialog.tsx"),
  "utf8",
);
const handleFileSrc = dialogSrc.slice(
  dialogSrc.indexOf("async function handleFile"),
  dialogSrc.indexOf("function confirmImport"),
);

describe("importFileKind — routing before any byte is read", () => {
  it("rejects every spreadsheet workbook format, case-insensitively", () => {
    for (const name of ["a.xlsx", "a.xls", "A.XLSX", "b.xlsm", "c.xlsb", "d.ods", " e.xls "]) {
      expect(importFileKind(name), name).toBe("spreadsheet");
    }
  });

  it("keeps JSON backups and CSV/TXT on their existing paths", () => {
    expect(importFileKind("sicherung.json")).toBe("json");
    expect(importFileKind("BACKUP.JSON")).toBe("json");
    expect(importFileKind("schichten.csv")).toBe("text");
    expect(importFileKind("export.txt")).toBe("text");
    expect(importFileKind("xlsx-export.csv")).toBe("text");
  });

  it("caps every client import file at 2 MiB", () => {
    expect(MAX_IMPORT_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe("ImportDialog — Excel import stays disabled", () => {
  it("offers only CSV, TXT and JSON in the file picker", () => {
    // Extensions CSV/TXT/JSON; MIME types are listed only so Android's picker does not grey
    // out a CSV (application/vnd.ms-excel is the legacy CSV type, .xls* is still refused by name).
    expect(dialogSrc).toContain("accept={IMPORT_FILE_ACCEPT}");
    const accept = dialogSrc.match(/IMPORT_FILE_ACCEPT =\s*"([^"]*)"/)?.[1] ?? "";
    expect(accept.split(",").slice(0, 3)).toEqual([".csv", ".txt", ".json"]);
    expect(accept).not.toMatch(/\.xls|\.ods|spreadsheetml/);
  });

  it("checks size, then rejects spreadsheets before reading the file", () => {
    const sizeAt = handleFileSrc.indexOf("file.size > MAX_IMPORT_BYTES");
    const sheetAt = handleFileSrc.indexOf('kind === "spreadsheet"');
    const readAt = handleFileSrc.indexOf("file.text()");
    expect(sizeAt).toBeGreaterThan(-1);
    expect(sheetAt).toBeGreaterThan(sizeAt);
    expect(readAt).toBeGreaterThan(sheetAt);
    expect(handleFileSrc).toMatch(
      /kind === "spreadsheet"\) \{[\s\S]*?imp\.xlsxUnsupported[\s\S]*?return;/,
    );
  });

  it("never imports SheetJS in the dialog", () => {
    expect(dialogSrc).not.toMatch(/from\s*["']xlsx["']|XLSX\./);
  });

  it("parse failures surface as a toast; parsing does not write data", () => {
    expect(handleFileSrc).toMatch(
      /try \{\s*parsed = parseCsv\([\s\S]*?\} catch \{\s*fail\(t\("imp\.readError"\)\);\s*return;/,
    );
    expect(handleFileSrc).not.toMatch(/saveShifts|saveJob|replaceAll/);
  });

  it("the SheetJS boundary guard passes (write-only export adapter only)", () => {
    const r = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts/assert-xlsx-boundary.mjs")],
      {
        encoding: "utf8",
      },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("XLSX security boundary OK");
  });
});

describe("parseCsv — malformed input never throws", () => {
  const opts = { jobs: [], defaultRate: 12 };

  it("a regular CSV row still imports", () => {
    const r = parseCsv("2026-03-01;09:00;17:00;30;13,50;Café;", opts);
    expect(r.valid).toHaveLength(1);
  });

  it("an XLSX (ZIP) file read as text yields no valid rows", () => {
    const zipLike =
      "PK\u0003\u0004\u0014\u0000\u0006\u0000[Content_Types].xml\u0000ÿþ\n\u0000\u0001";
    const r = parseCsv(zipLike, opts);
    expect(r.valid).toHaveLength(0);
  });

  it("binary noise, empty input and very long lines are handled", () => {
    let seed = 7;
    const noise = Array.from({ length: 4096 }, () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return String.fromCharCode(seed % 256);
    }).join("");
    for (const text of [noise, "", "﻿", ";".repeat(100_000), "a".repeat(200_000)]) {
      expect(() => parseCsv(text, opts)).not.toThrow();
      expect(parseCsv(text, opts).valid).toHaveLength(0);
    }
  });
});
