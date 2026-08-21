import { isoDate, shiftHours } from "./calc";
import { isHoliday } from "./holidays";
import { newId } from "./store";
import type { Job, Shift, ShiftKind } from "./types";

/**
 * Erzeugt Schichten aus dem Wochenplan einer Festanstellung für einen Monat.
 * Bestehende Einträge an einem Tag bleiben unangetastet.
 */
export function generateFixedMonth(
  job: Job,
  year: number,
  month: number,
  existing: Shift[],
  bundesland: string,
  options: { holidaysAsFree?: boolean } = {},
): Shift[] {
  if (!job.week) return [];
  const taken = new Set(existing.filter((s) => s.jobId === job.id).map((s) => s.date));
  const days = new Date(year, month + 1, 0).getDate();
  const created: Shift[] = [];

  for (let d = 1; d <= days; d++) {
    const date = isoDate(new Date(year, month, d));
    if (taken.has(date)) continue;
    const weekdayIndex = (new Date(year, month, d).getDay() + 6) % 7;
    const plan = job.week[weekdayIndex];
    if (!plan?.active) continue;
    const holiday = isHoliday(date, bundesland);
    const kind: ShiftKind = holiday && options.holidaysAsFree !== false ? "feiertag" : "arbeit";
    created.push({
      id: newId(),
      jobId: job.id,
      kind,
      date,
      start: plan.start,
      end: plan.end,
      breakMinutes: plan.breakMinutes,
      ...(typeof job.rate === "number" ? { rate: job.rate } : {}),
    });
  }
  return created;
}

/** Erzeugt Abwesenheitseinträge (Urlaub / Krank) für einen Zeitraum. */
export function generateAbsence(
  job: Job,
  kind: ShiftKind,
  from: string,
  to: string,
  bundesland: string,
): Shift[] {
  const result: Shift[] = [];
  const start = new Date(from);
  const end = new Date(to);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = isoDate(d);
    const weekdayIndex = (d.getDay() + 6) % 7;
    const plan = job.week?.[weekdayIndex];
    if (job.week && !plan?.active) continue;
    if (!job.week && (d.getDay() === 0 || d.getDay() === 6)) continue;
    result.push({
      id: newId(),
      jobId: job.id,
      kind,
      date,
      start: plan?.start ?? "09:00",
      end: plan?.end ?? "17:00",
      breakMinutes: plan?.breakMinutes ?? 0,
      ...(typeof job.rate === "number" ? { rate: job.rate } : {}),
      note: isHoliday(date, bundesland) ? "Feiertag" : undefined,
    });
  }
  return result;
}

/** Überstunden = geleistete Arbeitsstunden minus Sollstunden im Zeitraum. */
export function overtimeHours(job: Job, shifts: Shift[], weeks: number): number {
  const target = (job.weeklyTarget ?? weeklyPlanHours(job)) * weeks;
  const actual = shifts
    .filter((s) => s.jobId === job.id && s.kind === "arbeit")
    .reduce((acc, s) => acc + shiftHours(s), 0);
  return actual - target;
}

export function weeklyPlanHours(job: Job): number {
  if (!job.week) return 0;
  return job.week.reduce((acc, day) => {
    if (!day.active) return acc;
    return (
      acc +
      shiftHours({
        id: "x",
        kind: "arbeit",
        date: "2024-01-01",
        start: day.start,
        end: day.end,
        breakMinutes: day.breakMinutes,
      })
    );
  }, 0);
}
