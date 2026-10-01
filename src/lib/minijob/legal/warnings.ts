import type { ForecastMonth, Rolling12ForecastResult } from "./rolling";

/** User-facing warning states. These are product states, not legal conclusions. */
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

const NEAR_LIMIT_RATIO = 0.85;

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

  if (month.projected > month.limit * 2) {
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

  if (month.projected > month.limit) {
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
