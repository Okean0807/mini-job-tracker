import { beforeEach, describe, expect, it, vi } from "vitest";

import { shiftPayroll } from "./payroll";
import { makeResolver } from "./resolve";
import { buildDailyMonthSeries } from "./stats-charts";
import { DEFAULT_SETTINGS } from "./types";
import { F1_JOBS, F1_SHIFTS } from "./__fixtures__/stats-periods";

// shiftPayroll bleibt die echte Implementierung; nur Aufrufe werden beobachtet.
vi.mock("./payroll", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./payroll")>();
  return {
    ...actual,
    shiftPayroll: vi.fn((...args: Parameters<typeof actual.shiftPayroll>) =>
      actual.shiftPayroll(...args),
    ),
  };
});

const resolve = makeResolver(F1_JOBS, { ...DEFAULT_SETTINGS });
const mocked = vi.mocked(shiftPayroll);

describe("B1 buildDailyMonthSeries: Aufrufe der bestehenden Payroll", () => {
  beforeEach(() => {
    mocked.mockClear();
  });

  it("je Monatseintrag genau 1 shiftPayroll-Aufruf mit der vollen Historie (alle Jobs)", () => {
    const sep = F1_SHIFTS.filter((s) => s.date.startsWith("2026-09"));
    buildDailyMonthSeries(2026, 8, sep, resolve, F1_SHIFTS);
    expect(mocked).toHaveBeenCalledTimes(sep.length);
    for (const [shift, options] of mocked.mock.calls) {
      expect(sep).toContain(shift);
      expect(options?.history).toBe(F1_SHIFTS);
      expect(options?.job).toBe(F1_JOBS.find((j) => j.id === shift.jobId));
    }
  });

  it("Job-Filter: nur J1-Einträge bewertet, Historie trotzdem vollständig", () => {
    const j1 = F1_SHIFTS.filter((s) => s.date.startsWith("2026-09") && s.jobId === "J1");
    buildDailyMonthSeries(2026, 8, j1, resolve, F1_SHIFTS);
    expect(mocked).toHaveBeenCalledTimes(j1.length);
    for (const [, options] of mocked.mock.calls) {
      expect(options?.history).toBe(F1_SHIFTS);
      expect(options?.history).toHaveLength(F1_SHIFTS.length);
    }
  });

  it("Einträge außerhalb des Monats werden nicht bewertet", () => {
    buildDailyMonthSeries(2026, 8, F1_SHIFTS, resolve, F1_SHIFTS);
    const sepCount = F1_SHIFTS.filter((s) => s.date.startsWith("2026-09")).length;
    expect(mocked).toHaveBeenCalledTimes(sepCount);
  });
});
