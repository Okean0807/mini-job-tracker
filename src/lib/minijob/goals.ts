import { isoDate, sumEarnings } from "./calc";
import type { Goal, Job, Resolved, Shift } from "./types";

export interface GoalProgress {
  goal: Goal;
  /** Bereits angespart in EUR */
  saved: number;
  /** Fortschritt in Prozent (0-100+) */
  share: number;
  /** Rest bis zum Ziel */
  remaining: number;
  /** Tage bis zur Frist (undefined = keine Frist) */
  daysLeft?: number;
  /** Nötiger Betrag pro Monat, um die Frist zu schaffen */
  perMonth?: number;
  reached: boolean;
  job?: Job;
}

function daysBetween(a: string, b: string): number {
  const from = new Date(`${a}T00:00:00`).getTime();
  const to = new Date(`${b}T00:00:00`).getTime();
  return Math.round((to - from) / 86_400_000);
}

/** Anteil des Verdienstes, der auf ein Ziel einzahlt. */
export function autoSaved(
  goal: Goal,
  shifts: Shift[],
  resolve: (shift: Shift) => Resolved,
): number {
  const list = shifts.filter((s) => {
    if (goal.jobId && s.jobId !== goal.jobId) return false;
    if (goal.from && s.date < goal.from) return false;
    if (goal.deadline && s.date > goal.deadline) return false;
    return true;
  });
  const share = goal.share ?? 100;
  return (sumEarnings(list, resolve) * share) / 100;
}

export function goalProgress(
  goal: Goal,
  shifts: Shift[],
  jobs: Job[],
  resolve: (shift: Shift) => Resolved,
): GoalProgress {
  const saved =
    goal.kind === "manual" ? (goal.manualSaved ?? 0) : autoSaved(goal, shifts, resolve);
  const target = goal.target > 0 ? goal.target : 0;
  const share = target > 0 ? (saved / target) * 100 : 0;
  const remaining = Math.max(0, target - saved);
  const job = jobs.find((j) => j.id === goal.jobId);

  const result: GoalProgress = {
    goal,
    saved,
    share,
    remaining,
    reached: target > 0 && saved >= target,
  };
  if (job) result.job = job;
  if (goal.deadline) {
    const days = daysBetween(isoDate(new Date()), goal.deadline);
    result.daysLeft = days;
    if (days > 0 && remaining > 0) result.perMonth = remaining / Math.max(1, days / 30.4);
  }
  return result;
}

export function goalsProgress(
  goals: Goal[],
  shifts: Shift[],
  jobs: Job[],
  resolve: (shift: Shift) => Resolved,
): GoalProgress[] {
  return goals
    .map((g) => goalProgress(g, shifts, jobs, resolve))
    .sort((a, b) => {
      if (a.reached !== b.reached) return a.reached ? 1 : -1;
      const ad = a.goal.deadline ?? "9999";
      const bd = b.goal.deadline ?? "9999";
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });
}
