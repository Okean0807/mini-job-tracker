import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ShiftDialog.tsx"), "utf8");
const jobsSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../routes/jobs.tsx"),
  "utf8",
);

describe("ShiftDialog follows Objects pattern for Leistungsart/Tätigkeiten", () => {
  it("uses the same select + fields pattern as Objekt", () => {
    expect(src).toMatch(/object\.select/);
    expect(src).toMatch(/applyObjectSelection/);
    expect(src).toMatch(/applyWorkCodeSelection/);
    expect(src).toMatch(/applyWorkCodeToFormFields/);
    expect(src).toMatch(/applyTaskSelection/);
    expect(src).toMatch(/data-testid="work-code-select"/);
    expect(src).toMatch(/data-testid="task-select"/);
    expect(src).toMatch(/worklog\.none/);
    expect(src).toMatch(/worklog\.chooseTask/);
    expect(src).toMatch(/<optgroup label=\{t\("worklog\.standard"\)\}>/);
    expect(src).toMatch(/<optgroup label=\{t\("worklog\.saved"\)\}>/);
  });

  it("does not implement a separate catalog-management UI in the entry", () => {
    expect(src).not.toMatch(/SavedCatalogPanel/);
    expect(src).not.toMatch(/worklog\.myWorkCodesEmpty/);
    expect(src).not.toMatch(/worklog\.myTasksEmpty/);
    expect(src).not.toMatch(/addWorkCodeToCatalog/);
    expect(src).not.toMatch(/addCustomTaskToCatalog/);
    expect(src).not.toMatch(/updateSettings/);
    expect(src).not.toMatch(/removeCustomCode/);
    expect(src).not.toMatch(/selectWorkDef/);
  });

  it("uses Code + Bezeichnung as the current-entry Leistungsart fields", () => {
    expect(src).toMatch(/worklog\.codeShort/);
    expect(src).toMatch(/worklog\.codeLabel/);
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

  it("clearing the select removes the value from this entry only", () => {
    expect(src).toMatch(/setWorkCode\(""\)/);
    expect(src).toMatch(/setNewCode\(""\)/);
    expect(src).toMatch(/setNewCodeLabel\(""\)/);
    expect(src).toMatch(/setTasks\(tasks\.filter/);
    expect(src).toMatch(/worklog\.removeFromEntry/);
    expect(src).not.toMatch(/workCodes:\s*customCodes\.filter/);
    expect(src).not.toMatch(/deleteWorkCodeDef/);
    expect(src).not.toMatch(/deleteCustomTask/);
  });

  it("edit/delete of saved values lives on the Jobs page like ObjectsCard", () => {
    expect(jobsSrc).toMatch(/ObjectsCard/);
    expect(jobsSrc).toMatch(/WorkCodesCard/);
    expect(jobsSrc).toMatch(/CustomTasksCard/);
  });
});
