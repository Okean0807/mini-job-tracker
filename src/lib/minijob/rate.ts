/**
 * Zentrale Lohnsatz-Auflösung.
 *
 * Einziger Ort, an dem die Priorität der Stundensätze definiert ist:
 *   1. Schicht-Satz  (shift.rate, wenn gesetzt)
 *   2. Job-Satz      (job.rate, wenn gesetzt)
 *   3. Standard-Satz (settings.defaultRate)
 *
 * Semantik (einheitlich in der gesamten App):
 *   undefined = nicht gesetzt  -> Fallback auf die nächste Ebene
 *   0         = bewusst 0 EUR/h -> KEIN Fallback
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


/** Wochenplanstunden (lokal, vermeidet rate↔schedule↔calc-Zyklus). */
function planWeekHours(week: Job["week"]): number {
  if (!week) return 0;
  let total = 0;
  for (const day of week) {
    if (!day.active) continue;
    const [sh, sm] = day.start.split(":").map(Number);
    const [eh, em] = day.end.split(":").map(Number);
    const mins = (eh ?? 0) * 60 + (em ?? 0) - ((sh ?? 0) * 60 + (sm ?? 0)) - (day.breakMinutes || 0);
    total += Math.max(0, mins) / 60;
  }
  return total;
}

/**
 * Abgeleiteter Stundenlohn aus Monatsbrutto (FEST monthly MVP).
 * monthlyGross / (Wochenplanstunden × 52 / 12), nur wenn payType=monthly,
 * monthlyGross>0 und Wochenstunden>0.
 */
export function effectiveHourlyFromMonthly(job: Pick<Job, "payType" | "monthlyGross" | "week">): number | undefined {
  if (job.payType !== "monthly") return undefined;
  const gross = job.monthlyGross;
  if (!(typeof gross === "number" && gross > 0)) return undefined;
  const weekHours = planWeekHours(job.week);
  if (!(weekHours > 0)) return undefined;
  return gross / ((weekHours * 52) / 12);
}

/** Gültiger Stundensatz nach Priorität Schicht > Job > Standard. */
export function resolveRate(query: RateQuery, jobs: Job[], settings: Settings): RateResolution {
  const job = findJob(jobs, query.jobId ?? settings.activeJobId);
  if (typeof query.shiftRate === "number") {
    return { rate: query.shiftRate, source: "shift", job };
  }
  if (job && typeof job.rate === "number") {
    return { rate: job.rate, source: "job", job };
  }
  const derived = job ? effectiveHourlyFromMonthly(job) : undefined;
  if (derived !== undefined) {
    return { rate: derived, source: "job", job };
  }
  return { rate: settings.defaultRate ?? 0, source: "default", job };
}

/** Vorschlagswert für neue/zu bearbeitende Schichten. */
export function suggestedRate(query: RateQuery, data: Pick<AppData, "jobs" | "settings">): number {
  return resolveRate(query, data.jobs, data.settings).rate;
}

/**
 * Eingabefeld -> Lohnsatz. Leeres/unparsbares Feld ergibt undefined (nicht gesetzt),
 * eine eingegebene 0 ergibt 0 (bewusst 0 EUR/h).
 */
export function parseRateInput(value: string): number | undefined {
  const raw = value.trim().replace(",", ".");
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export interface RateContext {
  job?: Job | undefined;
  defaultRate?: number | undefined;
}

/**
 * Für die Verdienstberechnung maßgeblicher Satz einer gespeicherten Schicht.
 * Fehlt der Schicht-Satz (undefined), greift Job- bzw. Standard-Satz.
 * Ein gespeicherter Satz von 0 bleibt 0.
 */
export function effectiveShiftRate(shift: Pick<Shift, "rate">, ctx: RateContext = {}): number {
  if (typeof shift.rate === "number") return shift.rate;
  if (typeof ctx.job?.rate === "number") return ctx.job.rate;
  const derived = ctx.job ? effectiveHourlyFromMonthly(ctx.job) : undefined;
  if (derived !== undefined) return derived;
  return ctx.defaultRate ?? 0;
}
