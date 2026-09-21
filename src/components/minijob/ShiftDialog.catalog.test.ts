import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ShiftDialog.tsx"), "utf8");

describe("ShiftDialog follows Objects pattern for Leistungsart/Tätigkeiten", () => {
  it("does not implement a separate catalog-management UI", () => {
    expect(src).not.toMatch(/SavedCatalogPanel/);
    expect(src).not.toMatch(/worklog\.myWorkCodesEmpty/);
    expect(src).not.toMatch(/worklog\.myTasksEmpty/);
    expect(src).not.toMatch(/worklog\.myWorkCodes/);
    expect(src).not.toMatch(/worklog\.myTasks/);
    expect(src).not.toMatch(/worklog\.workCodeNotePlaceholder/);
    expect(src).not.toMatch(/addWorkCodeToCatalog/);
    expect(src).not.toMatch(/addCustomTaskToCatalog/);
    expect(src).not.toMatch(/updateSettings/);
    expect(src).not.toMatch(/removeCustomCode/);
  });

  it("uses Code + Bezeichnung as the current-entry Leistungsart fields", () => {
    expect(src).toMatch(/worklog\.codeShort/);
    expect(src).toMatch(/worklog\.codeLabel/);
    expect(src).toMatch(/selectWorkDef/);
    expect(src).toMatch(/setNewCode/);
    expect(src).toMatch(/setNewCodeLabel/);
    expect(src).toMatch(/next\.workCode = code/);
    expect(src).toMatch(/next\.workCodeLabel = label/);
    expect(src).toMatch(/snapshotWorkCodeLabel/);
  });

  it("Eigene Tätigkeit is the current-entry input; catalog is learned on save", () => {
    expect(src).toMatch(/worklog\.customTask/);
    expect(src).toMatch(/addTaskToEntry/);
    expect(src).toMatch(/findPredefinedTaskValue/);
    expect(src).toMatch(/next\.tasks = entryTasks/);
    expect(src).toMatch(/pendingTask/);
  });

  it("chip toggle removes the value from this entry only", () => {
    expect(src).toMatch(/setWorkCode\(""\)/);
    expect(src).toMatch(/setNewCode\(""\)/);
    expect(src).toMatch(/setNewCodeLabel\(""\)/);
    expect(src).toMatch(/setTasks\(active \? tasks\.filter/);
    expect(src).not.toMatch(/workCodes:\s*customCodes\.filter/);
    expect(src).not.toMatch(/customTasks:\s*customTasksCatalog\.filter/);
  });

  it("shows standard chips plus saved custom chips without an empty Meine card", () => {
    expect(src).toMatch(/builtinCodes\.map/);
    expect(src).toMatch(/customCodes\.map/);
    expect(src).toMatch(/visibleCustomTasks\.map/);
    expect(src).not.toMatch(/allCodes\.map/);
    expect(src).not.toMatch(/rounded-2xl border bg-card p-3 shadow-card/);
  });
});
