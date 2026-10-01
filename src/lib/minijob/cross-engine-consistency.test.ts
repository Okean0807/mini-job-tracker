import { describe, expect, it } from "vitest";
import { payrollTotals, shiftPayroll } from "./payroll";
import { checkShiftWageFromRate } from "./wage-compliance";
import { effectiveShiftRate } from "./rate";
import type { Job, Shift } from "./types";

const job: Job = {
  id: "cleaning",
  name: "Cleaning",
  color: "#000",
  mode: "flex",
  rate: 15.5,
  industrySectorId: "gebaeudereinigung",
  industryGroupId: "lg1",
};

const shift: Shift = {
  id: "s1",
  date: "2026-09-30",
  start: "09:00",
  end: "13:30",
  breakMinutes: 30,
  jobId: job.id,
  kind: "actual",
};

describe("cross-engine rate consistency", () => {
  it("uses one effective hourly rate for payroll and wage compliance", () => {
    const defaultRate = 13.9;
    const rate = effectiveShiftRate(shift, { job, defaultRate });
    const payroll = shiftPayroll(shift, { job, defaultRate });
    const compliance = checkShiftWageFromRate(shift.date, shift, job, defaultRate);

    expect(rate).toBe(job.rate);
    expect(payroll.base).toBeCloseTo(4 * rate);
    expect(compliance.actualRate).toBe(rate);
    expect(compliance.bindingMinimumWage).toBe(15);
    expect(compliance.compliant).toBe(true);
  });

  it("keeps payroll totals equal to the sum of the same per-shift payroll results", () => {
    const second: Shift = { ...shift, id: "s2", date: "2026-09-29", start: "10:00", end: "12:00" };
    const shifts = [shift, second];
    const resolve = (s: Shift) => ({ job, defaultRate: 13.9 });
    const totals = payrollTotals(shifts, resolve, shifts);
    const expected = shifts.reduce((sum, s) => sum + shiftPayroll(s, resolve(s)).earnings, 0);

    expect(totals.earnings).toBeCloseTo(expected, 10);
  });
});
