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
 *   Monat nur, wenn er in diesem Monat AKTIV ist (Variante B, siehe unten:
 *   Arbeit oder bezahlte Abwesenheit innerhalb der Beschäftigungsdauer). Ein
 *   ruhender Minijob zählt in diesem Monat NICHT – auch wenn er nicht
 *   archiviert ist oder in anderen Monaten gearbeitet wurde.
 * - Hauptbeschäftigung: Eintrag im Monat ODER nicht archiviert und
 *   Beschäftigungsdauer überschneidet den Monat (HB wird oft nicht erfasst).
 * - Längere Zeiträume (Jahr, Jahresbericht, 12-Monats-Prognose): betroffen,
 *   wenn mindestens EIN Kalendermonat im Zeitraum die Konstellation hat
 *   (tatsächliche Aktivitätszeiträume, keine Annahme "ganzjährig aktiv").
 *   Folge: Monats-Flag ⇒ Jahres-Flag; nacheinander (nicht gleichzeitig)
 *   ausgeübte Minijobs lösen keinen Hinweis aus.
 *
 * Aktivität eines Minijobs im Monat (Owner R5, Variante B – ersetzt "mindestens
 * ein Eintrag"): Der Minijob ist im Monat aktiv, wenn die Beschäftigung an dem
 * Tag besteht (startDate/endDate, inklusive) UND im Monat mindestens
 * - ein Arbeitseintrag ("arbeit") oder
 * - eine bezahlte Abwesenheit vorliegt: Urlaub (im Modell stets bezahlt) oder
 *   Krank/Feiertag, deren Bewertung (`shiftPayroll`) bezahlt ergibt.
 * "frei"/"sonstige" und unbezahlte Abwesenheiten (z. B. Krank an planfreiem
 * Tag, Wartezeit, über 6 Wochen) sind KEINE Aktivität.
 * UNSICHER (expliziter Zustand, keine Annahme): Krank/Feiertag, deren
 * Bezahlung nur geschätzt ist (kein Wochenplan → Arbeitstag aus Mustern
 * abgeleitet; Krank ohne Beschäftigungsbeginn → Wartezeit nicht prüfbar) oder
 * noch von einer O-2-Bestätigung abhängt (`isSickLegacyDiscrepancy`). Ein Monat
 * ist "unsicher", wenn erst die unsicheren Minijobs die Zahl 2 erreichen.
 *
 * Diese Datei ist die einzige Quelle der Regel; Dashboard, Statistik,
 * Jahresbericht, Benachrichtigungen und KI-Kontext verwenden sie.
 */
import { employmentTypeOf, jobActiveOn } from "./legal/employment";
import { weekForDate } from "./fest-time-account";
import { isSickLegacyDiscrepancy, shiftPayroll } from "./payroll";
import type { Job, Settings, Shift } from "./types";

/** Optionen für die Aktivitätsbewertung (bestätigte O-2-Monate). */
export interface ActivityOptions {
  sickContinuousConfirmed?: readonly string[] | undefined;
}

/** Aktivitätsoptionen aus den (bereits validierten) Einstellungen. */
export function activityOptions(
  settings: Pick<Settings, "sickContinuousConfirmations"> | undefined,
): ActivityOptions {
  const list = settings?.sickContinuousConfirmations;
  return Array.isArray(list) ? { sickContinuousConfirmed: list.map((c) => c.month) } : {};
}

export type MinijobActivity = "active" | "uncertain" | "inactive";
export type O4MonthStatus = "affected" | "uncertain" | "none";

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

/**
 * Variante B (Owner R5): Aktivität eines Minijobs in einem Zeitraum (in der
 * Regel ein Kalendermonat). Siehe Kopfkommentar.
 */
export function minijobActivity(
  job: Job,
  shifts: Shift[],
  period: LimitPeriod,
  options: ActivityOptions = {},
): MinijobActivity {
  let uncertain = false;
  for (const s of shifts) {
    if (s.jobId !== job.id || s.date < period.from || s.date > period.to) continue;
    if (!jobActiveOn(job, s.date)) continue;
    if (s.kind === "arbeit" || s.kind === "urlaub") return "active";
    if (s.kind !== "krank" && s.kind !== "feiertag") continue;
    const p = shiftPayroll(s, {
      job,
      history: shifts,
      sickContinuousConfirmed: options.sickContinuousConfirmed,
    });
    if (!p.paid) {
      // "Planfrei" ohne Wochenplan ist nur aus der Historie geschätzt → nicht bestimmt.
      const offDay = p.reason === "holiday-off-day" || p.reason === "sick-off-day";
      if (offDay && !weekForDate(job, s.date)) uncertain = true;
      continue;
    }
    if (p.estimated || isSickLegacyDiscrepancy(p)) uncertain = true;
    else return "active";
  }
  return uncertain ? "uncertain" : "inactive";
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
export function o4MonthStatus(
  jobs: Job[],
  shifts: Shift[],
  period: LimitPeriod,
  options: ActivityOptions = {},
): O4MonthStatus {
  const hasMain = jobs.some(
    (job) =>
      employmentTypeOf(job) === "hauptbeschaeftigung" && mainJobInvolved(job, shifts, period),
  );
  if (!hasMain) return "none";
  let active = 0;
  let uncertain = 0;
  for (const job of jobs) {
    if (employmentTypeOf(job) !== "minijob") continue;
    const a = minijobActivity(job, shifts, period, options);
    if (a === "active") active += 1;
    else if (a === "uncertain") uncertain += 1;
  }
  if (active >= 2) return "affected";
  return active + uncertain >= 2 ? "uncertain" : "none";
}

function monthAffected(
  jobs: Job[],
  shifts: Shift[],
  period: LimitPeriod,
  options: ActivityOptions = {},
): boolean {
  return o4MonthStatus(jobs, shifts, period, options) === "affected";
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
export function multipleMinijobMonths(
  jobs: Job[],
  shifts: Shift[],
  period: LimitPeriod,
  options: ActivityOptions = {},
): string[] {
  return monthsOverlapping(period)
    .filter((m) => monthAffected(jobs, shifts, m.period, options))
    .map((m) => m.key);
}

/**
 * Monate, in denen die Konstellation wegen unsicherer bezahlter Abwesenheiten
 * NICHT sicher bestimmbar ist (Variante B, expliziter Unsicherheitszustand).
 */
export function uncertainMinijobMonths(
  jobs: Job[],
  shifts: Shift[],
  period: LimitPeriod,
  options: ActivityOptions = {},
): string[] {
  return monthsOverlapping(period)
    .filter((m) => o4MonthStatus(jobs, shifts, m.period, options) === "uncertain")
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
  options: ActivityOptions = {},
): boolean {
  return monthsOverlapping(period).some((m) => monthAffected(jobs, shifts, m.period, options));
}

/** Je Anzeige-Bereich: ist der Grenzstatus NICHT belastbar? */
export interface LimitReliabilityFlags {
  month: boolean;
  year: boolean;
  forecast: boolean;
  /** Variante B: Konstellation im Bereich nicht sicher bestimmbar (und nicht sicher gegeben). */
  monthUncertain?: boolean;
  yearUncertain?: boolean;
  forecastUncertain?: boolean;
}

/**
 * Status (OK/über/Prozent) je Bereich nicht belastbar: Konstellation gegeben
 * ODER nicht sicher bestimmbar. Für Ausblenden von Anteilen/Warnungen.
 */
export function statusUnreliable(flags: LimitReliabilityFlags): {
  month: boolean;
  year: boolean;
  forecast: boolean;
} {
  return {
    month: flags.month || !!flags.monthUncertain,
    year: flags.year || !!flags.yearUncertain,
    forecast: flags.forecast || !!flags.forecastUncertain,
  };
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
  options: ActivityOptions = {},
): LimitReliabilityFlags {
  const statuses = (period: LimitPeriod) =>
    monthsOverlapping(period).map((m) => o4MonthStatus(jobs, shifts, m.period, options));
  const flag = (period: LimitPeriod) => {
    const list = statuses(period);
    const affected = list.includes("affected");
    return { affected, uncertain: !affected && list.includes("uncertain") };
  };
  const m = flag(monthPeriod(year, month));
  const y = flag(yearPeriod(year));
  const f = flag(rollingPeriod(year, month));
  // Unsicher-Felder nur, wenn zutreffend (bestehende Aufrufer/Tests unverändert).
  return {
    month: m.affected,
    year: y.affected,
    forecast: f.affected,
    ...(m.uncertain ? { monthUncertain: true } : {}),
    ...(y.uncertain ? { yearUncertain: true } : {}),
    ...(f.uncertain ? { forecastUncertain: true } : {}),
  };
}

/**
 * D6 (Owner R4, Regel A): betroffene Monate je Zeitraum, damit Jahres- und
 * Prognosekarte erklären können, WELCHE Monate den Hinweis auslösen (auch wenn
 * der betrachtete Monat selbst nicht betroffen ist). Die Prognose blickt nur
 * auf die 12 Monate bis einschließlich `month` zurück (erfasste Einträge) –
 * künftige Beschäftigungen sind darin nicht enthalten.
 */
export function limitReliabilityMonths(
  jobs: Job[],
  shifts: Shift[],
  year: number,
  month: number,
  options: ActivityOptions = {},
): { year: string[]; forecast: string[]; yearUncertain: string[]; forecastUncertain: string[] } {
  return {
    year: multipleMinijobMonths(jobs, shifts, yearPeriod(year), options),
    forecast: multipleMinijobMonths(jobs, shifts, rollingPeriod(year, month), options),
    yearUncertain: uncertainMinijobMonths(jobs, shifts, yearPeriod(year), options),
    forecastUncertain: uncertainMinijobMonths(jobs, shifts, rollingPeriod(year, month), options),
  };
}
