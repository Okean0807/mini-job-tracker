import { shiftsInMonth, shiftsInYear, sumEarnings, sumHours } from "./calc";
import { findRuleVersion, minijobLimitFromWage } from "./legal";
import type { Resolver } from "./resolve";
import type { Settings, Shift } from "./types";

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

function usage(
  earnings: number,
  earningsLimit: number,
  hours: number,
  hoursLimit: number,
  limitSource: LimitSource,
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
  };
}

export function monthUsage(
  shifts: Shift[],
  resolve: Resolver,
  settings: Settings,
  year: number,
  month: number,
): LimitUsage {
  const list = shiftsInMonth(shifts, year, month);
  return usage(
    sumEarnings(list, resolve),
    monthlyLimitOf(settings, year, month),
    sumHours(list),
    monthlyHoursLimit(settings, year, month),
    limitSourceOf(settings, year, month),
  );
}

export function yearUsage(
  shifts: Shift[],
  resolve: Resolver,
  settings: Settings,
  year: number,
): LimitUsage {
  const list = shiftsInYear(shifts, year);
  return usage(
    sumEarnings(list, resolve),
    yearlyLimitOf(settings, year),
    sumHours(list),
    yearlyHoursLimitOf(settings, year),
    limitSourceOf(settings, year, 0),
  );
}
