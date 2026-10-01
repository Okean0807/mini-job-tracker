import { describe, expect, it } from "vitest";
import { findWageViolations } from "./wage-compliance";
import type { Job, Shift } from "./types";

const cleaning: Job = { id: "j", name: "Cleaning", color: "#000", mode: "flex", rate: 14, industrySectorId: "gebaeudereinigung", industryGroupId: "lg1" };
const other: Job = { id: "o", name: "Other", color: "#000", mode: "flex", rate: 13.9 };
const shift = (id: string, date: string, jobId: string, rate?: number): Shift => ({ id, date, start: "09:00", end: "10:00", breakMinutes: 0, jobId, rate, kind: "actual" });

describe("wage compliance", () => {
  it("uses the industry floor for cleaning LG1", () => {
    const result = findWageViolations([shift("1", "2026-09-30", "j")], [cleaning], 13.9);
    expect(result).toHaveLength(1);
    expect(result[0].result.industryMinimumWage).toBe(15);
    expect(result[0].result.bindingMinimumWage).toBe(15);
  });

  it("does not flag a compliant general-minimum-wage job", () => {
    expect(findWageViolations([shift("1", "2026-09-30", "o")], [other], 13.9)).toHaveLength(0);
  });

  it("can restrict the scan to a dashboard-relevant period", () => {
    const shifts = [shift("1", "2026-09-30", "j"), shift("2", "2026-08-31", "j")];
    const result = findWageViolations(shifts, [cleaning], 13.9, (s) => s.date >= "2026-09-01");
    expect(result.map((v) => v.shift.id)).toEqual(["1"]);
  });
});

it("uses the same monthly-job hourly derivation as payroll when no shift rate exists", () => {
  const monthly: Job = {
    id: "m",
    name: "Monthly",
    color: "#000",
    mode: "fest",
    payType: "monthly",
    monthlyGross: 2600,
    week: Array.from({ length: 7 }, (_, i) => ({
      day: i,
      active: i < 5,
      start: "08:00",
      end: "16:00",
      breakMinutes: 60,
    })),
    industrySectorId: "gebaeudereinigung",
    industryGroupId: "lg1",
  };
  // 35h/week => about 15.38 EUR/h. Must use the derived rate, not default/job.rate.
  const result = findWageViolations([shift("m1", "2026-09-30", "m")], [monthly], 13.9);
  expect(result).toHaveLength(0);
});
