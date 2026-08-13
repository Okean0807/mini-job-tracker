import { shiftsInMonth, shiftsInYear, sumEarnings, sumHours } from "./calc";
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
}

/**
 * Stundengrenze pro Monat. Ist keine eigene Grenze gesetzt,
 * ergibt sie sich aus Einkommensgrenze / Stundenlohn (z. B. 556 € / 15,50 € = 35,87 h).
 */
export function monthlyHoursLimit(settings: Settings): number {
  if (settings.hoursLimitMonthly && settings.hoursLimitMonthly > 0) {
    return settings.hoursLimitMonthly;
  }
  const rate = settings.defaultRate;
  if (!rate || rate <= 0 || !settings.monthlyLimit) return 0;
  return settings.monthlyLimit / rate;
}

function usage(
  earnings: number,
  earningsLimit: number,
  hours: number,
  hoursLimit: number,
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
    settings.monthlyLimit,
    sumHours(list),
    monthlyHoursLimit(settings),
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
    settings.yearlyLimit,
    sumHours(list),
    monthlyHoursLimit(settings) * 12,
  );
}
