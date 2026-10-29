import { isoDate, shiftHours } from "./calc";
import { isHoliday } from "./holidays";
import { newId } from "./store";
import type { Job, Shift, ShiftKind } from "./types";
import { absencePlanDay, weekForDate } from "./week-plan";

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
      Boolean(weekForDate(job, date)?.[weekdayIndex]?.active) &&
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
    // Plan gültig am Datum (nicht der aktuelle): ein Planwechsel ändert vergangene Monate nicht.
    const plan = weekForDate(job, date)?.[weekdayIndex];
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
 * Abwesenheitseintrag für EINEN Tag – oder null, wenn dort keiner angelegt werden soll.
 *
 * Maßgeblich ist der Wochenplan, der an diesem Datum galt (`weekForDate`, dieselbe Quelle wie die
 * Payroll), nicht der aktuelle Plan des Jobs:
 * - Plan-Tag aktiv → Eintrag mit den Zeiten dieses Plan-Tags;
 * - Plan-Tag frei → kein Eintrag;
 * - historischer Plan unbekannt → kein Eintrag (nicht raten, nicht auf den aktuellen Plan ausweichen);
 * - Job ganz ohne Wochenplan (flex) → bisherige Regel: Mo–Fr, 09:00–17:00.
 */
export function absenceDraftForDate(
  job: Job,
  kind: ShiftKind,
  date: string,
  bundesland: string,
  sickCaseId?: string,
): Shift | null {
  const plan = absencePlanDay(job, date);
  if (plan.status === "off" || plan.status === "unknown") return null;
  if (plan.status === "no-plan") {
    const day = localDate(date).getDay();
    if (day === 0 || day === 6) return null;
  }
  return {
    id: newId(),
    jobId: job.id,
    kind,
    date,
    ...absenceDayTimes(job, date),
    ...(typeof job.rate === "number" ? { rate: job.rate } : {}),
    ...(sickCaseId ? { sickCaseId } : {}),
    note: isHoliday(date, bundesland) ? "Feiertag" : undefined,
  };
}

/**
 * Erzeugt Abwesenheitseinträge (Urlaub / Krank) für einen Zeitraum.
 * Überspringt Tage, an denen für denselben Job bereits ein Eintrag existiert
 * (keine stillen Löschungen / Überschreibungen von Arbeit). Welche Tage Plan-Tage sind, bestimmt
 * der am jeweiligen Datum gültige Wochenplan (siehe {@link absenceDraftForDate}).
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
    const draft = absenceDraftForDate(job, kind, date, bundesland, sickCaseId);
    if (draft) result.push(draft);
  }
  return result;
}

/**
 * Zeiten eines Abwesenheitstags – gemeinsame Quelle für den Zeitraum-Dialog
 * (generateAbsence) und neue Abwesenheiten im Eintrags-Editor:
 * aktiver Wochenplan-Tag (laut Plan am Datum) → dessen Beginn/Ende/Pause, sonst 09:00–17:00 ohne Pause.
 */
export function absenceDayTimes(
  job: Pick<Job, "week" | "weekHistory"> | undefined,
  date: string,
): { start: string; end: string; breakMinutes: number } {
  const plan = job ? absencePlanDay(job, date) : undefined;
  if (plan?.status === "work") {
    return { start: plan.day.start, end: plan.day.end, breakMinutes: plan.day.breakMinutes ?? 0 };
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
