import { describe, expect, it } from "vitest";
import { monthUsage, yearUsage } from "../limits";
import { limitStatus } from "../notify";
import { makeResolver } from "../resolve";
import { DEFAULT_SETTINGS, type Job, type Shift } from "../types";

const job: Job = {
  id: "mj",
  name: "Minijob",
  mode: "flex",
  employmentType: "minijob",
  rate: 15,
  color: "#000",
};

const shift = (id: string, date: string, hours: number): Shift => ({
  id,
  date,
  start: "00:00",
  end: `${String(hours).padStart(2, "0")}:00`,
  breakMinutes: 0,
  jobId: job.id,
  kind: "arbeit",
});

describe("legal engine cross-surface consistency", () => {
  it("uses the same actual annual income and limit in year usage", () => {
    const settings = { ...DEFAULT_SETTINGS, limitAuto: true };
    const shifts = [shift("1", "2026-09-10", 20)];
    const resolve = makeResolver([job], settings);
    const usage = yearUsage(shifts, resolve, settings, 2026, "2026-09-30");

    expect(usage.earnings).toBeGreaterThan(0);
    expect(usage.earningsLimit).toBe(7236);
    expect(usage.earningsShare).toBeCloseTo((usage.earnings / 7236) * 100, 8);
  });

  it("keeps future income out of actual usage and puts it into projection", () => {
    const settings = { ...DEFAULT_SETTINGS, limitAuto: true };
    const shifts = [
      shift("1", "2026-09-10", 20),
      shift("2", "2026-09-30", 20),
    ];
    const resolve = makeResolver([job], settings);
    const usage = monthUsage(shifts, resolve, settings, 2026, 8, "2026-09-15");

    expect(usage.earnings).toBeGreaterThan(0);
    expect(usage.expectedAdditional).toBeGreaterThan(0);
    expect(usage.projectedEarnings).toBeCloseTo(usage.earnings + usage.expectedAdditional, 8);
    expect(usage.earnings).toBeLessThan(usage.projectedEarnings);
  });
});
