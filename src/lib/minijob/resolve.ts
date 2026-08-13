import { isHoliday } from "./holidays";
import type { Job, Settings, Shift, Supplements } from "./types";

export interface ResolveOptions {
  job?: Job | undefined;
  supplements?: Supplements | undefined;
  holiday?: boolean;
}

/** Liefert Job + Zuschlagsregeln + Feiertagsinfo für eine Schicht. */
export function makeResolver(jobs: Job[], settings: Settings) {
  return (shift: Shift): ResolveOptions => {
    const job = jobs.find((j) => j.id === shift.jobId);
    return {
      job,
      supplements: job?.supplements ?? settings.supplements,
      holiday: isHoliday(shift.date, settings.bundesland),
    };
  };
}

export function jobColor(jobs: Job[], jobId?: string): string | undefined {
  return jobs.find((j) => j.id === jobId)?.color;
}

export type Resolver = ReturnType<typeof makeResolver>;
