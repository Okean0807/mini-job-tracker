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
 * Beteiligung (Owner DECISIONS R3 Punkt 7, ersetzt die R3-QA-Regel
 * "ruhender erster Minijob zählt im Monat"):
 * - Der Status wird je KALENDERMONAT bestimmt. Ein Minijob zählt in einem
 *   Monat nur, wenn er in diesem Monat mindestens einen Eintrag innerhalb
 *   seiner Beschäftigungsdauer (startDate/endDate) hat. Ein ruhender
 *   (eintragsloser) Minijob zählt in diesem Monat NICHT – auch wenn er nicht
 *   archiviert ist oder in anderen Monaten gearbeitet wurde.
 * - Hauptbeschäftigung: Eintrag im Monat ODER nicht archiviert und
 *   Beschäftigungsdauer überschneidet den Monat (HB wird oft nicht erfasst).
 * - Längere Zeiträume (Jahr, Jahresbericht, 12-Monats-Prognose): betroffen,
 *   wenn mindestens EIN Kalendermonat im Zeitraum die Konstellation hat
 *   (tatsächliche Aktivitätszeiträume, keine Annahme "ganzjährig aktiv").
 *   Folge: Monats-Flag ⇒ Jahres-Flag; nacheinander (nicht gleichzeitig)
 *   ausgeübte Minijobs lösen keinen Hinweis aus.
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

/** Im Zeitraum noch beschäftigt (nicht archiviert, Dauer überschneidet den Zeitraum)? */
function employedDuring(job: Job, period: LimitPeriod): boolean {
  if (job.archived) return false;
  if (job.startDate && job.startDate > period.to) return false;
  if (job.endDate && job.endDate < period.from) return false;
  return true;
}

function mainJobInvolved(job: Job, shifts: Shift[], period: LimitPeriod): boolean {
  if (hasEntriesIn(job, shifts, period)) return true;
  return employedDuring(job, period);
}

/** Konstellation in genau einem Kalendermonat (`period` = monthPeriod). */
function monthAffected(jobs: Job[], shifts: Shift[], period: LimitPeriod): boolean {
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

/** Kalendermonate ("YYYY-MM"), die den Zeitraum schneiden (inklusive Ränder). */
function monthsOverlapping(period: LimitPeriod): { key: string; period: LimitPeriod }[] {
  const out: { key: string; period: LimitPeriod }[] = [];
  let y = Number(period.from.slice(0, 4));
  let m = Number(period.from.slice(5, 7)) - 1;
  const endKey = period.to.slice(0, 7);
  for (let guard = 0; guard < 1200; guard++) {
    const key = `${y}-${pad(m + 1)}`;
    if (key > endKey) break;
    const mp = monthPeriod(y, m);
    out.push({
      key,
      period: {
        from: mp.from < period.from ? period.from : mp.from,
        to: mp.to > period.to ? period.to : mp.to,
      },
    });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/**
 * Monate ("YYYY-MM") im Zeitraum mit Hauptbeschäftigung + mindestens zwei in
 * DIESEM Monat aktiven Minijobs (DECISIONS R3 Punkt 7).
 */
export function multipleMinijobMonths(jobs: Job[], shifts: Shift[], period: LimitPeriod): string[] {
  return monthsOverlapping(period)
    .filter((m) => monthAffected(jobs, shifts, m.period))
    .map((m) => m.key);
}

/**
 * true = in mindestens einem Kalendermonat des Zeitraums Hauptbeschäftigung
 * + mindestens zwei in diesem Monat aktive Minijobs.
 */
export function multipleMinijobsWithMainJob(
  jobs: Job[],
  shifts: Shift[],
  period: LimitPeriod,
): boolean {
  return monthsOverlapping(period).some((m) => monthAffected(jobs, shifts, m.period));
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
