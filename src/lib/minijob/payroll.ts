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
 * No calendar-gap heuristic is used for sickness cases. The legal question
 * is whether the incapacity is the same illness; the app cannot infer that
 * from dates alone. Range-created sick entries therefore carry `sickCaseId`.
 */
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
}

export interface PayrollOptions extends ResolveOptions {
  /** Alle bekannten Schichten (für Muster-, Krankheitsfall- und 13-Wochen-Auswertung). */
  history?: Shift[];
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
 * Ohne `sickCaseId` wird nur der aktuelle Eintrag als Fall betrachtet.
 * Das ist absichtlich konservativ: aus einer Datumsnähe lässt sich die
 * "gleiche Krankheit" i. S. d. § 3 Abs. 1 EntgFG nicht zuverlässig ableiten.
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
    const caseStart = sickCaseStart(shift, history);
    if (daysBetween(caseStart, shift.date) >= SICK_MAX_DAYS) return unpaid("sick-exceeded");
    const { hours, basis } = regularHoursFor(shift, job, history);
    return {
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
