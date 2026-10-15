/**
 * B3-1 / O4 (v1.0, Owner-Entscheidung DECISIONS R2): Erkennung der Konstellation
 * "Hauptbeschäftigung + mehrere Minijobs" in einem Zeitraum.
 *
 * Rechtslage (SGB IV § 8 Abs. 2; Minijob-Zentrale, FAQ "Was ist eine
 * Hauptbeschäftigung?"): Neben einer Hauptbeschäftigung bleibt nur der zuerst
 * aufgenommene Minijob geringfügig; jeder weitere wird mit der
 * Hauptbeschäftigung zusammengerechnet – auch wenn die Minijobs zusammen die
 * Grenze nicht überschreiten. Die Grenzkarte summiert dagegen alle Minijobs
 * gegen eine Grenze. In dieser Konstellation ist ihr Status ("OK"/"über der
 * Grenze") daher nicht belastbar und wird NICHT angezeigt (nur Hinweis).
 * Keine Auswahl des "ersten" Minijobs (O1/O3) in v1.0.
 *
 * Mehrere Minijobs OHNE Hauptbeschäftigung: unverändert – ihre Entgelte werden
 * zusammengerechnet und gegen eine Grenze geprüft (SGB IV § 8 Abs. 2 Satz 1).
 */
import { employmentTypeOf } from "./legal/employment";
import type { Job, Shift } from "./types";

export interface LimitPeriod {
  /** ISO-Datum, inklusiv */
  from: string;
  /** ISO-Datum, inklusiv */
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function monthPeriod(year: number, month: number): LimitPeriod {
  const last = new Date(year, month + 1, 0).getDate();
  return { from: `${year}-${pad(month + 1)}-01`, to: `${year}-${pad(month + 1)}-${pad(last)}` };
}

export function yearPeriod(year: number): LimitPeriod {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/**
 * Job ist im Zeitraum beteiligt: hat Einträge darin, oder ist nicht archiviert
 * und überschneidet den Zeitraum laut Beginn/Ende.
 */
function involvedIn(job: Job, shifts: Shift[], period: LimitPeriod): boolean {
  if (shifts.some((s) => s.jobId === job.id && s.date >= period.from && s.date <= period.to)) {
    return true;
  }
  if (job.archived) return false;
  if (job.startDate && job.startDate > period.to) return false;
  if (job.endDate && job.endDate < period.from) return false;
  return true;
}

/** true = Hauptbeschäftigung + mindestens zwei Minijobs im Zeitraum. */
export function multipleMinijobsWithMainJob(
  jobs: Job[],
  shifts: Shift[],
  period: LimitPeriod,
): boolean {
  const involved = jobs.filter((job) => involvedIn(job, shifts, period));
  const hasMain = involved.some((job) => employmentTypeOf(job) === "hauptbeschaeftigung");
  if (!hasMain) return false;
  return involved.filter((job) => employmentTypeOf(job) === "minijob").length >= 2;
}
