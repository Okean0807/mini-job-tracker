import type { Job, WorkMode } from "./types";

/** Employee Minijob modes (flex / fest) — €603 Grenze and auto hours apply. */
export function isEmployeeMinijobMode(mode: WorkMode): boolean {
  return mode === "flex" || mode === "fest";
}

/** Whether the Minijob income/hours limit is applicable for this work mode. */
export function workModeAppliesMinijobLimit(mode: WorkMode): boolean {
  return isEmployeeMinijobMode(mode);
}

/**
 * True when at least one active (non-archived) job is an employee Minijob,
 * or when there are no jobs yet (default flex / onboarding).
 * All-selbstständig → limits not applicable.
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
