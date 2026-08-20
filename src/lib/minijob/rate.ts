/**
 * Zentrale Lohnsatz-Auflösung.
 *
 * Einziger Ort, an dem die Priorität der Stundensätze definiert ist:
 *   1. Schicht-Satz  (shift.rate, wenn gesetzt und > 0)
 *   2. Job-Satz      (job.rate)
 *   3. Standard-Satz (settings.defaultRate)
 *
 * Achtung (bestehendes Verhalten, absichtlich unverändert):
 * Ein gespeicherter Schicht-Satz von 0 gilt in der Verdienstberechnung als
 * "0 EUR/h" und fällt NICHT auf Job- oder Standard-Satz zurück.
 */
import type { AppData, Job, Settings, Shift } from "./types";

export type RateSource = "shift" | "job" | "default";

export interface RateResolution {
  rate: number;
  source: RateSource;
  job?: Job | undefined;
}

export interface RateQuery {
  /** ISO-Datum yyyy-MM-dd (aktuell ohne zeitabhängige Sätze, für spätere Historie) */
  date?: string;
  jobId?: string | undefined;
  /** Expliziter Schicht-Satz (z. B. aus einem Formular) */
  shiftRate?: number | undefined;
}

export function findJob(jobs: Job[], jobId?: string): Job | undefined {
  return jobs.find((j) => j.id === jobId);
}

/** Gültiger Stundensatz nach Priorität Schicht > Job > Standard. */
export function resolveRate(
  query: RateQuery,
  jobs: Job[],
  settings: Settings,
): RateResolution {
  const job = findJob(jobs, query.jobId ?? settings.activeJobId);
  if (typeof query.shiftRate === "number" && query.shiftRate > 0) {
    return { rate: query.shiftRate, source: "shift", job };
  }
  if (job && typeof job.rate === "number" && job.rate > 0) {
    return { rate: job.rate, source: "job", job };
  }
  return { rate: settings.defaultRate ?? 0, source: "default", job };
}

/** Vorschlagswert für neue/zu bearbeitende Schichten. */
export function suggestedRate(query: RateQuery, data: Pick<AppData, "jobs" | "settings">): number {
  return resolveRate(query, data.jobs, data.settings).rate;
}

/**
 * Für die Verdienstberechnung maßgeblicher Satz einer gespeicherten Schicht.
 * Der Schicht-Satz ist verbindlich (auch 0) – siehe Hinweis oben.
 */
export function effectiveShiftRate(shift: Pick<Shift, "rate">): number {
  return shift.rate || 0;
}
