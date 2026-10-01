import { describe, expect, it } from "vitest";
import { evaluateForecastMonthWarning, evaluateRollingWarning } from "./warnings";
import type { ForecastMonth, Rolling12ForecastResult } from "./rolling";

const month = (overrides: Partial<ForecastMonth> = {}): ForecastMonth => ({
  date: "2026-09-01",
  actual: 500,
  expectedAdditional: 50,
  projected: 550,
  limit: 603,
  exceedsRegularLimit: false,
  exceedsMaximumUnpredictableLimit: false,
  unpredictable: false,
  ...overrides,
});

const rolling = (overrides: Partial<Rolling12ForecastResult> = {}): Rolling12ForecastResult => ({
  anchorMonth: "2026-09-01",
  months: [],
  projectedEarnings: 5000,
  regularLimit: 7236,
  maximumAllowedIncome: 7236,
  unpredictableMonths: 0,
  exceedsRegularLimit: false,
  exceedsMaximumAllowedIncome: false,
  allowedIfForecastRealized: true,
  ...overrides,
});

describe("legal warning engine", () => {
  it("returns OK below the threshold", () => {
    expect(evaluateForecastMonthWarning(month({ projected: 500 })).status).toBe("OK");
  });

  it("returns NEAR_LIMIT at 85%", () => {
    expect(evaluateForecastMonthWarning(month({ projected: 513 })).status).toBe("NEAR_LIMIT");
  });

  it("returns REGULAR_LIMIT_EXCEEDED when no special circumstance is documented", () => {
    expect(evaluateForecastMonthWarning(month({ projected: 650 })).status).toBe("REGULAR_LIMIT_EXCEEDED");
  });

  it("returns UNPREDICTABLE_EXCEEDANCE_POSSIBLE only for an explicit special flag", () => {
    expect(
      evaluateForecastMonthWarning(month({ projected: 650, unpredictable: true }), 0).status,
    ).toBe("UNPREDICTABLE_EXCEEDANCE_POSSIBLE");
  });

  it("does not offer a special month after the two-month allowance is used", () => {
    expect(
      evaluateForecastMonthWarning(month({ projected: 650, unpredictable: true }), 2).status,
    ).toBe("REGULAR_LIMIT_EXCEEDED");
  });

  it("returns MAXIMUM_EXCEEDED above twice the monthly limit", () => {
    expect(evaluateForecastMonthWarning(month({ projected: 1207 })).status).toBe("MAXIMUM_EXCEEDED");
  });

  it("handles rolling forecasts inside the regular annual envelope", () => {
    expect(evaluateRollingWarning(rolling({ projectedEarnings: 7000 })).status).toBe("OK");
  });

  it("recognizes a rolling forecast above the regular envelope with documented special months", () => {
    expect(
      evaluateRollingWarning(
        rolling({
          projectedEarnings: 7500,
          maximumAllowedIncome: 7839,
          unpredictableMonths: 1,
          exceedsRegularLimit: true,
        }),
      ).status,
    ).toBe("UNPREDICTABLE_EXCEEDANCE_POSSIBLE");
  });

  it("returns MAXIMUM_EXCEEDED for a rolling forecast beyond the calculated maximum", () => {
    expect(
      evaluateRollingWarning(
        rolling({
          projectedEarnings: 8000,
          maximumAllowedIncome: 7839,
          exceedsRegularLimit: true,
          exceedsMaximumAllowedIncome: true,
        }),
      ).status,
    ).toBe("MAXIMUM_EXCEEDED");
  });
});
