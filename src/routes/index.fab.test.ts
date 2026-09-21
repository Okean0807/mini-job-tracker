import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.tsx"), "utf8");
const shiftDialog = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/minijob/ShiftDialog.tsx"),
  "utf8",
);

describe("Dashboard FAB (pre-release)", () => {
  it("removes floating Urlaub/Krank AbsenceDialog trigger", () => {
    expect(src).not.toMatch(/t\("dash\.absence"\)/);
    expect(src).not.toMatch(/Palmtree/);
    expect(src).toMatch(/dash-fab fixed/);
    expect(src.match(/dash\.newEntry/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("keeps + Eintrag FAB and ShiftDialog for the selected calendar date", () => {
    expect(src).toMatch(/t\("dash\.newEntry"\)/);
    expect(src).toMatch(/openNew\(selectedDate\)/);
    expect(src).not.toMatch(/openNew\(isoDate\(new Date\(\)\)\)/);
    expect(src).toMatch(/ShiftDialog/);
  });

  it("ShiftDialog still offers Arbeit|Urlaub|Krank|Feiertag|Frei|Sonstige; new absence routes to AbsenceDialog", () => {
    expect(shiftDialog).toMatch(/"arbeit"/);
    expect(shiftDialog).toMatch(/"urlaub"/);
    expect(shiftDialog).toMatch(/"krank"/);
    expect(shiftDialog).toMatch(/"feiertag"/);
    expect(shiftDialog).toMatch(/"frei"/);
    expect(shiftDialog).toMatch(/"sonstige"/);
    expect(shiftDialog).toMatch(/onRequestAbsence/);
    expect(src).toMatch(/onRequestAbsence=\{requestAbsence\}/);
  });

  it("AbsenceDialog remains for new range absences from the kind picker", () => {
    expect(src).toMatch(/AbsenceDialog/);
  });
});

describe("Dashboard selected-day grouping", () => {
  it("calendar click only selects the date — does not auto-open a Shift", () => {
    expect(src).toMatch(/onSelectDay=\{setSelectedDate\}/);
    expect(src).not.toMatch(/hasArbeitOrOther/);
    expect(src).not.toMatch(/shifts\.filter\(\(s\) => s\.date === date\)/);
  });

  it("day list edits the exact Shift; + Eintrag opens a new Shift for the selected date", () => {
    expect(src).toMatch(/onSelect=\{openEdit\}/);
    expect(src).toMatch(/onAdd=\{\(\) => openNew\(selectedDate\)\}/);
    expect(src).toMatch(/shiftsOnDate\(shifts, selectedDate\)/);
    expect(src).toMatch(/selectedDate=\{selectedDate\}/);
  });

  it("does not render a second competing month list when the calendar is visible", () => {
    expect(src).toMatch(/id === "shifts" && calendarVisible/);
    expect(src).not.toMatch(/dash\.entriesInMonth/);
  });

  it("ShiftDialog distinguishes edit vs new mode", () => {
    expect(shiftDialog).toMatch(/data-mode=\{shift \? "edit" : "new"\}/);
    expect(shiftDialog).toMatch(/data-testid="shift-dialog"/);
  });
});
