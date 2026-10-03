import { describe, expect, it } from "vitest";
import { evaluateForecastMonthWarning, evaluateRollingWarning } from "./warnings";
import { addMonths, forecastRolling12Months } from "./rolling";
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

  // Expectation fix: 7000 / 7236 = 96.7 % — inside the regular envelope (not exceeded)
  // but above the 85 % NEAR_LIMIT product threshold, which applies to rolling
  // forecasts exactly as to single months. Only 236 € headroom remain → NEAR_LIMIT.
  it("handles rolling forecasts inside the regular annual envelope", () => {
    const result = evaluateRollingWarning(rolling({ projectedEarnings: 7000 }));
    expect(result.status).toBe("NEAR_LIMIT");
    expect(result.regularLimit - result.projected).toBe(236);
    expect(evaluateRollingWarning(rolling({ projectedEarnings: 6000 })).status).toBe("OK");
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

describe("NEAR_LIMIT threshold boundaries (85 %, Business/UX rule)", () => {
  // Month limit 603 → threshold 512.55 €; rolling 2026 limit 7236 → 6150.60 €.
  it("single month: just below / at / just above 85 %", () => {
    expect(evaluateForecastMonthWarning(month({ projected: 512.54 })).status).toBe("OK");
    expect(evaluateForecastMonthWarning(month({ projected: 603 * 0.85 })).status).toBe(
      "NEAR_LIMIT",
    );
    expect(evaluateForecastMonthWarning(month({ projected: 512.56 })).status).toBe("NEAR_LIMIT");
  });

  it("single month: exactly at the limit is not exceeded; one cent above is", () => {
    expect(evaluateForecastMonthWarning(month({ projected: 603 })).status).toBe("NEAR_LIMIT");
    expect(evaluateForecastMonthWarning(month({ projected: 603.01 })).status).toBe(
      "REGULAR_LIMIT_EXCEEDED",
    );
  });

  it("rolling: just below / at / just above 85 %", () => {
    expect(evaluateRollingWarning(rolling({ projectedEarnings: 6150.59 })).status).toBe("OK");
    expect(evaluateRollingWarning(rolling({ projectedEarnings: 7236 * 0.85 })).status).toBe(
      "NEAR_LIMIT",
    );
    expect(evaluateRollingWarning(rolling({ projectedEarnings: 6150.61 })).status).toBe(
      "NEAR_LIMIT",
    );
  });

  it("rolling (real engine): at the limit stays NEAR_LIMIT; one cent over without special months → MAXIMUM_EXCEEDED", () => {
    // Without documented unpredictable months maximumAllowedIncome === regularLimit,
    // so every regular exceedance is also a maximum exceedance.
    const inputs = Array.from({ length: 12 }, (_, i) => ({
      date: addMonths("2026-12-01", i - 11),
      actual: 603,
    }));
    const atLimit = forecastRolling12Months(inputs, "2026-12-01");
    expect(atLimit.projectedEarnings).toBe(7236);
    expect(evaluateRollingWarning(atLimit).status).toBe("NEAR_LIMIT");

    inputs[11] = { ...inputs[11]!, actual: 603.01 };
    const over = forecastRolling12Months(inputs, "2026-12-01");
    expect(over.exceedsRegularLimit).toBe(true);
    expect(evaluateRollingWarning(over).status).toBe("MAXIMUM_EXCEEDED");
  });

  it("rolling: over the regular limit with a documented special month → UNPREDICTABLE_EXCEEDANCE_POSSIBLE", () => {
    const inputs = Array.from({ length: 12 }, (_, i) => ({
      date: addMonths("2026-12-01", i - 11),
      actual: 603,
      unpredictable: false,
    }));
    inputs[11] = { ...inputs[11]!, actual: 700, unpredictable: true };
    const result = forecastRolling12Months(inputs, "2026-12-01");
    expect(result.regularLimit).toBe(7236);
    expect(result.maximumAllowedIncome).toBe(7839);
    expect(evaluateRollingWarning(result).status).toBe("UNPREDICTABLE_EXCEEDANCE_POSSIBLE");
  });
});
