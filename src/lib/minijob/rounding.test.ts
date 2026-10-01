import { describe, expect, it } from "vitest";
import { roundHours, roundMoney } from "./rounding";

describe("rounding boundary", () => {
  it("rounds money only at the boundary", () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(10.004)).toBe(10);
  });

  it("keeps invalid numeric input safe", () => {
    expect(roundMoney(Number.NaN)).toBe(0);
    expect(roundHours(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("does not require per-shift rounding before summation", () => {
    const raw = 10.005 + 10.005;
    expect(roundMoney(raw)).toBe(20.01);
    expect(roundMoney(10.005) + roundMoney(10.005)).toBe(20.02);
  });
});
