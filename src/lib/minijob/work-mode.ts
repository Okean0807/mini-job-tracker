import type { Job, WorkMode } from "./types";
import { isMinijobEmployment } from "./legal/employment";

/**
 * Planning mode only: flex (free entry) and fest (fixed weekly plan) are both
 * employee modes. The legal status (Minijob vs. Hauptbeschäftigung …) comes
 * from `Job.employmentType` via `isMinijobEmployment`, never from the plan.
 */
export function isEmployeeMinijobMode(mode: WorkMode): boolean {
  return mode !== "selbststaendig";
}

/**
 * @deprecated A WorkMode alone carries no legal status. Kept only for callers
 * that have no Job: answers "would a LEGACY job (no employmentType) with this
 * mode count as Minijob?" by delegating to the single source of truth
 * (`employmentTypeOf`): flex → true, fest → false (needs review),
 * selbststaendig → false. Use `isMinijobEmployment(job)` instead.
 */
export function workModeAppliesMinijobLimit(mode: WorkMode): boolean {
  return isMinijobEmployment({ id: "", name: "", color: "", mode });
}

/**
 * True when at least one active (non-archived) job is a Minijob by employment
 * type, or when there are no jobs yet (onboarding default).
 * Only Hauptbeschäftigung / kurzfristig / selbstständig / unconfirmed legacy
 * fest ("unknown") jobs → not applicable.
 */
export function jobsApplyMinijobLimit(jobs: Job[]): boolean {
  const active = jobs.filter((j) => !j.archived);
  if (active.length === 0) return true;
  return active.some((j) => isMinijobEmployment(j));
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
