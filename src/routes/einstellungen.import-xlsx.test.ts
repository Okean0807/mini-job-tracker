/**
 * Data import entry in Settings → General → "Datenübertragung".
 *
 * History: since #78 the ImportDialog was no longer mounted anywhere (XLSX import was switched
 * off for v1), so CSV/JSON import could not be opened at all. It is reachable again through
 * DataImportButton; the XLSX decision is unchanged: spreadsheets are never parsed or imported,
 * only exported. The behaviour of the dialog is covered in DataImportButton.test.ts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const src = read("einstellungen.tsx");

function functionBody(code: string, name: string): string {
  const start = code.indexOf(`function ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  return code.slice(start, code.indexOf("\n}\n", start) + 3);
}

describe("einstellungen: data import entry", () => {
  it("DataMigration offers the import button after the export buttons, with jobs and settings", () => {
    const body = functionBody(src, "DataMigration");
    const csv = body.indexOf("set.migration.csv");
    const excel = body.indexOf("set.migration.excel");
    const importButton = body.indexOf("<DataImportButton");
    expect(importButton).toBeGreaterThan(Math.max(csv, excel));
    expect(body).toMatch(/<DataImportButton jobs=\{jobs\} settings=\{settings\} \/>/);
    expect(body.indexOf("set.migration.importUnavailable")).toBeGreaterThan(importButton);
  });

  it("the route does not mount a second ImportDialog; the only mount is inside DataImportButton", () => {
    expect(src).not.toMatch(/<ImportDialog/);
    expect(src).not.toMatch(/importOpen/);
    expect(read("../components/minijob/DataImportButton.tsx")).toMatch(/<ImportDialog\b/);
  });

  it("export paths stay and the XLSX note stays: spreadsheets are exported, never imported", () => {
    expect(src).toMatch(/exportXlsx/);
    expect(src).toMatch(/shiftsToCsv/);
    expect(src).toMatch(/set\.migration\.importUnavailable/);
  });

  it("no spreadsheet parser is reachable from the import path", () => {
    for (const rel of [
      "einstellungen.tsx",
      "../components/minijob/ImportDialog.tsx",
      "../components/minijob/DataImportButton.tsx",
    ]) {
      const code = read(rel);
      expect(code, rel).not.toMatch(/from\s*["']xlsx["']/);
      expect(code, rel).not.toMatch(/import\(\s*["']xlsx["']\s*\)/);
      expect(code, rel).not.toMatch(/XLSX\.read/);
    }
  });
});

describe("import, local backup, cloud backup and documents stay separate", () => {
  const dialog = read("../components/minijob/ImportDialog.tsx");
  const button = read("../components/minijob/DataImportButton.tsx");

  it("the import dialog and its button do not touch documents, cloud sync or Supabase", () => {
    for (const code of [dialog, button]) {
      expect(code).not.toMatch(/minijob\/(cloud|documents|generated-docs|local-backup-restore)/);
      expect(code).not.toMatch(/integrations\/supabase/);
    }
  });

  it("local backup (JSON restore in Settings) keeps its own handler and file input", () => {
    expect(src).toMatch(/restoreLocalBackupFile/);
    expect(functionBody(src, "LocalBackup")).toMatch(/accept="application\/json"/);
  });

  it("the Documents page keeps its own upload and does not use the import dialog", () => {
    const docs = read("dokumente.tsx");
    expect(docs).not.toMatch(/ImportDialog|DataImportButton/);
    expect(docs).toMatch(/type="file"/);
  });
});
