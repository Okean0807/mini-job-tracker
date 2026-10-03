import { describe, expect, it } from "vitest";

import { NEAR_LIMIT_RATIO } from "./legal/warnings";
import { limitAlertLevel, NEAR_LIMIT_PERCENT } from "./limit-alert";

// Business/UX rule (not legal): same 85 % threshold as the legal warning engine.
describe("limitAlertLevel (dashboard banner + TodayImportantCard)", () => {
  it("uses the shared NEAR_LIMIT_RATIO (85 %)", () => {
    expect(NEAR_LIMIT_RATIO).toBe(0.85);
    expect(NEAR_LIMIT_PERCENT).toBe(85);
  });

  it("boundaries: just below / at / just above 85 %, at and over 100 %", () => {
    expect(limitAlertLevel(true, 84.99, 0)).toBeNull();
    expect(limitAlertLevel(true, 85, 0)).toBe("near");
    expect(limitAlertLevel(true, 85.01, 0)).toBe("near");
    expect(limitAlertLevel(true, 89.99, 0)).toBe("near");
    expect(limitAlertLevel(true, 99.99, 0)).toBe("near");
    expect(limitAlertLevel(true, 100, 0)).toBe("over");
    expect(limitAlertLevel(true, 140, 0)).toBe("over");
  });

  it("the year share triggers the same levels", () => {
    expect(limitAlertLevel(true, 0, 84.99)).toBeNull();
    expect(limitAlertLevel(true, 0, 85)).toBe("near");
    expect(limitAlertLevel(true, 0, 100)).toBe("over");
    expect(limitAlertLevel(true, 90, 100)).toBe("over");
  });

  it("no alert when no (confirmed) Minijob applies", () => {
    expect(limitAlertLevel(false, 85, 85)).toBeNull();
    expect(limitAlertLevel(false, 150, 150)).toBeNull();
  });
});
