/**
 * LimitCard – AUD-09A: the monthly card only compares against the monthly
 * REFERENCE amount; exceeding it is a hint, not an exceedance. Only the annual
 * card keeps the "exceeded" wording, and exactly 100 % is within the limit.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LimitCard } from "./LimitCard";
import { tl } from "@/lib/i18n";
import type { LimitUsage } from "@/lib/minijob/limits";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function usage(earnings: number, limit: number): LimitUsage {
  const share = (earnings / limit) * 100;
  return {
    earnings,
    earningsLimit: limit,
    earningsShare: share,
    hours: 10,
    hoursLimit: 40,
    hoursShare: 25,
    earningsLeft: Math.max(0, limit - earnings),
    hoursLeft: 30,
    share,
    limitSource: "legal",
    paidAbsenceHours: 0,
    absenceEarnings: 0,
    estimated: false,
    expectedAdditional: 0,
    projectedEarnings: earnings,
    referenceDate: "2026-06-30",
  };
}

let container: HTMLDivElement;
let root: Root;

function text(scope: "month" | "year", earnings: number, limit: number): string {
  act(() => {
    root.render(
      createElement(LimitCard, {
        usage: usage(earnings, limit),
        scope,
        scopeLabel: "Test",
        rate: 13.9,
        auto: true,
      }),
    );
  });
  return container.textContent ?? "";
}

const overExplain = tl("de", "limit.overExplain");
const monthAbove = tl("de", "limit.monthAboveNote");

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("LimitCard month scope (reference amount)", () => {
  it("602.99 and exactly 603.00 EUR: no warning box at all", () => {
    for (const amount of [602.99, 603]) {
      const out = text("month", amount, 603);
      expect(out).not.toContain(overExplain);
      expect(out).not.toContain(monthAbove);
    }
  });

  it("603.01 EUR and 1,000 EUR: neutral hint, never the 'exceeded' explanation", () => {
    for (const amount of [603.01, 1000]) {
      const out = text("month", amount, 603);
      expect(out).toContain(monthAbove);
      expect(out).not.toContain(overExplain);
    }
  });

  it("2027: 633.00 EUR within, 633.01 EUR hint", () => {
    expect(text("month", 633, 633)).not.toContain(monthAbove);
    expect(text("month", 633.01, 633)).toContain(monthAbove);
  });

  it("the actual amount stays visible", () => {
    expect(text("month", 1000, 603)).toContain("1.000");
  });
});

describe("LimitCard year scope (annual limit)", () => {
  it("7,235.99 and exactly 7,236.00 EUR: no exceeded explanation", () => {
    for (const amount of [7235.99, 7236]) {
      expect(text("year", amount, 7236)).not.toContain(overExplain);
    }
  });

  it("7,236.01 EUR: the exceeded explanation is shown", () => {
    const out = text("year", 7236.01, 7236);
    expect(out).toContain(overExplain);
    expect(out).not.toContain(monthAbove);
  });

  it("2027: 7,596.00 EUR within, 7,596.01 EUR exceeded", () => {
    expect(text("year", 7596, 7596)).not.toContain(overExplain);
    expect(text("year", 7596.01, 7596)).toContain(overExplain);
  });

  it("float noise at exactly the limit is not an exceedance", () => {
    expect(text("year", 7236.000000000001, 7236)).not.toContain(overExplain);
  });
});
