import { beforeEach, describe, expect, it, vi } from "vitest";

import { shiftPayroll } from "./payroll";
import { aggregateRange, bucketByDay, groupBy } from "./period-aggregate";
import { monthPeriod, weekPeriod } from "./period";
import { evaluateShifts, payrollAggregateOptions } from "./period-payroll";
import { makeResolver } from "./resolve";
import { DEFAULT_SETTINGS } from "./types";
import { F1_JOBS, F1_SHIFTS } from "./__fixtures__/stats-periods";

// shiftPayroll bleibt die echte Implementierung; nur Aufrufe werden gezählt.
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

describe("period-payroll: Aufrufe der bestehenden Payroll", () => {
  beforeEach(() => {
    mocked.mockClear();
  });

  it("evaluateShifts: genau 1 shiftPayroll-Aufruf je Schicht, immer mit der übergebenen vollen Historie", () => {
    const sep = F1_SHIFTS.filter((s) => s.date.startsWith("2026-09"));
    evaluateShifts(sep, resolve, F1_SHIFTS);
    expect(mocked).toHaveBeenCalledTimes(sep.length);
    for (const [shift, options] of mocked.mock.calls) {
      expect(sep).toContain(shift);
      expect(options?.history).toBe(F1_SHIFTS);
    }
  });

  it("Aggregation (Periodenwechsel, Tage, Gruppen) ruft die Payroll nicht erneut auf", () => {
    const evaluated = evaluateShifts(F1_SHIFTS, resolve, F1_SHIFTS);
    expect(mocked).toHaveBeenCalledTimes(F1_SHIFTS.length);
    mocked.mockClear();
    const opts = payrollAggregateOptions("2026-10-04");
    for (let m = 0; m < 12; m++) aggregateRange(monthPeriod(2026, m), evaluated, opts);
    for (let w = 1; w <= 53; w++) aggregateRange(weekPeriod(2026, w), evaluated, opts);
    bucketByDay(monthPeriod(2026, 8), evaluated, opts);
    groupBy(evaluated, (e) => e.shift.jobId ?? "none", opts);
    expect(mocked).not.toHaveBeenCalled();
  });
});
