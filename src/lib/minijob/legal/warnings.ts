import { exceedsAmount } from "./amounts";
import type { ForecastMonth, Rolling12ForecastResult } from "./rolling";

/**
 * States of the informational rolling earnings indicator ("Verdienste der letzten 12 Monate").
 * These are product states, NOT legal conclusions: the indicator adds up recorded earnings
 * (plus shifts entered with a future date) of the 12 calendar months ending at the displayed
 * month and compares them with the sum of those months' monthly limits. It is not the
 * statutory, forward-looking assessment of the regular earnings over the employment period
 * (§ 8 SGB IV), so "exceeded" here only means "above the reference range", and "OK" does not
 * mean the employment is a compliant Minijob. The identifiers keep their historic names.
 */
export type LegalWarningStatus =
  | "OK"
  | "NEAR_LIMIT"
  | "REGULAR_LIMIT_EXCEEDED"
  | "UNPREDICTABLE_EXCEEDANCE_POSSIBLE"
  | "MAXIMUM_EXCEEDED";

export interface LegalWarningAssessment {
  status: LegalWarningStatus;
  ratio: number;
  projected: number;
  regularLimit: number;
  maximumAllowed: number;
  remainingSpecialMonths: number;
  reason: "within_limit" | "near_limit" | "regular_exceeded" | "special_rule_may_apply" | "maximum_exceeded";
}

/**
 * True for the states in which the rolling earnings indicator is above its reference range.
 * Every surface that shows this indicator (card, banner, "Heute wichtig", notification)
 * derives "above the reference range" from this, so they cannot contradict each other.
 * It is not a legal finding.
 */
export function isAboveRollingFrame(status: LegalWarningStatus): boolean {
  return (
    status === "REGULAR_LIMIT_EXCEEDED" ||
    status === "UNPREDICTABLE_EXCEEDANCE_POSSIBLE" ||
    status === "MAXIMUM_EXCEEDED"
  );
}

/**
 * Informational signal: at least one month of the rolling window is above twice the
 * monthly reference. It is NOT the statutory exception for unpredictable exceedance (which
 * has its own conditions: an unforeseeable reason, at most two months) and it is NOT a
 * threshold from the law: the sources give no numeric line for fluctuating earnings (the
 * Minijob-Zentrale example of 1,800 EUR for three months plus 204 EUR for nine months,
 * 7,236 EUR in total, is the reason the signal exists). It must not be used to establish
 * compliance or non-compliance, and its absence does not mean fluctuating earnings are
 * acceptable.
 */
export function hasMonthAboveDoubleReference(forecast: Rolling12ForecastResult): boolean {
  return forecast.months.some((month) => month.exceedsMaximumUnpredictableLimit);
}

/** Business/UX rule (not legal): "near limit" from 85 % of the limit on. */
export const NEAR_LIMIT_RATIO = 0.85;

/**
 * Evaluates one forecast month. The function deliberately does not decide
 * whether an exceedance is legally "unpredictable"; it only reflects an
 * explicit documented flag supplied by the caller.
 */
export function evaluateForecastMonthWarning(
  month: ForecastMonth,
  usedSpecialMonths = 0,
): LegalWarningAssessment {
  const ratio = month.limit > 0 ? month.projected / month.limit : 0;
  const remainingSpecialMonths = Math.max(0, 2 - usedSpecialMonths);

  if (exceedsAmount(month.projected, month.limit * 2)) {
    return {
      status: "MAXIMUM_EXCEEDED",
      ratio,
      projected: month.projected,
      regularLimit: month.limit,
      maximumAllowed: month.limit * 2,
      remainingSpecialMonths,
      reason: "maximum_exceeded",
    };
  }

  if (exceedsAmount(month.projected, month.limit)) {
    const specialPossible = month.unpredictable && remainingSpecialMonths > 0;
    return {
      status: specialPossible ? "UNPREDICTABLE_EXCEEDANCE_POSSIBLE" : "REGULAR_LIMIT_EXCEEDED",
      ratio,
      projected: month.projected,
      regularLimit: month.limit,
      maximumAllowed: month.limit * 2,
      remainingSpecialMonths,
      reason: specialPossible ? "special_rule_may_apply" : "regular_exceeded",
    };
  }

  if (ratio >= NEAR_LIMIT_RATIO) {
    return {
      status: "NEAR_LIMIT",
      ratio,
      projected: month.projected,
      regularLimit: month.limit,
      maximumAllowed: month.limit * 2,
      remainingSpecialMonths,
      reason: "near_limit",
    };
  }

  return {
    status: "OK",
    ratio,
    projected: month.projected,
    regularLimit: month.limit,
    maximumAllowed: month.limit * 2,
    remainingSpecialMonths,
    reason: "within_limit",
  };
}

/**
 * Evaluates the complete rolling forecast. A rolling annual forecast can be
 * above the regular annual envelope while still being inside the calculated
 * envelope created by explicitly documented unpredictable months. In that
 * case we surface that possibility rather than declaring the situation legal.
 */
export function evaluateRollingWarning(
  forecast: Rolling12ForecastResult,
): LegalWarningAssessment {
  const ratio = forecast.regularLimit > 0
    ? forecast.projectedEarnings / forecast.regularLimit
    : 0;
  const remainingSpecialMonths = Math.max(0, 2 - forecast.unpredictableMonths);

  if (forecast.exceedsMaximumAllowedIncome) {
    return {
      status: "MAXIMUM_EXCEEDED",
      ratio,
      projected: forecast.projectedEarnings,
      regularLimit: forecast.regularLimit,
      maximumAllowed: forecast.maximumAllowedIncome,
      remainingSpecialMonths,
      reason: "maximum_exceeded",
    };
  }

  if (forecast.exceedsRegularLimit) {
    const hasSpecialAllowance = forecast.unpredictableMonths > 0;
    return {
      status: hasSpecialAllowance
        ? "UNPREDICTABLE_EXCEEDANCE_POSSIBLE"
        : "REGULAR_LIMIT_EXCEEDED",
      ratio,
      projected: forecast.projectedEarnings,
      regularLimit: forecast.regularLimit,
      maximumAllowed: forecast.maximumAllowedIncome,
      remainingSpecialMonths,
      reason: hasSpecialAllowance ? "special_rule_may_apply" : "regular_exceeded",
    };
  }

  if (ratio >= NEAR_LIMIT_RATIO) {
    return {
      status: "NEAR_LIMIT",
      ratio,
      projected: forecast.projectedEarnings,
      regularLimit: forecast.regularLimit,
      maximumAllowed: forecast.maximumAllowedIncome,
      remainingSpecialMonths,
      reason: "near_limit",
    };
  }

  return {
    status: "OK",
    ratio,
    projected: forecast.projectedEarnings,
    regularLimit: forecast.regularLimit,
    maximumAllowed: forecast.maximumAllowedIncome,
    remainingSpecialMonths,
    reason: "within_limit",
  };
}
