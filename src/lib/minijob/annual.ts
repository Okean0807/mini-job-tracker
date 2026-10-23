import { yearUsage } from "./limits";
import {
  activityOptions,
  multipleMinijobMonths,
  uncertainMinijobMonths,
  yearPeriod,
  type ActivityOptions,
} from "./multi-minijob";
import { monthNames, shiftsInMonth, shiftsInYear } from "./calc";
import { shiftPayroll } from "./payroll";
import type { Resolver } from "./resolve";
import type { Job, Settings, Shift } from "./types";

export interface AnnualMonth {
  month: number;
  label: string;
  /** Tatsächlich geleistete Arbeitsstunden (ohne bezahlte Abwesenheit). */
  hours: number;
  /** Bezahlte Ausfallstunden (Urlaub / Krank / Feiertag). */
  absenceHours: number;
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
  /** Bezahlte Ausfallstunden (Urlaub / Krank / Feiertag). */
  absenceHours: number;
  earnings: number;
  /** Entgelt aus geleisteter Arbeit. */
  workEarnings: number;
  /** Entgeltfortzahlung (bezahlte Abwesenheit). */
  absenceEarnings: number;
  base: number;
  bonus: number;
  bonusShare: number;
  avgRate: number;
  avgMonthEarnings: number;
  avgDayHours: number;
  activeMonths: number;
  limit: number;
  limitShare: number;
  /**
   * B3-1/O4: Hauptbeschäftigung + mehrere Minijobs im Jahr → `limitShare`
   * ist nicht belastbar und wird nicht als Prozent angezeigt.
   */
  multipleMinijobs?: boolean;
  /** Monate ("YYYY-MM") mit HB + ≥ 2 in diesem Monat aktiven Minijobs (DECISIONS R3 Punkt 7). */
  multipleMinijobMonths?: string[];
  /**
   * Owner R5 (Variante B): Monate, in denen die Konstellation wegen unsicherer
   * bezahlter Abwesenheiten nicht sicher bestimmbar ist.
   */
  o4UncertainMonths?: string[];
  /**
   * true = Bericht ist nach Job gefiltert, der O4-Hinweis stammt aber aus ALLEN
   * relevanten Daten (DECISIONS R3 Punkt 5) – Erklärung wird angezeigt.
   */
  multipleMinijobsFromAllJobs?: boolean;
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

  // Payroll-Semantik: Abwesenheiten erzeugen Entgelt, aber keine Arbeitsstunden.
  const pay = (s: Shift) => shiftPayroll(s, { ...resolve(s), history: shifts });

  const months: AnnualMonth[] = labels.map((label, month) => {
    const monthShifts = shiftsInMonth(list, year, month);
    let hours = 0;
    let absenceHours = 0;
    let base = 0;
    let bonus = 0;
    for (const s of monthShifts) {
      const p = pay(s);
      hours += p.workedHours;
      absenceHours += p.paidAbsenceHours;
      base += p.base;
      bonus += p.bonus;
    }
    return {
      month,
      label,
      hours,
      absenceHours,
      earnings: base + bonus,
      base,
      bonus,
      entries: monthShifts.length,
    };
  });

  const hours = months.reduce((a, m) => a + m.hours, 0);
  const absenceHours = months.reduce((a, m) => a + m.absenceHours, 0);
  const base = months.reduce((a, m) => a + m.base, 0);
  const bonus = months.reduce((a, m) => a + m.bonus, 0);
  const earnings = base + bonus;
  let workEarnings = 0;
  let absenceEarnings = 0;
  for (const s of list) {
    const p = pay(s);
    if (p.kind === "arbeit") workEarnings += p.earnings;
    else absenceEarnings += p.earnings;
  }

  const byDay = new Map<string, { hours: number; earnings: number }>();
  const weekdayHours = [0, 0, 0, 0, 0, 0, 0];
  for (const s of list) {
    const p = pay(s);
    const day = byDay.get(s.date) ?? { hours: 0, earnings: 0 };
    day.hours += p.workedHours;
    day.earnings += p.earnings;
    byDay.set(s.date, day);
    const [y, m, d] = s.date.split("-").map(Number);
    const idx = (new Date(y!, (m ?? 1) - 1, d ?? 1).getDay() + 6) % 7;
    weekdayHours[idx] = (weekdayHours[idx] ?? 0) + p.workedHours;
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
        const p = pay(s);
        jh += p.workedHours;
        je += p.earnings;
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
  const legalUsage = yearUsage(shifts, resolve, settings, year);
  const limit = legalUsage.earningsLimit;
  const legalEarnings = legalUsage.earnings;

  return {
    year,
    entries: list.length,
    workDays: byDay.size,
    hours,
    absenceHours,
    earnings,
    workEarnings,
    absenceEarnings,
    base,
    bonus,
    bonusShare: earnings > 0 ? (bonus / earnings) * 100 : 0,
    avgRate: hours > 0 ? workEarnings / hours : 0,
    avgMonthEarnings: activeMonths > 0 ? earnings / activeMonths : 0,
    avgDayHours: byDay.size > 0 ? hours / byDay.size : 0,
    activeMonths,
    limit,
    limitShare: limit > 0 ? (legalEarnings / limit) * 100 : 0,
    ...o4YearFields(jobs, shifts, year, activityOptions(settings)),
    bestMonth,
    bestDay,
    months,
    jobs: jobRows,
    weekdayHours,
  };
}

/** O4-Felder des Jahresberichts aus den übergebenen Einträgen (je Monat bestimmt). */
function o4YearFields(jobs: Job[], shifts: Shift[], year: number, options: ActivityOptions) {
  const months = multipleMinijobMonths(jobs, shifts, yearPeriod(year), options);
  const uncertain = uncertainMinijobMonths(jobs, shifts, yearPeriod(year), options);
  return {
    multipleMinijobs: months.length > 0,
    multipleMinijobMonths: months,
    o4UncertainMonths: uncertain,
  };
}

/**
 * DECISIONS R3 Punkt 5: Summen bleiben nach Filter, der O4-Hinweis wird aus
 * ALLEN Einträgen bestimmt (ein Job-Filter ändert die Rechtslage nicht).
 * `filterActive` = Bericht zeigt nur einen Teil der Jobs → Erklärung anzeigen.
 */
export function withAllJobsO4(
  report: AnnualReport,
  jobs: Job[],
  allShifts: Shift[],
  filterActive: boolean,
  options: ActivityOptions = {},
): AnnualReport {
  const fields = o4YearFields(jobs, allShifts, report.year, options);
  return {
    ...report,
    ...fields,
    multipleMinijobsFromAllJobs: filterActive && fields.multipleMinijobs,
  };
}
