/**
 * Payroll-Semantik für Abwesenheiten (Urlaub / Krankheit / Feiertag).
 *
 * Rechtsgrundlage (siehe docs/rechtsregeln.md):
 * - § 2 EntgFG: Feiertagsvergütung nur, wenn der Feiertag auf einen Tag fällt,
 *   an dem sonst regelmäßig gearbeitet worden wäre.
 * - § 3 EntgFG: Entgeltfortzahlung im Krankheitsfall bis zu sechs Wochen,
 *   Anspruch erst nach vierwöchiger ununterbrochener Beschäftigung (§ 3 Abs. 3).
 * - § 4 EntgFG: fortzuzahlen ist das Entgelt der maßgebenden regelmäßigen
 *   Arbeitszeit (Entgeltausfallprinzip) – ohne Zuschläge für tatsächlich
 *   geleistete Arbeit, die es an diesem Tag nicht gab.
 * - § 11 BUrlG: Urlaubsentgelt = durchschnittlicher Verdienst der letzten
 *   13 Wochen vor Urlaubsbeginn.
 *
 * Grundsatz dieser Schicht: bezahlte Abwesenheit erzeugt Entgelt, aber KEINE
 * geleisteten Arbeitsstunden. Doppelzählung ist damit ausgeschlossen.
 */
import { shiftBreakdown, shiftHours } from "./calc";
import { weekForDate } from "./fest-time-account";
import { effectiveShiftRate } from "./rate";
import type { ResolveOptions } from "./resolve";
import type { Job, Shift, ShiftKind } from "./types";

/** Wartezeit bis zum Anspruch auf Entgeltfortzahlung (§ 3 Abs. 3 EntgFG). */
export const SICK_WAITING_DAYS = 28;
/** Höchstdauer der Entgeltfortzahlung je Krankheitsfall (§ 3 Abs. 1 EntgFG). */
export const SICK_MAX_DAYS = 42;
/**
 * Krankheitsfall-Regel (Owner-Entscheidung DECISIONS R2, Sick pay):
 * - Einträge mit derselben `sickCaseId` bilden einen Fall (unverändert).
 * - Aufeinanderfolgende "krank"-Tage desselben Jobs OHNE `sickCaseId` bilden
 *   einen vermuteten Fall. Lücken sind nur über leere, nicht regelmäßige
 *   Arbeitstage (z. B. Wochenende laut Plan) erlaubt; jeder andere Eintrag
 *   oder ein leerer regelmäßiger Arbeitstag beendet den Fall.
 * - Verstreute Zeiträume werden NIE automatisch zusammengeführt ("dieselbe
 *   Krankheit" lässt sich aus Daten nicht ableiten); unklare Nachbarschaften
 *   erzeugen nur einen Hinweis (`notice = "sick-case-ambiguous"`).
 */
/**
 * Ab diesem Datum gilt die Fortsetzungsregel für Einträge ohne `sickCaseId`.
 * Frühere Tage werden NICHT automatisch neu berechnet (bisheriges Verhalten);
 * würde die neue Regel dort abweichen, wird nur `notice =
 * "sick-legacy-over-limit"` gesetzt. Stichtag = Owner-Entscheidung (offen).
 */
export const SICK_CONTINUOUS_RULE_FROM = "2026-11-01";
/** Referenzzeitraum des Urlaubsentgelts (§ 11 BUrlG). */
export const VACATION_REFERENCE_DAYS = 91;
/** Mindestzahl an Arbeitstagen im Referenzzeitraum für eine belastbare Berechnung. */
export const VACATION_MIN_REFERENCE_DAYS = 5;

export type PayReason =
  | "worked"
  | "holiday-pay"
  | "holiday-off-day"
  | "sick-pay"
  | "sick-waiting"
  | "sick-exceeded"
  | "sick-off-day"
  | "vacation-pay"
  | "unpaid-absence";

/** Grundlage der Entgeltberechnung einer Abwesenheit. */
export type PayBasis = "worked" | "plan" | "average13" | "entry" | "none";

export interface ShiftPayroll {
  kind: ShiftKind;
  /** Tatsächlich geleistete Arbeitsstunden (nur kind = "arbeit"). */
  workedHours: number;
  /** Bezahlte Ausfallstunden (Abwesenheit) – keine geleistete Arbeit. */
  paidAbsenceHours: number;
  /** Entgelt (Arbeitsentgelt i. S. d. § 14 SGB IV, zählt zur Minijob-Grenze). */
  earnings: number;
  /** Grundentgelt ohne Zuschläge (bei Abwesenheit = gesamtes Entgelt). */
  base: number;
  /** Zuschläge – nur für tatsächlich geleistete Arbeit (§ 4 EntgFG). */
  bonus: number;
  paid: boolean;
  reason: PayReason;
  basis: PayBasis;
  /** true = Berechnungsbasis ist eine nachvollziehbare Schätzung, kein exakter Wert. */
  estimated: boolean;
  /** Hinweis zur Krankheitsfall-Zuordnung (nur gesetzt, wenn relevant). */
  notice?: SickCaseNotice;
}

/**
 * - "sick-case-ambiguous": angrenzende Krankheitseinträge, die nicht automatisch
 *   demselben Fall zugeordnet werden (andere/fehlende sickCaseId, leerer Arbeitstag).
 * - "sick-legacy-over-limit": Tag vor dem Stichtag, bisher bezahlt, nach der
 *   Fortsetzungsregel aber jenseits von 42 Tagen (keine automatische Neuberechnung).
 */
export type SickCaseNotice = "sick-case-ambiguous" | "sick-legacy-over-limit";

export interface PayrollOptions extends ResolveOptions {
  /** Alle bekannten Schichten (für Muster-, Krankheitsfall- und 13-Wochen-Auswertung). */
  history?: Shift[];
  /**
   * Stichtag der Fortsetzungsregel (Default {@link SICK_CONTINUOUS_RULE_FROM}).
   * Vorgesehen für eine spätere, vom Nutzer bestätigte Neuberechnung.
   */
  sickContinuousFrom?: string;
}

/* ------------------------- Hilfen ------------------------- */

function toDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toDate(toIso).getTime() - toDate(fromIso).getTime()) / 86_400_000);
}

/** Wochentagsindex ab Montag (0 = Montag). */
function weekIndex(iso: string): number {
  return (toDate(iso).getDay() + 6) % 7;
}

function sameJob(shift: Shift, jobId?: string): boolean {
  return (shift.jobId ?? undefined) === (jobId ?? undefined);
}

function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const dayIndexCache = new WeakMap<Shift[], Map<string, Shift[]>>();

/** Einträge eines Jobs an einem Tag (indiziert je History-Array). */
function entriesOn(history: Shift[], jobId: string | undefined, date: string): Shift[] {
  let index = dayIndexCache.get(history);
  if (!index) {
    index = new Map();
    for (const s of history) {
      const key = `${s.jobId ?? ""}|${s.date}`;
      const list = index.get(key);
      if (list) list.push(s);
      else index.set(key, [s]);
    }
    dayIndexCache.set(history, index);
  }
  return index.get(`${jobId ?? ""}|${date}`) ?? [];
}

/**
 * War der Tag nach dem regelmäßigen Arbeitsmuster ein Arbeitstag?
 * 1. Festplan des Jobs (`job.week`) ist maßgeblich.
 * 2. Ohne Festplan: Muster aus der Historie – an mindestens zwei der letzten
 *    vier gleichen Wochentage wurde tatsächlich gearbeitet.
 */
export function isRegularWorkday(
  date: string,
  job: Job | undefined,
  history: Shift[] = [],
): boolean {
  const week = job ? weekForDate(job, date) : undefined;
  if (week) return week[weekIndex(date)]?.active === true;
  const idx = weekIndex(date);
  const previous = history
    .filter(
      (s) =>
        s.kind === "arbeit" &&
        sameJob(s, job?.id) &&
        s.date < date &&
        weekIndex(s.date) === idx &&
        daysBetween(s.date, date) <= 28,
    )
    .map((s) => s.date);
  return new Set(previous).size >= 2;
}

/** Regelmäßige Arbeitszeit des Tages in Stunden (Entgeltausfallprinzip, § 4 EntgFG). */
export function regularHoursFor(
  shift: Shift,
  job: Job | undefined,
  history: Shift[] = [],
): { hours: number; basis: PayBasis } {
  const plan = job ? weekForDate(job, shift.date)?.[weekIndex(shift.date)] : undefined;
  if (plan?.active) {
    return {
      hours: shiftHours({
        ...shift,
        start: plan.start,
        end: plan.end,
        breakMinutes: plan.breakMinutes,
      }),
      basis: "plan",
    };
  }
  const idx = weekIndex(shift.date);
  const recent = history.filter(
    (s) =>
      s.kind === "arbeit" &&
      sameJob(s, job?.id) &&
      s.date < shift.date &&
      weekIndex(s.date) === idx &&
      daysBetween(s.date, shift.date) <= VACATION_REFERENCE_DAYS,
  );
  if (recent.length) {
    const total = recent.reduce((acc, s) => acc + shiftHours(s), 0);
    return { hours: total / recent.length, basis: "average13" };
  }
  return { hours: shiftHours(shift), basis: "entry" };
}

/**
 * Beginn des ausdrücklich zugeordneten Krankheitsfalls.
 *
 * Ohne `sickCaseId` liefert diese Funktion nur den Eintrag selbst; die
 * Fortsetzungsregel für Einträge ohne ID steht in {@link continuousSickCase}.
 */
export function sickCaseStart(shift: Shift, history: Shift[] = []): string {
  if (!shift.sickCaseId) return shift.date;
  const dates = history
    .filter(
      (s) =>
        s.kind === "krank" &&
        sameJob(s, shift.jobId) &&
        s.sickCaseId === shift.sickCaseId &&
        s.date <= shift.date,
    )
    .map((s) => s.date);
  dates.push(shift.date);
  return dates.sort()[0] ?? shift.date;
}

export interface SickCase {
  /** Erster Tag des (vermuteten) Krankheitsfalls. */
  start: string;
  /** true = angrenzende Einträge wurden bewusst nicht zusammengeführt. */
  ambiguous: boolean;
}

/** Maximale Rückschau beim Verketten (42 Tage + eine Woche Lücken-Puffer). */
const SICK_LOOKBACK_DAYS = SICK_MAX_DAYS + 7;

/**
 * Geht vom Tag `fromDate` rückwärts über leere, nicht regelmäßige Arbeitstage
 * und liefert den ersten Tag mit Einträgen bzw. einen leeren regelmäßigen
 * Arbeitstag (Ende der Kette).
 */
function previousRelevantDay(
  fromDate: string,
  shift: Shift,
  job: Job | undefined,
  history: Shift[],
  limitDate: string,
): { date: string; entries: Shift[] } | undefined {
  let cursor = addDays(fromDate, -1);
  while (cursor >= limitDate) {
    const entries = entriesOn(history, shift.jobId, cursor).filter((s) => s.id !== shift.id);
    if (entries.length) return { date: cursor, entries };
    if (isRegularWorkday(cursor, job, history)) return { date: cursor, entries: [] };
    cursor = addDays(cursor, -1);
  }
  return undefined;
}

function hasSickNearBefore(
  date: string,
  shift: Shift,
  job: Job | undefined,
  history: Shift[],
): boolean {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(date, -i);
    const entries = entriesOn(history, shift.jobId, d);
    if (entries.some((s) => s.kind === "krank")) return true;
    if (entries.length) return false;
  }
  return false;
}

/**
 * Vermuteter Krankheitsfall für einen Eintrag OHNE `sickCaseId`:
 * zusammenhängende "krank"-Tage desselben Jobs ohne `sickCaseId`.
 */
export function continuousSickCase(
  shift: Shift,
  job: Job | undefined,
  history: Shift[] = [],
): SickCase {
  let start = shift.date;
  let ambiguous = false;
  const limitDate = addDays(shift.date, -SICK_LOOKBACK_DAYS);
  let cursor = shift.date;
  while (daysBetween(start, shift.date) < SICK_MAX_DAYS) {
    const prev = previousRelevantDay(cursor, shift, job, history, limitDate);
    if (!prev) break;
    const { date, entries } = prev;
    if (!entries.length) {
      // Leerer regelmäßiger Arbeitstag beendet den Fall; folgt davor direkt
      // wieder Krankheit, ist die Zuordnung unklar → nur Hinweis.
      if (hasSickNearBefore(date, shift, job, history)) ambiguous = true;
      break;
    }
    const sick = entries.filter((s) => s.kind === "krank");
    if (sick.length !== entries.length) break; // Arbeit/Urlaub/… beendet den Fall
    if (sick.some((s) => s.sickCaseId)) {
      ambiguous = true; // explizit zugeordneter Fall grenzt an – nicht verketten
      break;
    }
    start = date;
    cursor = date;
  }
  return { start, ambiguous };
}

/** Grenzt an einen explizit zugeordneten Fall unmittelbar ein anderer Krankheitseintrag? */
function explicitCaseAmbiguous(
  shift: Shift,
  caseStart: string,
  job: Job | undefined,
  history: Shift[],
): boolean {
  const prev = previousRelevantDay(caseStart, shift, job, history, addDays(caseStart, -7));
  return (
    !!prev &&
    prev.entries.length > 0 &&
    prev.entries.every((s) => s.kind === "krank") &&
    prev.entries.some((s) => s.sickCaseId !== shift.sickCaseId)
  );
}

/**
 * Urlaubsentgelt je Urlaubstag aus dem 13-Wochen-Durchschnitt (§ 11 BUrlG).
 * Gibt undefined zurück, wenn zu wenige Referenztage vorliegen.
 */
export function vacationDailyPay(
  shift: Shift,
  options: PayrollOptions,
): { amount: number; hours: number } | undefined {
  const history = options.history ?? [];
  const reference = history.filter(
    (s) =>
      s.kind === "arbeit" &&
      sameJob(s, shift.jobId) &&
      s.date < shift.date &&
      daysBetween(s.date, shift.date) <= VACATION_REFERENCE_DAYS,
  );
  const days = new Set(reference.map((s) => s.date)).size;
  if (days < VACATION_MIN_REFERENCE_DAYS) return undefined;
  const earnings = reference.reduce((total, referenceShift) => {
    const breakdown = shiftBreakdown(referenceShift, {
      job: options.job,
      supplements: options.supplements,
      defaultRate: options.defaultRate,
    });
    // § 11 BUrlG: Vergütung für Überstunden gehört nicht in den
    // 13-Wochen-Durchschnitt des Urlaubsentgelts.
    const overtime = referenceShift.overtime
      ? (() => {
          const supplement = (options.job?.supplements ?? options.supplements)?.overtime;
          if (!supplement?.enabled) return 0;
          const rate = effectiveShiftRate(referenceShift, {
            job: options.job,
            defaultRate: options.defaultRate,
          });
          return supplement.mode === "prozent"
            ? (breakdown.hours * rate * supplement.value) / 100
            : breakdown.hours * supplement.value;
        })()
      : 0;
    return total + breakdown.total - overtime;
  }, 0);
  const hours = reference.reduce((acc, s) => acc + shiftHours(s), 0);
  return { amount: earnings / days, hours: hours / days };
}

/* ------------------------- Kern ------------------------- */

/** Payroll-Bewertung einer einzelnen Schicht bzw. Abwesenheit. */
export function shiftPayroll(shift: Shift, options: PayrollOptions = {}): ShiftPayroll {
  const history = options.history ?? [];
  const job = options.job;
  const rate = effectiveShiftRate(shift, { job, defaultRate: options.defaultRate });

  if (shift.kind === "arbeit") {
    const b = shiftBreakdown(shift, options);
    return {
      kind: shift.kind,
      workedHours: b.hours,
      paidAbsenceHours: 0,
      earnings: b.total,
      base: b.base,
      bonus: b.bonus,
      paid: true,
      reason: "worked",
      basis: "worked",
      estimated: false,
    };
  }

  const unpaid = (reason: PayReason): ShiftPayroll => ({
    kind: shift.kind,
    workedHours: 0,
    paidAbsenceHours: 0,
    earnings: 0,
    base: 0,
    bonus: 0,
    paid: false,
    reason,
    basis: "none",
    estimated: false,
  });

  const regular = isRegularWorkday(shift.date, job, history);

  if (shift.kind === "feiertag") {
    if (!regular) return unpaid("holiday-off-day");
    const { hours, basis } = regularHoursFor(shift, job, history);
    return {
      kind: shift.kind,
      workedHours: 0,
      paidAbsenceHours: hours,
      earnings: hours * rate,
      base: hours * rate,
      bonus: 0,
      paid: true,
      reason: "holiday-pay",
      basis,
      estimated: basis !== "plan",
    };
  }

  if (shift.kind === "krank") {
    if (!regular) return unpaid("sick-off-day");
    if (job?.startDate && daysBetween(job.startDate, shift.date) < SICK_WAITING_DAYS) {
      return unpaid("sick-waiting");
    }
    let caseStart: string;
    let notice: SickCaseNotice | undefined;
    if (shift.sickCaseId) {
      caseStart = sickCaseStart(shift, history);
      if (explicitCaseAmbiguous(shift, caseStart, job, history)) notice = "sick-case-ambiguous";
    } else {
      const presumed = continuousSickCase(shift, job, history);
      if (presumed.ambiguous) notice = "sick-case-ambiguous";
      const from = options.sickContinuousFrom ?? SICK_CONTINUOUS_RULE_FROM;
      if (shift.date >= from) {
        caseStart = presumed.start;
      } else {
        // Vor dem Stichtag: bisheriges Verhalten, keine automatische Neuberechnung.
        caseStart = shift.date;
        if (daysBetween(presumed.start, shift.date) >= SICK_MAX_DAYS) {
          notice = "sick-legacy-over-limit";
        }
      }
    }
    if (daysBetween(caseStart, shift.date) >= SICK_MAX_DAYS) {
      return { ...unpaid("sick-exceeded"), ...(notice ? { notice } : {}) };
    }
    const { hours, basis } = regularHoursFor(shift, job, history);
    return {
      ...(notice ? { notice } : {}),
      kind: shift.kind,
      workedHours: 0,
      paidAbsenceHours: hours,
      earnings: hours * rate,
      base: hours * rate,
      bonus: 0,
      paid: true,
      reason: "sick-pay",
      basis,
      // Ohne hinterlegten Beschäftigungsbeginn ist die Wartezeit nicht prüfbar.
      estimated: basis !== "plan" || !job?.startDate,
    };
  }

  // Unbezahlte Abwesenheit (frei / sonstige) — vor Urlaub-Fallback, sonst greift vacation-pay.
  if (shift.kind === "frei" || shift.kind === "sonstige") {
    return unpaid("unpaid-absence");
  }

  // Urlaub: bezahlte Abwesenheit, Entgelt nach 13-Wochen-Durchschnitt.
  const average = vacationDailyPay(shift, options);
  if (average) {
    return {
      kind: shift.kind,
      workedHours: 0,
      paidAbsenceHours: average.hours,
      earnings: average.amount,
      base: average.amount,
      bonus: 0,
      paid: true,
      reason: "vacation-pay",
      basis: "average13",
      estimated: false,
    };
  }
  const { hours, basis } = regularHoursFor(shift, job, history);
  return {
    kind: shift.kind,
    workedHours: 0,
    paidAbsenceHours: hours,
    earnings: hours * rate,
    base: hours * rate,
    bonus: 0,
    paid: true,
    reason: "vacation-pay",
    basis,
    estimated: true,
  };
}

export interface PayrollTotals {
  /** Tatsächlich geleistete Arbeitsstunden (Basis der Stundengrenze). */
  workedHours: number;
  /** Bezahlte Ausfallstunden (Urlaub / Krank / Feiertag). */
  paidAbsenceHours: number;
  /** Entgelt aus geleisteter Arbeit. */
  workEarnings: number;
  /** Entgelt aus bezahlter Abwesenheit. */
  absenceEarnings: number;
  /** Gesamtes Arbeitsentgelt (zählt zur Minijob-Einkommensgrenze). */
  earnings: number;
  /** true, wenn mindestens eine Position auf einer Schätzung beruht. */
  estimated: boolean;
}

/** Summiert die Payroll-Bewertung über einen Zeitraum. */
export function payrollTotals(
  shifts: Shift[],
  resolve: (shift: Shift) => ResolveOptions,
  history: Shift[] = shifts,
): PayrollTotals {
  const totals: PayrollTotals = {
    workedHours: 0,
    paidAbsenceHours: 0,
    workEarnings: 0,
    absenceEarnings: 0,
    earnings: 0,
    estimated: false,
  };
  for (const shift of shifts) {
    const p = shiftPayroll(shift, { ...resolve(shift), history });
    totals.workedHours += p.workedHours;
    totals.paidAbsenceHours += p.paidAbsenceHours;
    if (p.kind === "arbeit") totals.workEarnings += p.earnings;
    else totals.absenceEarnings += p.earnings;
    totals.earnings += p.earnings;
    if (p.estimated) totals.estimated = true;
  }
  return totals;
}

/**
 * Erkennung (keine Neuberechnung): Krankheitstage vor dem Stichtag, die nach
 * bisherigem Verhalten bezahlt werden, nach der Fortsetzungsregel aber
 * jenseits von 42 Tagen lägen. Grundlage für einen Hinweis an den Nutzer.
 */
export function sickLegacyDiscrepancies(
  shifts: Shift[],
  resolve: (shift: Shift) => ResolveOptions,
  history: Shift[] = shifts,
): Shift[] {
  return shifts.filter(
    (shift) =>
      shift.kind === "krank" &&
      shiftPayroll(shift, { ...resolve(shift), history }).notice === "sick-legacy-over-limit",
  );
}
