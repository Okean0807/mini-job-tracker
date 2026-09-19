import type { Job, WorkMode } from "./types";

/**
 * Employee Minijob mode: only flex applies the €603 Geringfügigkeitsgrenze.
 * Fest uses Arbeitszeitkonto (Soll/Ist) and does not apply Minijob limits.
 */
export function isEmployeeMinijobMode(mode: WorkMode): boolean {
  return mode === "flex";
}

/** Whether the Minijob income/hours limit is applicable for this work mode. */
export function workModeAppliesMinijobLimit(mode: WorkMode): boolean {
  return mode === "flex";
}

/**
 * True when at least one active (non-archived) job is flex Minijob,
 * or when there are no jobs yet (default flex / onboarding).
 * All-fest or all-selbstständig → limits not applicable.
 */
export function jobsApplyMinijobLimit(jobs: Job[]): boolean {
  const active = jobs.filter((j) => !j.archived);
  if (active.length === 0) return true;
  return active.some((j) => workModeAppliesMinijobLimit(j.mode));
}

/** Primary / active job mode for assistant context; falls back to first active. */
export function primaryWorkMode(jobs: Job[], activeJobId?: string): WorkMode {
  const active = jobs.filter((j) => !j.archived);
  const preferred = activeJobId ? active.find((j) => j.id === activeJobId) : undefined;
  return preferred?.mode ?? active[0]?.mode ?? "flex";
}

/** Resolve pay type with migration: missing payType + rate set → hourly. */
export function resolvePayType(job: Pick<Job, "payType" | "rate">): "monthly" | "hourly" {
  if (job.payType === "monthly") return "monthly";
  if (job.payType === "hourly") return "hourly";
  if (typeof job.rate === "number") return "hourly";
  return "hourly";
}
