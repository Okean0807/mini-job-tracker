/**
 * AUD-09C – one earnings calculation everywhere.
 *
 * `assessLegalIncome` used to build its own resolver with `holiday: false`, so a shift on a
 * public holiday counted without its holiday supplement in the rolling 12-month figures (200 EUR)
 * while the month card counted it with the supplement (400 EUR). Holiday status now comes from the
 * existing calendar logic (`isHoliday(date, settings.bundesland)` inside `makeResolver`) for every
 * calculation: monthly income, rolling 12-month income, annual statistics and the legal
 * calculation inputs.
 */
import { describe, expect, it } from "vitest";

import { assessLegalIncome } from "./legal";
import {
  buildMonthlyIncomeFromShifts,
  legalActualIncomeForMonth,
  legalActualIncomeForYear,
} from "./legal/integration";
import { monthUsage, yearUsage } from "./limits";
import { payrollTotals } from "./payroll";
import { makeResolver } from "./resolve";
import { statsLegalYearUsage } from "./stats-legal";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SUPPLEMENTS,
  type AppData,
  type Job,
  type Settings,
  type Shift,
} from "./types";

const supplements = {
  ...DEFAULT_SUPPLEMENTS,
  holiday: { enabled: true, mode: "prozent" as const, value: 100 },
};
const job: Job = {
  id: "a",
  name: "A",
  color: "#000",
  mode: "flex",
  employmentType: "minijob",
  rate: 20,
};
const settingsFor = (bundesland: string): Settings => ({
  ...DEFAULT_SETTINGS,
  limitAuto: true,
  bundesland,
  supplements,
});
// 10 h x 20 EUR = 200 EUR; with the 100 % holiday supplement 400 EUR
const day = (date: string): Shift[] => [
  { id: "h", jobId: "a", kind: "arbeit", date, start: "08:00", end: "18:00", breakMinutes: 0 },
];

/** Gross earnings of one shift according to every calculation the app uses. */
function everywhere(shifts: Shift[], settings: Settings) {
  const date = shifts[0]!.date;
  const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1];
  const ref = `${y}-12-31`;
  const resolve = makeResolver([job], settings);
  const data = { jobs: [job], shifts, settings } as AppData;
  const key = `${date.slice(0, 7)}-01`;
  const assessed = assessLegalIncome(data, key, ref);
  return {
    payrollTotals: payrollTotals(shifts, resolve).earnings,
    monthCard: monthUsage(shifts, resolve, settings, y, m, ref).earnings,
    yearCard: yearUsage(shifts, resolve, settings, y, ref).earnings,
    statsYear: statsLegalYearUsage(shifts, resolve, settings, y, ref).earnings,
    legalMonth: legalActualIncomeForMonth(shifts, resolve, y, m, ref),
    legalYear: legalActualIncomeForYear(shifts, resolve, y, ref),
    monthlyIncome: buildMonthlyIncomeFromShifts(shifts, resolve, ref).find((x) => x.date === key)
      ?.actual,
    rollingMonth: assessed.months.find((x) => x.date === key)?.actual,
    rollingActual: assessed.rolling.months.reduce((sum, x) => sum + x.actual, 0),
    rollingTotal: assessed.rolling.projectedEarnings,
  };
}
const allEqual = (o: Record<string, number | undefined>, expected: number) => {
  for (const [name, value] of Object.entries(o)) expect(value, name).toBeCloseTo(expected, 6);
};

describe("holiday earnings are identical across all calculations", () => {
  it("a shift on a public holiday (25 Dec) counts WITH the holiday supplement everywhere (400 EUR)", () => {
    allEqual(everywhere(day("2026-12-25"), settingsFor("NI")), 400);
  });

  it("the same shift on a normal day counts 200 EUR everywhere", () => {
    allEqual(everywhere(day("2026-12-23"), settingsFor("NI")), 200);
  });

  it("a state-specific holiday follows the user's federal state (6 Jan: BY yes, NI no)", () => {
    allEqual(everywhere(day("2026-01-06"), settingsFor("BY")), 400);
    allEqual(everywhere(day("2026-01-06"), settingsFor("NI")), 200);
  });

  it("holiday status is not hardcoded: it comes from the calendar for the shift's own date", () => {
    // two shifts in one month: one holiday, one normal day
    const shifts: Shift[] = [
      ...day("2026-12-25"),
      {
        id: "n",
        jobId: "a",
        kind: "arbeit",
        date: "2026-12-23",
        start: "08:00",
        end: "18:00",
        breakMinutes: 0,
      },
    ];
    const settings = settingsFor("NI");
    const resolve = makeResolver([job], settings);
    const rolling = assessLegalIncome(
      { jobs: [job], shifts, settings } as AppData,
      "2026-12-01",
      "2026-12-31",
    ).rolling;
    expect(rolling.projectedEarnings).toBe(600);
    expect(monthUsage(shifts, resolve, settings, 2026, 11, "2026-12-31").earnings).toBe(600);
  });

  it("a holiday-dated shift entered for later counts with its supplement in the planned figure too", () => {
    const settings = settingsFor("NI");
    const rolling = assessLegalIncome(
      { jobs: [job], shifts: day("2026-12-25"), settings } as AppData,
      "2026-12-01",
      "2026-12-10",
    ).rolling;
    expect(rolling.months.reduce((sum, x) => sum + x.expectedAdditional, 0)).toBe(400);
    expect(rolling.months.reduce((sum, x) => sum + x.actual, 0)).toBe(0);
  });
});
