import { yearlyLimitOf } from "./limits";
import {
  monthNames,
  shiftBreakdown,
  shiftHours,
  shiftsInMonth,
  shiftsInYear,
} from "./calc";
import type { Resolver } from "./resolve";
import type { Job, Settings, Shift } from "./types";

export interface AnnualMonth {
  month: number;
  label: string;
  hours: number;
  earnings: number;
  base: number;
  bonus: number;
  entries: number;
}

export interface AnnualJob {
  id: string;
  name: string;
  color: string;
  hours: number;
  earnings: number;
  share: number;
}

export interface AnnualReport {
  year: number;
  entries: number;
  workDays: number;
  hours: number;
  earnings: number;
  base: number;
  bonus: number;
  bonusShare: number;
  avgRate: number;
  avgMonthEarnings: number;
  avgDayHours: number;
  activeMonths: number;
  limit: number;
  limitShare: number;
  bestMonth: AnnualMonth | null;
  bestDay: { date: string; hours: number; earnings: number } | null;
  months: AnnualMonth[];
  jobs: AnnualJob[];
  weekdayHours: number[];
}

/** Aggregiert alle Kennzahlen eines Jahres für den Jahresbericht. */
export function buildAnnualReport(
  shifts: Shift[],
  jobs: Job[],
  settings: Settings,
  year: number,
  resolve: Resolver,
): AnnualReport {
  const labels = monthNames();
  const list = shiftsInYear(shifts, year);

  const months: AnnualMonth[] = labels.map((label, month) => {
    const monthShifts = shiftsInMonth(list, year, month);
    let hours = 0;
    let base = 0;
    let bonus = 0;
    for (const s of monthShifts) {
      const b = shiftBreakdown(s, resolve(s));
      hours += b.hours;
      base += b.base;
      bonus += b.bonus;
    }
    return { month, label, hours, earnings: base + bonus, base, bonus, entries: monthShifts.length };
  });

  const hours = months.reduce((a, m) => a + m.hours, 0);
  const base = months.reduce((a, m) => a + m.base, 0);
  const bonus = months.reduce((a, m) => a + m.bonus, 0);
  const earnings = base + bonus;

  const byDay = new Map<string, { hours: number; earnings: number }>();
  const weekdayHours = [0, 0, 0, 0, 0, 0, 0];
  for (const s of list) {
    const b = shiftBreakdown(s, resolve(s));
    const day = byDay.get(s.date) ?? { hours: 0, earnings: 0 };
    day.hours += b.hours;
    day.earnings += b.total;
    byDay.set(s.date, day);
    const [y, m, d] = s.date.split("-").map(Number);
    const idx = (new Date(y!, (m ?? 1) - 1, d ?? 1).getDay() + 6) % 7;
    weekdayHours[idx] = (weekdayHours[idx] ?? 0) + shiftHours(s);
  }

  let bestDay: AnnualReport["bestDay"] = null;
  for (const [date, day] of byDay) {
    if (!bestDay || day.earnings > bestDay.earnings) bestDay = { date, ...day };
  }

  let bestMonth: AnnualMonth | null = null;
  for (const m of months) {
    if (m.earnings > 0 && (!bestMonth || m.earnings > bestMonth.earnings)) bestMonth = m;
  }

  const jobRows: AnnualJob[] = jobs
    .map((job) => {
      const jobShifts = list.filter((s) => s.jobId === job.id);
      let jh = 0;
      let je = 0;
      for (const s of jobShifts) {
        const b = shiftBreakdown(s, resolve(s));
        jh += b.hours;
        je += b.total;
      }
      return {
        id: job.id,
        name: job.name,
        color: job.color,
        hours: jh,
        earnings: je,
        share: earnings > 0 ? (je / earnings) * 100 : 0,
      };
    })
    .filter((j) => j.hours > 0 || j.earnings > 0)
    .sort((a, b) => b.earnings - a.earnings);

  const activeMonths = months.filter((m) => m.entries > 0).length;
  const limit = yearlyLimitOf(settings);

  return {
    year,
    entries: list.length,
    workDays: byDay.size,
    hours,
    earnings,
    base,
    bonus,
    bonusShare: earnings > 0 ? (bonus / earnings) * 100 : 0,
    avgRate: hours > 0 ? earnings / hours : 0,
    avgMonthEarnings: activeMonths > 0 ? earnings / activeMonths : 0,
    avgDayHours: byDay.size > 0 ? hours / byDay.size : 0,
    activeMonths,
    limit,
    limitShare: limit > 0 ? (earnings / limit) * 100 : 0,
    bestMonth,
    bestDay,
    months,
    jobs: jobRows,
    weekdayHours,
  };
}
