import { minijobIncomeLimitFor } from "./index";
import type { MonthlyIncome } from "./exceedance";

export interface Rolling12MonthResult {
  anchorMonth: string;
  months: MonthlyIncome[];
  earnings: number;
  regularLimit: number;
  maximumAllowedIncome: number;
  unpredictableMonths: number;
  allowed: boolean;
}

/** Normalize any ISO date to the first day of its calendar month. */
export function monthStart(date: string): string {
  const [year, month] = date.slice(0, 10).split("-");
  return `${year}-${month}-01`;
}

/** Shift a YYYY-MM-01 month by N calendar months. */
export function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = month.slice(0, 7).split("-").map(Number);
  const d = new Date(year!, monthNumber! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Returns the inclusive 12-calendar-month window ending in anchorMonth.
 * Missing months are inserted as zero-income months so callers can safely
 * use sparse historical data.
 */
export function rolling12Months(
  incomes: MonthlyIncome[],
  anchorMonth: string,
): MonthlyIncome[] {
  const anchor = monthStart(anchorMonth);
  const byMonth = new Map<string, MonthlyIncome>();
  for (const income of incomes) {
    const key = monthStart(income.date);
    const existing = byMonth.get(key);
    if (existing) {
      byMonth.set(key, {
        ...existing,
        earnings: existing.earnings + income.earnings,
        unpredictable: Boolean(existing.unpredictable || income.unpredictable),
      });
    } else {
      byMonth.set(key, { ...income, date: key });
    }
  }

  return Array.from({ length: 12 }, (_, index) => {
    const date = addMonths(anchor, index - 11);
    return (
      byMonth.get(date) ?? {
        date,
        earnings: 0,
        unpredictable: false,
      }
    );
  });
}

/**
 * Evaluates the legal income envelope for the rolling 12-month window.
 *
 * This is intentionally based on earnings, not hours. The separate hours
 * calculation remains an informational aid and must not replace the
 * statutory income test.
 */
export function evaluateRolling12Months(
  incomes: MonthlyIncome[],
  anchorMonth: string,
): Rolling12MonthResult {
  const months = rolling12Months(incomes, anchorMonth);
  const regularLimit = months.reduce(
    (sum, month) => sum + minijobIncomeLimitFor(month.date),
    0,
  );
  const unpredictableMonths = months.filter(
    (month) =>
      Boolean(month.unpredictable) &&
      month.earnings > minijobIncomeLimitFor(month.date),
  ).length;
  const documentedExtra = months.reduce((sum, month) => {
    const limit = minijobIncomeLimitFor(month.date);
    return sum + (month.unpredictable && month.earnings > limit ? limit : 0);
  }, 0);

  const earnings = months.reduce((sum, month) => sum + month.earnings, 0);
  const maximum = regularLimit + documentedExtra;

  return {
    anchorMonth: monthStart(anchorMonth),
    months,
    earnings,
    regularLimit,
    maximumAllowedIncome: maximum,
    unpredictableMonths,
    allowed: unpredictableMonths <= 2 && earnings <= maximum,
  };
}

export interface ForecastInput {
  /** Already earned amount for a month. */
  actual: number;
  /** Expected additional amount for the same month. */
  expectedAdditional?: number;
  /** Explicitly documented unpredictable exceedance for this month. */
  unpredictable?: boolean;
}

export interface ForecastMonth {
  date: string;
  actual: number;
  expectedAdditional: number;
  projected: number;
  limit: number;
  exceedsRegularLimit: boolean;
  exceedsMaximumUnpredictableLimit: boolean;
  unpredictable: boolean;
}

/**
 * Projects the current/future month without changing stored actual income.
 * The projection is deliberately separate from the legal actual-income
 * result: a forecast is a warning signal, not a legal classification.
 */
export function forecastMonth(
  date: string,
  input: ForecastInput,
): ForecastMonth {
  const actual = Math.max(0, input.actual);
  const expectedAdditional = Math.max(0, input.expectedAdditional ?? 0);
  const projected = actual + expectedAdditional;
  const limit = minijobIncomeLimitFor(date);

  return {
    date: monthStart(date),
    actual,
    expectedAdditional,
    projected,
    limit,
    exceedsRegularLimit: projected > limit,
    exceedsMaximumUnpredictableLimit: projected > limit * 2,
    unpredictable: Boolean(input.unpredictable),
  };
}

export interface ForecastRollingMonthInput {
  date: string;
  actual: number;
  expectedAdditional?: number;
  unpredictable?: boolean;
}

export interface Rolling12ForecastResult {
  anchorMonth: string;
  months: ForecastMonth[];
  projectedEarnings: number;
  regularLimit: number;
  maximumAllowedIncome: number;
  unpredictableMonths: number;
  exceedsRegularLimit: boolean;
  exceedsMaximumAllowedIncome: boolean;
  allowedIfForecastRealized: boolean;
}

/**
 * Applies actual + expected income to a rolling 12-month window.
 * Future expectations never overwrite actual income records.
 */
export function forecastRolling12Months(
  inputs: ForecastRollingMonthInput[],
  anchorMonth: string,
): Rolling12ForecastResult {
  const anchor = monthStart(anchorMonth);
  const byMonth = new Map<string, ForecastRollingMonthInput>();

  for (const input of inputs) {
    const key = monthStart(input.date);
    const current = byMonth.get(key);
    byMonth.set(key, current
      ? {
          date: key,
          actual: current.actual + Math.max(0, input.actual),
          expectedAdditional:
            Math.max(0, current.expectedAdditional ?? 0) +
            Math.max(0, input.expectedAdditional ?? 0),
          unpredictable: Boolean(current.unpredictable || input.unpredictable),
        }
      : {
          ...input,
          date: key,
          actual: Math.max(0, input.actual),
          expectedAdditional: Math.max(0, input.expectedAdditional ?? 0),
        });
  }

  const months = Array.from({ length: 12 }, (_, index) => {
    const date = addMonths(anchor, index - 11);
    const input = byMonth.get(date) ?? { date, actual: 0, expectedAdditional: 0 };
    return forecastMonth(date, input);
  });

  const regularLimit = months.reduce((sum, month) => sum + month.limit, 0);
  const unpredictableMonths = months.filter(
    (month) => month.unpredictable && month.projected > month.limit,
  ).length;
  const extraAllowance = months.reduce(
    (sum, month) =>
      sum +
      (month.unpredictable && month.projected > month.limit ? month.limit : 0),
    0,
  );
  const projectedEarnings = months.reduce((sum, month) => sum + month.projected, 0);
  const maximumAllowedIncome = regularLimit + extraAllowance;

  return {
    anchorMonth: anchor,
    months,
    projectedEarnings,
    regularLimit,
    maximumAllowedIncome,
    unpredictableMonths,
    exceedsRegularLimit: projectedEarnings > regularLimit,
    exceedsMaximumAllowedIncome: projectedEarnings > maximumAllowedIncome,
    allowedIfForecastRealized:
      unpredictableMonths <= 2 && projectedEarnings <= maximumAllowedIncome &&
      months.every((month) => !month.exceedsMaximumUnpredictableLimit),
  };
}
