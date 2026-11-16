import { describe, expect, it } from "vitest";

import { NEAR_LIMIT_RATIO } from "./legal/warnings";
import { forecastExceededTextKey, limitAlertLevel, NEAR_LIMIT_PERCENT } from "./limit-alert";

// Business/UX rule (not legal): same 85 % threshold as the legal warning engine.
describe("limitAlertLevel (dashboard banner + TodayImportantCard + notifications)", () => {
  it("uses the shared NEAR_LIMIT_RATIO (85 %)", () => {
    expect(NEAR_LIMIT_RATIO).toBe(0.85);
    expect(NEAR_LIMIT_PERCENT).toBe(85);
  });

  it("month share: below / at 85 %, exactly 100 % is within the limit", () => {
    expect(limitAlertLevel(true, 84.99, 0)).toBeNull();
    expect(limitAlertLevel(true, 85, 0)).toBe("near");
    expect(limitAlertLevel(true, 99.99, 0)).toBe("near");
    // The limit is an upper bound: exactly 100 % (603.00 EUR in 2026) is within it.
    expect(limitAlertLevel(true, 100, 0)).toBe("near");
  });

  it("a month above 100 % is only a statistical month-above-reference hint", () => {
    expect(limitAlertLevel(true, 100.01, 0)).toBe("monthAbove");
    expect(limitAlertLevel(true, 165.8, 13.8)).toBe("monthAbove");
    expect(limitAlertLevel(true, 140, 0)).toBe("monthAbove");
  });

  it("float noise at exactly 100 % does not count as above the limit", () => {
    // a sum like 603.0000000000001 divided by 603, in percent: 100.00000000000003
    const noisy = ((603 + 603 * Number.EPSILON) / 603) * 100;
    expect(noisy).toBeGreaterThan(100);
    expect(limitAlertLevel(true, noisy, 0)).toBe("near");
    expect(limitAlertLevel(true, 0, noisy)).toBe("near");
    // one cent above does
    expect(limitAlertLevel(true, (603.01 / 603) * 100, 0)).toBe("monthAbove");
    expect(limitAlertLevel(true, 0, (7236.01 / 7236) * 100)).toBe("yearAbove");
  });

  it("calendar-year actual earnings above the reference are statistical, never a legal exceedance", () => {
    expect(limitAlertLevel(true, 0, 84.99)).toBeNull();
    expect(limitAlertLevel(true, 0, 85)).toBe("near");
    expect(limitAlertLevel(true, 0, 100)).toBe("near");
    expect(limitAlertLevel(true, 0, 100.01)).toBe("yearAbove");
    expect(limitAlertLevel(true, 90, 100.01)).toBe("yearAbove");
    expect(limitAlertLevel(true, 200, 120)).toBe("yearAbove");
    // without a legal-assessment result the calendar year never yields the legal level
    expect(limitAlertLevel(true, 200, 500)).not.toBe("forecastOver");
    // and an OK / near legal assessment does not turn it into one either
    expect(limitAlertLevel(true, 200, 500, "OK")).toBe("yearAbove");
    expect(limitAlertLevel(true, 200, 500, "NEAR_LIMIT")).toBe("yearAbove");
  });

  it("only the legal assessment yields the exceedance level, above everything else", () => {
    for (const status of [
      "REGULAR_LIMIT_EXCEEDED",
      "UNPREDICTABLE_EXCEEDANCE_POSSIBLE",
      "MAXIMUM_EXCEEDED",
    ] as const) {
      expect(limitAlertLevel(true, 10, 10, status)).toBe("forecastOver");
      expect(limitAlertLevel(true, 200, 10, status)).toBe("forecastOver");
      expect(limitAlertLevel(true, 10, 120, status)).toBe("forecastOver");
      expect(limitAlertLevel(true, 10, 10, status, true)).toBe("forecastOver");
    }
    expect(limitAlertLevel(true, 10, 10, "OK")).toBeNull();
    expect(limitAlertLevel(true, 10, 10, "NEAR_LIMIT")).toBeNull();
    expect(limitAlertLevel(true, 200, 10, "OK")).toBe("monthAbove");
  });

  it("an extreme month is an informative hint even though the total is within the limit", () => {
    expect(limitAlertLevel(true, 10, 10, "OK", true)).toBe("highVariation");
    expect(limitAlertLevel(true, 10, 99, "NEAR_LIMIT", true)).toBe("highVariation");
    // it outranks the purely statistical figures
    expect(limitAlertLevel(true, 200, 120, "OK", true)).toBe("highVariation");
    expect(limitAlertLevel(true, 10, 10, "OK", false)).toBeNull();
  });

  it("no alert when no (confirmed) Minijob applies", () => {
    expect(limitAlertLevel(false, 85, 85)).toBeNull();
    expect(limitAlertLevel(false, 150, 150, "MAXIMUM_EXCEEDED", true)).toBeNull();
  });

  it("maps an exceeded forecast status to the forecast card's own wording", () => {
    expect(forecastExceededTextKey("MAXIMUM_EXCEEDED")).toBe("legalForecast.statusMaximum");
    expect(forecastExceededTextKey("REGULAR_LIMIT_EXCEEDED")).toBe(
      "legalForecast.statusRegularExceeded",
    );
    expect(forecastExceededTextKey("UNPREDICTABLE_EXCEEDANCE_POSSIBLE")).toBe(
      "legalForecast.statusSpecialPossible",
    );
  });
});
