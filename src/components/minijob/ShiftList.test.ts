import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ShiftList.tsx"), "utf8");

describe("ShiftList selected-day work blocks", () => {
  it("is a selected-day list with + Eintrag, not a month-wide competing list", () => {
    expect(src).toMatch(/data-testid="day-shift-list"/);
    expect(src).toMatch(/data-testid="day-shift-block"/);
    expect(src).toMatch(/data-testid="add-day-entry"/);
    expect(src).toMatch(/data-shift-id=\{s\.id\}/);
    expect(src).toMatch(/onAdd/);
    expect(src).toMatch(/onSelect/);
    expect(src).not.toMatch(/dash\.entriesInMonth/);
    expect(src).not.toMatch(/formatEuro/);
    expect(src).not.toMatch(/shiftPayroll/);
  });

  it("renders time, address, Leistungsart and Tätigkeiten from the Shift", () => {
    expect(src).toMatch(/dayBlockAddress/);
    expect(src).toMatch(/dayBlockLeistungsart/);
    expect(src).toMatch(/s\.tasks/);
    expect(src).toMatch(/list\.taskLine/);
    expect(src).toMatch(/s\.start.*s\.end/);
  });

  it("opens the existing Shift on block click and creates a new one via onAdd", () => {
    expect(src).toMatch(/onSelect\(s\)/);
    expect(src).toMatch(/stopPropagation/);
    expect(src).toMatch(/onClick=\{onAdd\}/);
  });
});

describe("ShiftList day details below the calendar", () => {
  it("renders an optional day summary between the entries and + Eintrag", () => {
    expect(src).toMatch(/summary\?: ReactNode/);
    expect(src).toMatch(/data-testid="day-summary"/);
    expect(src.indexOf('data-testid="day-summary"')).toBeLessThan(
      src.indexOf('data-testid="add-day-entry"'),
    );
    // totals stay a dashboard concern — the list never recomputes payroll
    expect(src).not.toMatch(/formatEuro/);
    expect(src).not.toMatch(/shiftPayroll/);
  });

  it("shows the holiday name that left the calendar cell", () => {
    expect(src).toMatch(/data-testid="day-holiday-name"/);
    expect(src).toMatch(/holiday\?: string \| undefined/);
  });
});
