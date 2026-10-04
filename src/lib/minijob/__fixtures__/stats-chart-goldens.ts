/**
 * Golden-Prüfungen für die Tagesdiagramme der Statistik (S2 / B1). Nur für Tests.
 *
 * Quelle: QA_ACCEPTANCE.md (AC-C-07) – F1, September 2026:
 * Payroll 822,32 € / 49 h (alter Diagrammwert: 858 € / 60 h = Dauer × Satz),
 * Urlaub 15.09. 58,82 € (4,36 h bezahlte Abwesenheit, 0 h gearbeitet),
 * Krank 21.09. 60,00 €, Frei 26.09. 0 €.
 */
import { expect } from "vitest";

import { payrollTotals } from "../payroll";
import { makeResolver } from "../resolve";
import { buildDailyMonthSeries, type DailyChartPoint } from "../stats-charts";
import { DEFAULT_SETTINGS } from "../types";
import { F1_JOBS, F1_SHIFTS, F3_SHIFTS } from "./stats-periods";

export const f1Resolve = makeResolver(F1_JOBS, { ...DEFAULT_SETTINGS });

export const sumSeries = (series: readonly DailyChartPoint[]) => ({
  verdienst: Math.round(series.reduce((a, p) => a + p.verdienst, 0) * 100) / 100,
  stunden: Math.round(series.reduce((a, p) => a + p.stunden, 0) * 100) / 100,
});

export const pointAt = (series: readonly DailyChartPoint[], date: string) => {
  const p = series.find((x) => x.date === date);
  if (!p) throw new Error(`kein Punkt für ${date}`);
  return p;
};

/** Golden-Werte F1 Sep 2026 + DST (F3) – unabhängig von der Prozess-Zeitzone. */
export function assertChartGoldens(): void {
  const sep = buildDailyMonthSeries(2026, 8, F1_SHIFTS, f1Resolve, F1_SHIFTS);
  expect(sep).toHaveLength(30);
  expect(sep.map((p) => p.date)).toEqual(
    Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`),
  );
  expect(sumSeries(sep)).toEqual({ verdienst: 822.32, stunden: 49 });
  expect(pointAt(sep, "2026-09-15")).toMatchObject({ verdienst: 58.82, stunden: 0 });
  expect(pointAt(sep, "2026-09-21")).toMatchObject({ verdienst: 60, stunden: 0 });
  expect(pointAt(sep, "2026-09-26")).toMatchObject({ verdienst: 0, stunden: 0 });
  const sepPayroll = payrollTotals(
    F1_SHIFTS.filter((s) => s.date.startsWith("2026-09")),
    f1Resolve,
    F1_SHIFTS,
  );
  expect(sumSeries(sep).verdienst).toBeCloseTo(sepPayroll.earnings, 2);
  expect(sumSeries(sep).stunden).toBeCloseTo(sepPayroll.workedHours, 2);

  // DST-Ende 25.10.2026 (Berlin 25 h): Tag genau einmal, 26.10. vorhanden, 31 Punkte.
  const oct = buildDailyMonthSeries(2026, 9, F3_SHIFTS, f1Resolve, F3_SHIFTS);
  expect(oct).toHaveLength(31);
  expect(oct.filter((p) => p.date === "2026-10-25")).toHaveLength(1);
  expect(oct.filter((p) => p.date === "2026-10-26")).toHaveLength(1);
  expect(pointAt(oct, "2026-10-25")).toMatchObject({ day: 25, verdienst: 135, stunden: 10 });
  expect(pointAt(oct, "2026-10-26")).toMatchObject({ verdienst: 0, stunden: 0 });
  expect(new Set(oct.map((p) => p.date)).size).toBe(31);

  // DST-Beginn 29.03.2026 (Berlin 23 h).
  const mar = buildDailyMonthSeries(2026, 2, F3_SHIFTS, f1Resolve, F3_SHIFTS);
  expect(mar).toHaveLength(31);
  expect(pointAt(mar, "2026-03-29")).toMatchObject({ day: 29, verdienst: 27, stunden: 2 });
  expect(pointAt(mar, "2026-03-30")).toMatchObject({ day: 30 });
  expect(pointAt(mar, "2026-03-31")).toMatchObject({ day: 31 });
}
