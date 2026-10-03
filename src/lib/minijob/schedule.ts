import { isoDate, shiftHours } from "./calc";
import { isHoliday } from "./holidays";
import { newId } from "./store";
import type { Job, Shift, ShiftKind } from "./types";

/**
 * Jobs, die laut Wochenplan an `date` geplant, aber dort noch nicht erfasst
 * sind. Gleiche Regel wie der Kalender (MonthCalendar → generateFixedMonth):
 * nur Planungsmodus "fest" mit Wochenplan, nicht archiviert. Ein flex-Job hat
 * zwar oft einen (inaktiven) EMPTY_WEEK-Plan, ist aber nie „geplant“.
 */
export function jobsPlannedOn(jobs: Job[], existing: Shift[], date: string): Job[] {
  const weekdayIndex = (localDate(date).getDay() + 6) % 7;
  return jobs.filter(
    (job) =>
      !job.archived &&
      job.mode === "fest" &&
      Boolean(job.week?.[weekdayIndex]?.active) &&
      !existing.some((s) => s.jobId === job.id && s.date === date),
  );
}

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

/** Parse YYYY-MM-DD as a local calendar date (not UTC midnight). */
function localDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/**
 * Erzeugt Abwesenheitseinträge (Urlaub / Krank) für einen Zeitraum.
 * Überspringt Tage, an denen für denselben Job bereits ein Eintrag existiert
 * (keine stillen Löschungen / Überschreibungen von Arbeit).
 */
export function generateAbsence(
  job: Job,
  kind: ShiftKind,
  from: string,
  to: string,
  bundesland: string,
  existing: Shift[] = [],
): Shift[] {
  const result: Shift[] = [];
  const taken = new Set(existing.filter((s) => s.jobId === job.id).map((s) => s.date));
  // A range-created sick leave is one explicitly identifiable illness case.
  // This avoids the former heuristic that merged cases merely because they
  // happened to be within seven calendar days of each other.
  const sickCaseId = kind === "krank" ? newId() : undefined;
  const start = localDate(from);
  const end = localDate(to);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = isoDate(d);
    if (taken.has(date)) continue;
    const weekdayIndex = (d.getDay() + 6) % 7;
    const plan = job.week?.[weekdayIndex];
    if (job.week && !plan?.active) continue;
    if (!job.week && (d.getDay() === 0 || d.getDay() === 6)) continue;
    result.push({
      id: newId(),
      jobId: job.id,
      kind,
      date,
      ...absenceDayTimes(job, date),
      ...(typeof job.rate === "number" ? { rate: job.rate } : {}),
      ...(sickCaseId ? { sickCaseId } : {}),
      note: isHoliday(date, bundesland) ? "Feiertag" : undefined,
    });
  }
  return result;
}

/**
 * Zeiten eines Abwesenheitstags – gemeinsame Quelle für den Zeitraum-Dialog
 * (generateAbsence) und neue Abwesenheiten im Eintrags-Editor:
 * aktiver Wochenplan-Tag → dessen Beginn/Ende/Pause, sonst 09:00–17:00 ohne Pause.
 */
export function absenceDayTimes(
  job: Pick<Job, "week"> | undefined,
  date: string,
): { start: string; end: string; breakMinutes: number } {
  const plan = job?.week?.[(localDate(date).getDay() + 6) % 7];
  if (plan?.active) {
    return { start: plan.start, end: plan.end, breakMinutes: plan.breakMinutes ?? 0 };
  }
  return { start: "09:00", end: "17:00", breakMinutes: 0 };
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
