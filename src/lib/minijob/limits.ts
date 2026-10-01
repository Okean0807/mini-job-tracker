import { shiftsInMonth, shiftsInYear } from "./calc";
import {
  findRuleVersion,
  minijobLimitFromWage,
  isEligibleMinijobShift,
} from "./legal";
import { effectiveHourlyFromMonthly } from "./rate";
import { payrollTotals } from "./payroll";
import { buildMonthlyIncomeFromShifts, legalActualIncomeForMonth, legalActualIncomeForYear } from "./legal/integration";
import type { Resolver } from "./resolve";
import type { Job, Settings, Shift } from "./types";

export interface LimitUsage {
  earnings: number;
  earningsLimit: number;
  earningsShare: number;
  hours: number;
  hoursLimit: number;
  hoursShare: number;
  earningsLeft: number;
  hoursLeft: number;
  /** Höherer der beiden Anteile – für Warnungen. */
  share: number;
  /** Quelle der Einkommensgrenze: gesetzlich (stichtagsbezogen) oder manuell. */
  limitSource: LimitSource;
  /** Bezahlte Ausfallstunden (Urlaub/Krank/Feiertag) – nicht in `hours` enthalten. */
  paidAbsenceHours: number;
  /** Entgeltfortzahlung – in `earnings` enthalten, zählt zur Geringfügigkeitsgrenze. */
  absenceEarnings: number;
  /** true, wenn mindestens eine Fortzahlung auf einer Schätzung beruht. */
  estimated: boolean;
  /** Zusätzlich erwartetes Entgelt aus zukünftigen Einträgen dieses Zeitraums. */
  expectedAdditional: number;
  /** Prognose aus tatsächlichem + erwartetem Entgelt. */
  projectedEarnings: number;
  /** Stichtag, bis zu dem Einkommen als tatsächlich angefallen gilt. */
  referenceDate: string;
}

export type LimitSource = "legal" | "manual";

/** Erster Tag eines Monats als ISO-Datum (Stichtag der Regelauflösung). */
function periodDate(year: number, month = 0): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/**
 * Gesetzliche Geringfügigkeitsgrenze zum Stichtag.
 * Gibt undefined zurück, wenn für das Datum keine Regelversion hinterlegt ist
 * (z. B. Zeiträume vor der ältesten Version) – dann gilt der Nutzerwert.
 */
export function legalMonthlyLimit(year: number, month = 0): number | undefined {
  const version = findRuleVersion(periodDate(year, month));
  return version ? minijobLimitFromWage(version.minimumWage) : undefined;
}

/** Nutzt der Anwender die gesetzliche Grenze (Standard) oder einen eigenen Wert? */
export function usesLegalLimit(settings: Settings): boolean {
  return settings.limitAuto !== false;
}

/**
 * Maßgebliche Monatsgrenze für einen Zeitraum.
 * Ohne Zeitraum wird das laufende Jahr/der laufende Monat verwendet, damit
 * bestehende Aufrufer weiterhin einen sinnvollen Wert erhalten.
 */
export function monthlyLimitOf(settings: Settings, year?: number, month?: number): number {
  if (!usesLegalLimit(settings)) return settings.monthlyLimit;
  const now = new Date();
  const legal = legalMonthlyLimit(year ?? now.getFullYear(), month ?? now.getMonth());
  return legal ?? settings.monthlyLimit;
}

/** Quelle der verwendeten Monatsgrenze. */
export function limitSourceOf(settings: Settings, year?: number, month?: number): LimitSource {
  if (!usesLegalLimit(settings)) return "manual";
  const now = new Date();
  return legalMonthlyLimit(year ?? now.getFullYear(), month ?? now.getMonth()) === undefined
    ? "manual"
    : "legal";
}

/**
 * Stundengrenze pro Monat. Ist keine eigene Grenze gesetzt,
 * ergibt sie sich aus Einkommensgrenze / Stundenlohn (z. B. 603 € / 15,50 € = 38,90 h).
 */
export function monthlyHoursLimit(settings: Settings, year?: number, month?: number): number {
  if (!settings.hoursLimitAuto && settings.hoursLimitMonthly && settings.hoursLimitMonthly > 0) {
    return settings.hoursLimitMonthly;
  }
  return autoHoursLimit(settings, year, month);
}

/** Stundengrenze aus Monatsgrenze ÷ Stundenlohn. */
export function autoHoursLimit(settings: Settings, year?: number, month?: number): number {
  const rate = settings.defaultRate;
  const limit = monthlyLimitOf(settings, year, month);
  if (!rate || rate <= 0 || !limit) return 0;
  return limit / rate;
}

/**
 * Jahresgrenze: Summe der zwölf Monatsgrenzen des Jahres.
 * Dadurch bleiben unterjährige Rechtsänderungen korrekt abgebildet.
 */
export function yearlyLimitOf(settings: Settings, year?: number): number {
  if (!usesLegalLimit(settings)) return settings.monthlyLimit * 12;
  const y = year ?? new Date().getFullYear();
  let sum = 0;
  for (let m = 0; m < 12; m++) sum += monthlyLimitOf(settings, y, m);
  return sum;
}

/** Jahres-Stundengrenze: Summe der zwölf Monats-Stundengrenzen. */
export function yearlyHoursLimitOf(settings: Settings, year?: number): number {
  const y = year ?? new Date().getFullYear();
  let sum = 0;
  for (let m = 0; m < 12; m++) sum += monthlyHoursLimit(settings, y, m);
  return sum;
}

/**
 * Filtert die für die gesetzliche Minijob-Grenze relevanten Schichten.
 *
 * Die Resolver-Auflösung ist absichtlich die Quelle für den Job, damit alte
 * Aufrufer keine neue `jobs`-Dependency benötigen.
 */
function eligibleMinijobShifts(shifts: Shift[], resolve: Resolver): Shift[] {
  return shifts.filter((shift) => {
    const job = resolve(shift).job;
    return isEligibleMinijobShift(shift, job);
  });
}

/**
 * Eine einzelne Minijob-Beschäftigung kann informativ eine Stundenobergrenze
 * aus Grenzbetrag / Stundensatz anzeigen.
 *
 * Bei mehreren Minijobs mit unterschiedlichen Sätzen gibt es bewusst keine
 * künstliche gemeinsame Stundenobergrenze: rechtlich maßgeblich ist die
 * gemeinsame Entgeltgrenze. `0` bedeutet hier "keine belastbare Stundenbasis".
 */
function hoursLimitForEligibleShifts(
  shifts: Shift[],
  resolve: Resolver,
  settings: Settings,
  year: number,
  month: number,
): number {
  if (!settings.hoursLimitAuto && settings.hoursLimitMonthly > 0) {
    return settings.hoursLimitMonthly;
  }

  const jobs = new Map<string, Job | undefined>();
  for (const shift of shifts) {
    const job = resolve(shift).job;
    jobs.set(job?.id ?? "__unassigned__", job);
  }

  if (jobs.size === 0) return 0;

  const rates = new Set<number>();
  for (const job of jobs.values()) {
    if (!job) {
      if (settings.defaultRate > 0) rates.add(settings.defaultRate);
      continue;
    }
    const rate =
      typeof job.rate === "number"
        ? job.rate
        : effectiveHourlyFromMonthly(job) ?? settings.defaultRate;
    if (rate > 0) rates.add(rate);
  }

  if (rates.size !== 1) return 0;
  const rate = [...rates][0]!;
  if (!rate) return 0;

  const limit = monthlyLimitOf(settings, year, month);
  return limit > 0 ? limit / rate : 0;
}

function yearlyHoursLimitForEligibleShifts(
  shifts: Shift[],
  resolve: Resolver,
  settings: Settings,
  year: number,
): number {
  if (!settings.hoursLimitAuto && settings.hoursLimitMonthly > 0) {
    return settings.hoursLimitMonthly * 12;
  }

  const jobs = new Map<string, Job | undefined>();
  for (const shift of shifts) {
    const job = resolve(shift).job;
    jobs.set(job?.id ?? "__unassigned__", job);
  }

  if (jobs.size === 0) return 0;

  const rates = new Set<number>();
  for (const job of jobs.values()) {
    if (!job) {
      if (settings.defaultRate > 0) rates.add(settings.defaultRate);
      continue;
    }
    const rate =
      typeof job.rate === "number"
        ? job.rate
        : effectiveHourlyFromMonthly(job) ?? settings.defaultRate;
    if (rate > 0) rates.add(rate);
  }

  if (rates.size !== 1) return 0;
  const rate = [...rates][0]!;
  if (!rate) return 0;

  const limit = yearlyLimitOf(settings, year);
  return limit > 0 ? limit / rate : 0;
}

function usage(
  earnings: number,
  earningsLimit: number,
  hours: number,
  hoursLimit: number,
  limitSource: LimitSource,
  extra: {
    paidAbsenceHours: number;
    absenceEarnings: number;
    estimated: boolean;
    expectedAdditional?: number;
    referenceDate?: string;
  } = {
    paidAbsenceHours: 0,
    absenceEarnings: 0,
    estimated: false,
  },
): LimitUsage {
  const earningsShare = earningsLimit > 0 ? (earnings / earningsLimit) * 100 : 0;
  const hoursShare = hoursLimit > 0 ? (hours / hoursLimit) * 100 : 0;
  return {
    earnings,
    earningsLimit,
    earningsShare,
    hours,
    hoursLimit,
    hoursShare,
    earningsLeft: Math.max(0, earningsLimit - earnings),
    hoursLeft: Math.max(0, hoursLimit - hours),
    share: Math.max(earningsShare, hoursShare),
    limitSource,
    expectedAdditional: extra.expectedAdditional ?? 0,
    projectedEarnings: earnings + (extra.expectedAdditional ?? 0),
    referenceDate: extra.referenceDate ?? new Date().toISOString().slice(0, 10),
    ...extra,
  };
}

export function monthUsage(
  shifts: Shift[],
  resolve: Resolver,
  settings: Settings,
  year: number,
  month: number,
  referenceDate = new Date().toISOString().slice(0, 10),
): LimitUsage {
  const list = eligibleMinijobShifts(shiftsInMonth(shifts, year, month), resolve);
  const actualList = list.filter((shift) => shift.date <= referenceDate);
  const totals = payrollTotals(actualList, resolve, shifts);
  const legalEarnings = legalActualIncomeForMonth(shifts, resolve, year, month, referenceDate);
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const breakdown = buildMonthlyIncomeFromShifts(shifts, resolve, referenceDate).find((entry) => entry.date === monthKey);
  return usage(
    legalEarnings,
    monthlyLimitOf(settings, year, month),
    totals.workedHours,
    hoursLimitForEligibleShifts(actualList, resolve, settings, year, month),
    limitSourceOf(settings, year, month),
    {
      paidAbsenceHours: totals.paidAbsenceHours,
      absenceEarnings: totals.absenceEarnings,
      estimated: totals.estimated,
      expectedAdditional: breakdown?.expectedAdditional ?? 0,
      referenceDate,
    },
  );
}

export function yearUsage(
  shifts: Shift[],
  resolve: Resolver,
  settings: Settings,
  year: number,
  referenceDate = new Date().toISOString().slice(0, 10),
): LimitUsage {
  const list = shiftsInYear(shifts, year)
    .filter((shift) => isEligibleMinijobShift(shift, resolve(shift).job));
  const actualList = list.filter((shift) => shift.date <= referenceDate);
  const totals = payrollTotals(actualList, resolve, shifts);
  const legalEarnings = legalActualIncomeForYear(shifts, resolve, year, referenceDate);
  const breakdown = buildMonthlyIncomeFromShifts(shifts, resolve, referenceDate)
    .filter((entry) => entry.date.startsWith(`${year}-`));
  const expectedAdditional = breakdown.reduce((sum, entry) => sum + entry.expectedAdditional, 0);
  return usage(
    legalEarnings,
    yearlyLimitOf(settings, year),
    totals.workedHours,
    yearlyHoursLimitForEligibleShifts(actualList, resolve, settings, year),
    limitSourceOf(settings, year, 0),
    {
      paidAbsenceHours: totals.paidAbsenceHours,
      absenceEarnings: totals.absenceEarnings,
      estimated: totals.estimated,
      expectedAdditional,
      referenceDate,
    },
  );
}
