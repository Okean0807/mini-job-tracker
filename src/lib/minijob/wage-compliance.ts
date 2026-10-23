import { bindingMinimumWageFor, industryMinimumWageFor } from "./industry-minimum-wage";
import { minimumWageFor } from "./legal";
import type { Job, Shift } from "./types";
import { effectiveShiftRate } from "./rate";

export interface WageComplianceResult {
  date: string;
  actualRate: number;
  generalMinimumWage: number;
  industryMinimumWage?: number;
  bindingMinimumWage: number;
  compliant: boolean;
}

/** Prüft den für eine konkrete Schicht maßgeblichen Stundenlohn. */
export function checkShiftWage(date: string, actualRate: number, job?: Job): WageComplianceResult {
  const general = minimumWageFor(date);
  const industry = industryMinimumWageFor(date, job?.industrySectorId, job?.industryGroupId);
  const binding = bindingMinimumWageFor(date, general, job?.industrySectorId, job?.industryGroupId);
  return {
    date,
    actualRate,
    generalMinimumWage: general,
    ...(industry != null ? { industryMinimumWage: industry } : {}),
    bindingMinimumWage: binding,
    compliant: actualRate + 0.0001 >= binding,
  };
}

export function checkShiftWageFromRate(
  date: string,
  shift: Pick<Shift, "rate">,
  job: Job | undefined,
  defaultRate: number,
): WageComplianceResult {
  const actualRate = effectiveShiftRate(shift, { job, defaultRate });
  return checkShiftWage(date, actualRate, job);
}

export interface WageViolation {
  shift: Shift;
  job: Job | undefined;
  result: WageComplianceResult;
}

/** Liefert nur Schichten, deren eingetragene Rate unter der verbindlichen Untergrenze liegt. */
export function findWageViolations(
  shifts: Shift[],
  jobs: Job[],
  defaultRate: number,
  predicate?: (shift: Shift) => boolean,
): WageViolation[] {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  return shifts
    .filter((shift) => predicate?.(shift) ?? true)
    .map((shift) => {
      const job = shift.jobId ? byId.get(shift.jobId) : undefined;
      return { shift, job, result: checkShiftWageFromRate(shift.date, shift, job, defaultRate) };
    })
    .filter(({ result }) => !result.compliant);
}

/**
 * QA P3-INT-143-c: Hinweis für Bestände, deren Standard-Stundenlohn unter dem
 * allgemeinen gesetzlichen Mindestlohn liegt (z. B. Erststart 2026 mit 13,90 €
 * und Stichtag 01.01.2027 mit 14,60 €). Gespeicherte Sätze werden NIE
 * automatisch geändert; geprüft werden nur heute und der nächste 1. Januar
 * (nur hinterlegte Regelversionen, keine erfundenen Werte).
 */
export function defaultRateBelowMinimum(
  defaultRate: number,
  today: string,
): { from: string; minimum: number } | undefined {
  const nextJan = `${Number(today.slice(0, 4)) + 1}-01-01`;
  for (const date of [today, nextJan]) {
    let minimum: number;
    try {
      minimum = minimumWageFor(date);
    } catch {
      continue;
    }
    if (Number.isFinite(defaultRate) && defaultRate + 0.0001 < minimum) {
      return { from: date, minimum };
    }
  }
  return undefined;
}
