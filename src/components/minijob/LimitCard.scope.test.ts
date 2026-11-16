/**
 * LimitCard – AUD-09A: both cards compare ACTUAL figures against a REFERENCE (the
 * monthly reference amount, resp. the calendar-year total against the annual
 * reference). Above it is a statistical hint, never an "exceeded" legal status;
 * the legal assessment is the forecast card. Exactly 100 % is within the limit.
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

function text(
  scope: "month" | "year",
  earnings: number,
  limit: number,
  legalExceeded = false,
): string {
  act(() => {
    root.render(
      createElement(LimitCard, {
        usage: usage(earnings, limit),
        scope,
        legalExceeded,
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

describe("LimitCard year scope (calendar-year actual earnings: a statistic, not a legal status)", () => {
  const yearAbove = tl("de", "limit.yearAboveNote");

  it("7,235.99 and exactly 7,236.00 EUR: no note at all", () => {
    for (const amount of [7235.99, 7236]) {
      const out = text("year", amount, 7236);
      expect(out).not.toContain(yearAbove);
      expect(out).not.toContain(overExplain);
    }
  });

  it("7,236.01 EUR: informational calendar-year note, never the 'exceeded' explanation", () => {
    const out = text("year", 7236.01, 7236);
    expect(out).toContain(yearAbove);
    expect(out).toContain("Kalenderjahresverdienst über dem Richtwert");
    expect(out).not.toContain(overExplain);
    expect(out).not.toContain(monthAbove);
  });

  it("2027: 7,596.00 EUR within, 7,596.01 EUR informational note", () => {
    expect(text("year", 7596, 7596)).not.toContain(yearAbove);
    expect(text("year", 7596.01, 7596)).toContain(yearAbove);
  });

  it("float noise at exactly the limit is not above it", () => {
    expect(text("year", 7236.000000000001, 7236)).not.toContain(yearAbove);
  });

  it("the actual amount stays visible", () => {
    expect(text("year", 8400, 7236)).toContain("8.400");
  });
});

describe("LimitCard colour: a reference figure is never styled as a violation", () => {
  function barClasses(scope: "month" | "year", earnings: number, limit: number): string {
    text(scope, earnings, limit);
    return [...container.querySelectorAll<HTMLElement>('[role="progressbar"]')]
      .map((b) => b.className)
      .join(" ");
  }
  it("exactly 100 % keeps the neutral bar; above it is amber, never destructive", () => {
    expect(barClasses("month", 603, 603)).not.toContain("bg-amber-500");
    expect(barClasses("month", 603, 603)).not.toContain("bg-destructive");
    expect(barClasses("month", 1000, 603)).toContain("[&>div]:bg-amber-500");
    expect(barClasses("year", 8400, 7236)).toContain("[&>div]:bg-amber-500");
    expect(barClasses("year", 8400, 7236)).not.toContain("bg-destructive");
  });
});

describe("LimitCard: the alarm styling belongs to the legal assessment only", () => {
  it("legalExceeded shows the exceedance explanation with its disclaimer and the alarm colour", () => {
    const out = text("year", 8400, 7236, true);
    expect(out).toContain(overExplain);
    expect(out).toContain(tl("de", "limit.disclaimer"));
    const bars = [...container.querySelectorAll<HTMLElement>('[role="progressbar"]')];
    expect(bars.every((b) => b.className.includes("[&>div]:bg-destructive"))).toBe(true);
  });

  it("without it, the same figures show no explanation and no alarm colour", () => {
    const out = text("year", 8400, 7236, false);
    expect(out).not.toContain(overExplain);
    const bars = [...container.querySelectorAll<HTMLElement>('[role="progressbar"]')];
    expect(bars.some((b) => b.className.includes("bg-destructive"))).toBe(false);
  });
});
