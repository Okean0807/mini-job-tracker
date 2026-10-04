/**
 * Zeitzonen-unabhängige Golden-Checks (Kalender + F1-Payroll-Aggregation).
 * Wird von `period.tz-matrix.test.ts` (Berlin / Los Angeles / Kiritimati im
 * selben Prozess) und `period.tz-la.test.ts` (Vitest-Projekt "tz-la") genutzt.
 * Nur für Tests.
 */
import { expect } from "vitest";

import { eachDateKey } from "../date-key";
import { isoWeekEnd, isoWeekOf, isoWeekRange, isoWeekStart, isoWeeksInYear } from "../iso-week";
import { daysInPeriod, monthPeriod, periodContaining, weekPeriod } from "../period";
import { aggregateRange, countWorkDays } from "../period-aggregate";
import { evaluateShifts, payrollAggregateOptions } from "../period-payroll";
import { payrollTotals } from "../payroll";
import { makeResolver } from "../resolve";
import { DEFAULT_SETTINGS } from "../types";
import { F1_JOBS, F1_SHIFTS, F3_SHIFTS } from "./stats-periods";

/** T-ISO (QA_ACCEPTANCE §4.2): Datum → ISO-Woche / Wochenjahr / Montag. */
export const T_ISO: readonly (readonly [string, number, number, string])[] = [
  ["2025-12-28", 52, 2025, "2025-12-22"],
  ["2025-12-29", 1, 2026, "2025-12-29"],
  ["2026-01-01", 1, 2026, "2025-12-29"],
  ["2026-01-04", 1, 2026, "2025-12-29"],
  ["2026-01-05", 2, 2026, "2026-01-05"],
  ["2026-03-23", 13, 2026, "2026-03-23"],
  ["2026-03-29", 13, 2026, "2026-03-23"],
  ["2026-03-30", 14, 2026, "2026-03-30"],
  ["2026-10-19", 43, 2026, "2026-10-19"],
  ["2026-10-25", 43, 2026, "2026-10-19"],
  ["2026-10-26", 44, 2026, "2026-10-26"],
  ["2026-12-28", 53, 2026, "2026-12-28"],
  ["2026-12-31", 53, 2026, "2026-12-28"],
  ["2027-01-01", 53, 2026, "2026-12-28"],
  ["2027-01-03", 53, 2026, "2026-12-28"],
  ["2027-01-04", 1, 2027, "2027-01-04"],
  ["2027-12-31", 52, 2027, "2027-12-27"],
  ["2028-01-01", 52, 2027, "2027-12-27"],
  ["2028-01-02", 52, 2027, "2027-12-27"],
  ["2028-01-03", 1, 2028, "2028-01-03"],
  ["2028-02-28", 9, 2028, "2028-02-28"],
  ["2028-02-29", 9, 2028, "2028-02-28"],
  ["2028-03-01", 9, 2028, "2028-02-28"],
  ["2028-12-31", 52, 2028, "2028-12-25"],
  ["2029-01-01", 1, 2029, "2029-01-01"],
];

export const WEEKS_IN_YEAR: readonly (readonly [number, number])[] = [
  [2015, 53],
  [2020, 53],
  [2025, 52],
  [2026, 53],
  [2027, 52],
  [2028, 52],
  [2029, 52],
  [2032, 53],
];

const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 9);

/** Führt alle TZ-sensitiven Golden-Prüfungen in der aktuellen Prozess-TZ aus. */
export function assertCalendarGoldens(): void {
  for (const [date, week, isoYear, monday] of T_ISO) {
    expect(isoWeekOf(date), date).toEqual({ isoYear, week });
    expect(isoWeekStart(date), date).toBe(monday);
  }
  for (const [year, n] of WEEKS_IN_YEAR) expect(isoWeeksInYear(year), String(year)).toBe(n);
  expect(isoWeekRange(2026, 53)).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  expect(isoWeekEnd("2027-01-01")).toBe("2027-01-03");

  // DST-Wochen: 7 eindeutige Tage, Montag–Sonntag.
  expect(daysInPeriod(weekPeriod(2026, 43))).toEqual([
    "2026-10-19",
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
  ]);
  expect(new Set(daysInPeriod(weekPeriod(2026, 13))).size).toBe(7);
  expect(daysInPeriod(periodContaining("week", "2026-10-25"))).toHaveLength(7);
  expect(daysInPeriod(monthPeriod(2026, 9))).toHaveLength(31);
  expect(daysInPeriod(monthPeriod(2028, 1))).toHaveLength(29);
  expect(eachDateKey({ start: "2026-10-24", end: "2026-10-27" })).toEqual([
    "2026-10-24",
    "2026-10-25",
    "2026-10-26",
    "2026-10-27",
  ]);

  // F1 September 2026 über die bestehende Payroll (volle Historie).
  const resolve = makeResolver(F1_JOBS, { ...DEFAULT_SETTINGS });
  const evaluated = evaluateShifts(F1_SHIFTS, resolve, F1_SHIFTS);
  const sep = aggregateRange(monthPeriod(2026, 8), evaluated, payrollAggregateOptions());
  close(sep.values.earnings, 822.3214285714);
  close(sep.values.workedHours, 49);
  expect(sep.count).toBe(15);
  const kw40 = aggregateRange(weekPeriod(2026, 40), evaluated, payrollAggregateOptions());
  close(kw40.values.earnings, 201);
  close(kw40.values.workedHours, 14);
  expect(countWorkDays(F1_SHIFTS, { start: "2026-01-01", end: "2026-12-31" })).toBe(20);

  // F3: DST-Schichten nach Wanduhr (bestehende Konvention), Nachtschicht So→Mo am Sonntag.
  const r3 = makeResolver(F1_JOBS, { ...DEFAULT_SETTINGS });
  const ev3 = evaluateShifts(F3_SHIFTS, r3, F3_SHIFTS);
  const kw43 = aggregateRange(weekPeriod(2026, 43), ev3, payrollAggregateOptions());
  close(kw43.values.workedHours, 10);
  close(kw43.values.earnings, 135);
  const kw44 = aggregateRange(weekPeriod(2026, 44), ev3, payrollAggregateOptions());
  expect(kw44.count).toBe(0);
  close(payrollTotals(F3_SHIFTS.slice(0, 1), r3, F3_SHIFTS).workedHours, 2);
}
