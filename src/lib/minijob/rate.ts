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

/**
 * K1: Von der Nutzerin EINGEGEBENER Lohnsatz, kaufmännisch auf zwei Nachkommastellen gerundet
 * ("12,345" -> 12.35, "14,006" -> 14.01, "1,005" -> 1.01).
 *
 * Gerundet wird auf den eingegebenen Dezimalziffern, nicht auf dem Gleitkommawert:
 * `Math.round(1.005 * 100) / 100` und `(1.005).toFixed(2)` ergeben beide 1.00, weil 1.005 binär
 * knapp unter der Hälfte liegt. Die Ziffernfolge kennt dieses Problem nicht.
 *
 * Leeres/unparsbares Feld ergibt undefined (nicht gesetzt), eine eingegebene 0 ergibt 0 –
 * dieselbe Semantik wie parseRateInput. Das Feld lässt nur Ziffern und ein Dezimaltrennzeichen zu.
 */
export function parseEditedRateInput(value: string): number | undefined {
  const match = /^(\d*)(?:[.,](\d*))?$/.exec(value.trim());
  if (!match) return undefined;
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (!whole && !fraction) return undefined;
  const cents = Number(`${whole || "0"}${`${fraction}00`.slice(0, 2)}`);
  const roundUp = fraction.length > 2 && fraction.charCodeAt(2) >= 53; // dritte Nachkommastelle >= 5
  const rounded = (cents + (roundUp ? 1 : 0)) / 100;
  return Number.isFinite(rounded) ? rounded : undefined;
}

/** K1: Zustand des Lohnsatz-Felds im Eintrag-Editor. */
export interface RateFieldState {
  /** Angezeigter Text (deutsches Komma). */
  text: string;
  /** true erst, wenn die Nutzerin den Text wirklich geändert hat. */
  dirty: boolean;
  /** Exakter Satz, mit dem das Feld befüllt wurde (gespeicherte Schicht bzw. Vorschlag). */
  source: number | undefined;
  /** Anzeige, mit der das Feld befüllt wurde (formatierter `source`), z. B. "12,35" für 12.345. */
  seedText: string;
}

/** Eingabetext in der Anzeigeform des Felds: gerundet, zwei Nachkommastellen, Komma; leer = "". */
export function normalizeRateText(text: string): string {
  const value = parseEditedRateInput(text);
  return value === undefined ? "" : value.toFixed(2).replace(".", ",");
}

/**
 * K1: Zu speichernder Lohnsatz. Unberührt bleibt der exakte Ausgangswert erhalten – die auf zwei
 * Stellen formatierte Anzeige wird NICHT zurückgeschrieben. Erst eine echte Eingabe zählt und wird
 * dann nach parseEditedRateInput gerundet.
 *
 * K1-M1: Steht nach dem Bearbeiten wieder dieselbe Anzeige im Feld wie beim Befüllen (z. B. "12,35"
 * gelöscht und neu getippt), hat sich für die Nutzerin nichts geändert – der exakte Ausgangswert
 * bleibt. Der Vergleich ist rein aus dem aktuellen Zustand abgeleitet (kein Zurücksetzen von
 * `dirty`), damit er nicht von der Reihenfolge von Blur/Render abhängt.
 */
export function rateFieldValue(field: RateFieldState): number | undefined {
  const untouched =
    typeof field.source === "number" && Number.isFinite(field.source) ? field.source : undefined;
  if (!field.dirty) return untouched;
  if (normalizeRateText(field.text) === field.seedText) return untouched;
  return parseEditedRateInput(field.text);
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
