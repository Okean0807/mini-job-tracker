/**
 * B3-1 / O4 (v1.0, Owner-Entscheidung DECISIONS R2): Erkennung der Konstellation
 * "Hauptbeschäftigung + mehrere Minijobs" in einem Zeitraum.
 *
 * Rechtslage (SGB IV § 8 Abs. 2; Minijob-Zentrale, FAQ "Was ist eine
 * Hauptbeschäftigung?"): Neben einer Hauptbeschäftigung bleibt nur der zuerst
 * aufgenommene Minijob geringfügig; jeder weitere wird mit der
 * Hauptbeschäftigung zusammengerechnet – auch wenn die Minijobs zusammen die
 * Grenze nicht überschreiten. Die Grenz-/Prognose-/Jahreswerte summieren
 * dagegen alle Minijobs gegen eine Grenze. In dieser Konstellation ist ihr
 * Status ("OK"/"über der Grenze"/Prozent) nicht belastbar und wird NICHT
 * angezeigt (nur Hinweis). Keine Auswahl des "ersten" Minijobs (O1/O3) in v1.0.
 *
 * Mehrere Minijobs OHNE Hauptbeschäftigung: unverändert – ihre Entgelte werden
 * zusammengerechnet und gegen eine Grenze geprüft (SGB IV § 8 Abs. 2 Satz 1).
 *
 * Beteiligung (QA P2-145-b, Owner: inaktive Minijobs zählen nicht):
 * - Minijob: nur mit mindestens einem Eintrag im Zeitraum, der in seine
 *   Beschäftigungsdauer (startDate/endDate) fällt. Ein Minijob ohne Einträge
 *   im Zeitraum gilt als inaktiv – auch wenn er nicht archiviert ist.
 * - Hauptbeschäftigung: Eintrag im Zeitraum ODER nicht archiviert und
 *   Beschäftigungsdauer überschneidet den Zeitraum (HB wird oft nicht erfasst).
 *
 * Diese Datei ist die einzige Quelle der Regel; Dashboard, Statistik,
 * Jahresbericht, Benachrichtigungen und KI-Kontext verwenden sie.
 */
import { employmentTypeOf, jobActiveOn } from "./legal/employment";
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

/** 12-Monats-Fenster der Rolling-Prognose, endend im Monat `month` (inklusiv). */
export function rollingPeriod(year: number, month: number): LimitPeriod {
  const start = new Date(year, month - 11, 1);
  return {
    from: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-01`,
    to: monthPeriod(year, month).to,
  };
}

function hasEntriesIn(job: Job, shifts: Shift[], period: LimitPeriod): boolean {
  return shifts.some(
    (s) =>
      s.jobId === job.id &&
      s.date >= period.from &&
      s.date <= period.to &&
      jobActiveOn(job, s.date),
  );
}

function mainJobInvolved(job: Job, shifts: Shift[], period: LimitPeriod): boolean {
  if (hasEntriesIn(job, shifts, period)) return true;
  if (job.archived) return false;
  if (job.startDate && job.startDate > period.to) return false;
  if (job.endDate && job.endDate < period.from) return false;
  return true;
}

/** true = Hauptbeschäftigung + mindestens zwei aktive Minijobs im Zeitraum. */
export function multipleMinijobsWithMainJob(
  jobs: Job[],
  shifts: Shift[],
  period: LimitPeriod,
): boolean {
  const hasMain = jobs.some(
    (job) =>
      employmentTypeOf(job) === "hauptbeschaeftigung" && mainJobInvolved(job, shifts, period),
  );
  if (!hasMain) return false;
  const activeMinijobs = jobs.filter(
    (job) => employmentTypeOf(job) === "minijob" && hasEntriesIn(job, shifts, period),
  );
  return activeMinijobs.length >= 2;
}

/** Je Anzeige-Bereich: ist der Grenzstatus NICHT belastbar? */
export interface LimitReliabilityFlags {
  month: boolean;
  year: boolean;
  forecast: boolean;
}

/**
 * Flags für einen betrachteten Monat (Dashboard: gewählter Monat; Heute-Karte
 * und Benachrichtigungen: aktueller Monat). Jede Karte nutzt den Flag IHRES
 * Zeitraums: Monatskarte → month, Jahreskarte → year, Prognose → forecast.
 */
export function limitReliabilityFlags(
  jobs: Job[],
  shifts: Shift[],
  year: number,
  month: number,
): LimitReliabilityFlags {
  return {
    month: multipleMinijobsWithMainJob(jobs, shifts, monthPeriod(year, month)),
    year: multipleMinijobsWithMainJob(jobs, shifts, yearPeriod(year)),
    forecast: multipleMinijobsWithMainJob(jobs, shifts, rollingPeriod(year, month)),
  };
}
