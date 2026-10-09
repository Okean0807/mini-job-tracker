import { isoDate, shiftHours } from "./calc";
import { isHoliday } from "./holidays";
import { weeklyPlanHours } from "./schedule";
import type { FixedDay, Job, Shift } from "./types";

/** Parse YYYY-MM-DD as a local calendar date (not UTC midnight). */
function localDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/**
 * Wochenplan gültig an `date` (Phase A weekHistory).
 * History-Einträge speichern den *vorherigen* Plan mit effectiveFrom = Änderungsdatum;
 * für date < effectiveFrom gilt dieser Plan, sonst der aktuelle job.week.
 */
export function weekForDate(job: Job, date: string): FixedDay[] | undefined {
  const sorted = [...(job.weekHistory ?? [])].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
  const futureChange = sorted.find((e) => e.effectiveFrom > date);
  if (futureChange) return futureChange.week;
  return job.week;
}

/**
 * Plan-Tag für das Arbeitszeitkonto (Soll). Vor Beschäftigungsbeginn
 * (`job.startDate`; der Starttag selbst hat Soll) gibt es keinen Plan-Tag → kein Soll,
 * kein aktiver Tag. Nur Soll/Ist (daySollHours, monthTimeAccount); die Payroll
 * nutzt `weekForDate` direkt und bleibt unverändert.
 */
function planForDate(job: Job, date: string): FixedDay | undefined {
  if (job.startDate && date.slice(0, 10) < job.startDate.slice(0, 10)) return undefined;
  const week = weekForDate(job, date);
  if (!week) return undefined;
  return week[weekdayIndex(localDate(date))];
}

/** Soll-Stunden für einen Kalendertag laut Wochenplan (0 wenn inaktiv / kein Plan). */
export function daySollHours(job: Job, date: string, _bundesland?: string): number {
  const plan = planForDate(job, date);
  if (!plan?.active) return 0;
  return shiftHours({
    id: "soll",
    kind: "arbeit",
    date,
    start: plan.start,
    end: plan.end,
    breakMinutes: plan.breakMinutes,
  });
}

/** Ist-Stunden aus Arbeitsschichten an diesem Tag (Summe). */
export function dayIstHours(job: Job, date: string, shifts: Shift[]): number {
  return shifts
    .filter((s) => s.jobId === job.id && s.date === date && s.kind === "arbeit")
    .reduce((acc, s) => acc + shiftHours(s), 0);
}

/** Tages-Saldo: Ist − Soll. */
export function dayBalance(job: Job, date: string, shifts: Shift[], bundesland?: string): number {
  return dayIstHours(job, date, shifts) - daySollHours(job, date, bundesland);
}

export interface FestMonthAccount {
  year: number;
  month: number;
  /** Summe Soll an aktiven Plan-Tagen (Feiertage zählen als Soll laut Plan; keine EFZ-Rechtsfindung). */
  soll: number;
  /** Summe Ist (Arbeit) */
  ist: number;
  /** Summe positiver Tagesdifferenzen */
  plus: number;
  /** Summe |negativer| Tagesdifferenzen */
  minus: number;
  /** Ist − Soll (Monats-Saldo) */
  saldo: number;
  /** Kalendertage mit aktiver Plan-Sollzeit und ohne Urlaub/Krank */
  workDays: number;
  vacationDays: number;
  sickDays: number;
}

/**
 * Monats-Aggregat für das Arbeitszeitkonto.
 * Abwesenheit (Urlaub/Krank) folgt generateAbsence-Semantik: nur aktive Wochentage.
 * Feiertage: isHoliday nur zur Info – Soll bleibt Plan-Soll; keine Entgeltfortzahlung erfunden.
 */
export function monthTimeAccount(
  job: Job,
  year: number,
  month: number,
  shifts: Shift[],
  bundesland = "",
): FestMonthAccount {
  const days = new Date(year, month + 1, 0).getDate();
  let soll = 0;
  let ist = 0;
  let plus = 0;
  let minus = 0;
  let workDays = 0;
  let vacationDays = 0;
  let sickDays = 0;

  for (let d = 1; d <= days; d++) {
    const date = isoDate(new Date(year, month, d));
    const plan = planForDate(job, date);
    const active = Boolean(plan?.active);
    const daySoll = active ? daySollHours(job, date, bundesland) : 0;
    const dayIst = dayIstHours(job, date, shifts);
    const dayShifts = shifts.filter((s) => s.jobId === job.id && s.date === date);
    const hasUrlaub = dayShifts.some((s) => s.kind === "urlaub");
    const hasKrank = dayShifts.some((s) => s.kind === "krank");
    const hasUnpaidAbsence = dayShifts.some((s) => s.kind === "frei" || s.kind === "sonstige");

    // Absence only on active weekdays (same rule as generateAbsence)
    if (active && hasUrlaub) vacationDays += 1;
    if (active && hasKrank) sickDays += 1;

    if (active) {
      soll += daySoll;
      // Feiertag: still count plan soll; do not invent EFZ law — holiday flagged via isHoliday for callers
      void (bundesland ? isHoliday(date, bundesland) : false);
      // frei/sonstige: no ist (arbeit only), soll bleibt; nicht als Arbeitstag zählen
      if (!hasUrlaub && !hasKrank && !hasUnpaidAbsence) workDays += 1;
    }

    ist += dayIst;
    const bal = dayIst - daySoll;
    if (bal > 0) plus += bal;
    else if (bal < 0) minus += -bal;
  }

  return {
    year,
    month,
    soll: round2(soll),
    ist: round2(ist),
    plus: round2(plus),
    minus: round2(minus),
    saldo: round2(ist - soll),
    workDays,
    vacationDays,
    sickDays,
  };
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/** Wochen-Soll: weeklyTarget falls gesetzt, sonst Summe aus Wochenplan. */
export function effectiveWeeklyTarget(job: Job): number {
  if (typeof job.weeklyTarget === "number" && job.weeklyTarget > 0) return job.weeklyTarget;
  return weeklyPlanHours(job);
}
