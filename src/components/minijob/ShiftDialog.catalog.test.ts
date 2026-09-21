import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ShiftDialog.tsx"), "utf8");
const dict = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../lib/i18n/dict/worklog.ts"),
  "utf8",
);

describe("ShiftDialog catalog vs entry selection", () => {
  it("Hinzufügen writes Leistungsart to the saved workCodes catalog", () => {
    expect(src).toMatch(/addWorkCodeToCatalog/);
    expect(src).toMatch(/updateSettings\(\{ workCodes: result\.catalog \}\)/);
    expect(src).toMatch(/setWorkCode\(result\.item\.code\)/);
  });

  it("chip × / toggle does not delete saved Leistungsarten", () => {
    expect(src).not.toMatch(/removeCustomCode/);
    expect(src).not.toMatch(/workCodes:\s*customCodes\.filter/);
    expect(src).toMatch(/setWorkCode\(workCode === code \? "" : code\)/);
    expect(src).toMatch(/worklog\.removeFromEntry/);
  });

  it("Hinzufügen writes Tätigkeiten to the saved customTasks catalog", () => {
    expect(src).toMatch(/addCustomTaskToCatalog/);
    expect(src).toMatch(/updateSettings\(\{ customTasks: result\.catalog \}\)/);
    expect(src).toMatch(/settings\.customTasks/);
    expect(src).toMatch(/customTasksCatalog\.map/);
  });

  it("snapshots workCodeLabel so historical entries keep the original text", () => {
    expect(src).toMatch(/snapshotWorkCodeLabel/);
    expect(src).toMatch(/next\.workCodeLabel = label/);
    expect(src).toMatch(/previousLabel:\s*shift\?\.workCodeLabel/);
  });
});

describe("ShiftDialog catalog looks like saved Objects", () => {
  it("separates Standard chips from Meine Leistungsarten / Meine Tätigkeiten", () => {
    expect(src).toMatch(/worklog\.standard/);
    expect(src).toMatch(/worklog\.myWorkCodes/);
    expect(src).toMatch(/worklog\.myTasks/);
    expect(src).toMatch(/worklog\.newWorkCode/);
    expect(src).toMatch(/worklog\.newTask/);
    expect(src).toMatch(/builtinWorkCodes/);
    expect(src).toMatch(/SavedCatalogRows/);
    expect(src).toMatch(/ChevronRight/);
    expect(dict).toMatch(/"Meine Leistungsarten"/);
    expect(dict).toMatch(/"Meine Tätigkeiten"/);
  });

  it("does not mix custom catalog items into the Standard chip row", () => {
    expect(src).toMatch(/builtinCodes\.map/);
    expect(src).not.toMatch(/allCodes\.map/);
  });
});
