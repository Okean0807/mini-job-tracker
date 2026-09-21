import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ShiftDialog.tsx"), "utf8");

describe("ShiftDialog Feiertag default (CAL-P2)", () => {
  it("preserves existing shift.kind and defaults new holiday days to feiertag", () => {
    expect(src).toMatch(/resolveEntryDate/);
    expect(src).toMatch(/entryDate/);
    expect(src).toMatch(/source\?\.kind/);
    expect(src).toMatch(/holidayDefault/);
    expect(src).toMatch(/holidayName\((?:entryDate|initialDate),\s*settings\.bundesland\)\s*\?\s*"feiertag"/);
  });
});

describe("ShiftDialog work-on-holiday pay (Batch B)", () => {
  it("forces arbeit when times change on a holiday and shows pay hint", () => {
    expect(src).toMatch(/onStartChange/);
    expect(src).toMatch(/setKind\("arbeit"\)/);
    expect(src).toMatch(/holiday-pay-hint/);
    expect(src).toMatch(/shift\.markAsWorked/);
    expect(src).toMatch(/shiftPayroll/);
  });
});
