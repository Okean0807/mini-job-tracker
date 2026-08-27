import {
  MONTHS_DE,
  formatDateDE,
  shiftHours,
  shiftsInMonth,
  shiftsInYear,
} from "./calc";
import { payrollTotals } from "./payroll";
import type { ResolveOptions } from "./resolve";
import type { Shift } from "./types";

export interface Insights {
  monthHours: number;
  monthEarnings: number;
  avgRate: number;
  bestDay: { date: string; label: string; earnings: number } | null;
  bestMonth: { month: number; label: string; earnings: number } | null;
  entries: number;
}

type Resolver = (shift: Shift) => ResolveOptions;

/** Monatsauswertung inkl. bester Tag und bestem Monat des Jahres. */
export function buildInsights(
  shifts: Shift[],
  year: number,
  month: number,
  resolve: Resolver,
): Insights {
  const monthShifts = shiftsInMonth(shifts, year, month);
  // Bezahlte Abwesenheit erzeugt Entgelt, aber keine geleisteten Stunden.
  const totals = payrollTotals(monthShifts, resolve, shifts);
  const monthHours = totals.workedHours;
  const monthEarnings = totals.earnings;

  const byDay = new Map<string, number>();
  for (const s of monthShifts) {
    byDay.set(s.date, (byDay.get(s.date) ?? 0) + payrollTotals([s], resolve, shifts).earnings);
  }
  let bestDay: Insights["bestDay"] = null;
  for (const [date, earnings] of byDay) {
    if (!bestDay || earnings > bestDay.earnings) {
      bestDay = { date, label: formatDateDE(date), earnings };
    }
  }

  const yearShifts = shiftsInYear(shifts, year);
  let bestMonth: Insights["bestMonth"] = null;
  for (let m = 0; m < 12; m++) {
    const earnings = payrollTotals(shiftsInMonth(yearShifts, year, m), resolve, shifts).earnings;
    if (earnings > 0 && (!bestMonth || earnings > bestMonth.earnings)) {
      bestMonth = { month: m, label: MONTHS_DE[m]!, earnings };
    }
  }

  return {
    monthHours,
    monthEarnings,
    avgRate: monthHours > 0 ? totals.workEarnings / monthHours : 0,
    bestDay,
    bestMonth,
    entries: monthShifts.length,
  };
}

/** Durchschnittliche Stunden pro Arbeitstag im Monat. */
export function averageDayHours(shifts: Shift[]): number {
  const days = new Set(shifts.map((s) => s.date));
  if (days.size === 0) return 0;
  return shifts.reduce((acc, s) => acc + shiftHours(s), 0) / days.size;
}
