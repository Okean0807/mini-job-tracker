/**
 * Automatic hours limit of 0 means "no single hours basis" (e.g. Minijobs with different rates,
 * or no entries yet), not a real limit of 0 h. The card must not show "8 h / 0 h", an hours
 * percentage or an hours bar; the earnings bar in euros stays.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LimitCard } from "./LimitCard";
import { tl } from "@/lib/i18n";
import { formatEuro, formatHours } from "@/lib/minijob/calc";
import { monthUsage, type LimitUsage } from "@/lib/minijob/limits";
import { makeResolver } from "@/lib/minijob/resolve";
import { DEFAULT_SETTINGS, type Job, type Shift } from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE: LimitUsage = {
  earnings: 120,
  earningsLimit: 603,
  earningsShare: (120 / 603) * 100,
  hours: 8,
  hoursLimit: 0,
  hoursShare: 0,
  earningsLeft: 483,
  hoursLeft: 0,
  share: (120 / 603) * 100,
  limitSource: "legal",
  paidAbsenceHours: 0,
  absenceEarnings: 0,
  estimated: false,
  expectedAdditional: 0,
  projectedEarnings: 120,
  referenceDate: "2026-10-31",
};

let container: HTMLDivElement;
let root: Root;

function render(usage: LimitUsage, auto = true) {
  act(() => {
    root.render(createElement(LimitCard, { usage, scopeLabel: "Monat · Oktober", rate: 14, auto }));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("LimitCard: automatic hours limit of 0", () => {
  it("shows the explanation instead of a fake 0 h limit, hours percentage or hours bar", () => {
    render(BASE);
    const text = container.textContent ?? "";
    expect(text).toContain(tl("de", "limit.hoursNoBasis"));
    // hours are shown as a plain value, never as "8 h / 0 h" nor as the "x h at rate" hint
    expect(text).toContain(formatHours(8));
    expect(text).not.toContain(`/ ${formatHours(0)}`);
    expect(text).not.toContain(`${formatHours(0)} bei`);
    // one percentage (earnings) and one bar (earnings): none for the hours
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
    expect((text.match(/%/g) ?? []).length).toBe(1);
  });

  it("keeps the earnings bar in euros", () => {
    render(BASE);
    const text = container.textContent ?? "";
    expect(text).toContain(`${formatEuro(120)} / ${formatEuro(603)}`);
    expect(text).toContain("20 %");
  });

  it("a month without entries (hours 0, limit 0) gets the same explanation", () => {
    render({ ...BASE, hours: 0, earnings: 0, earningsShare: 0, share: 0, earningsLeft: 603 });
    expect(container.textContent).toContain(tl("de", "limit.hoursNoBasis"));
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
  });

  it("positive automatic hours limit: card unchanged (two bars, no explanation)", () => {
    render({ ...BASE, hoursLimit: 43.07, hoursShare: (8 / 43.07) * 100, hoursLeft: 35.07 });
    const text = container.textContent ?? "";
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
    expect(text).toContain(`${formatHours(8)} / ${formatHours(43.07)}`);
    expect(text).not.toContain(tl("de", "limit.hoursNoBasis"));
  });

  it("manual hours limit mode is untouched", () => {
    render({ ...BASE, hoursLimit: 40, hoursShare: 20, hoursLeft: 32 }, false);
    const text = container.textContent ?? "";
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
    expect(text).not.toContain(tl("de", "limit.hoursNoBasis"));
  });

  it("over-limit explanation still depends on the real shares only", () => {
    render({ ...BASE, earnings: 650, earningsShare: 107.8, share: 107.8, earningsLeft: 0 });
    expect(container.textContent).toContain(tl("de", "limit.overExplain"));
    expect(container.textContent).toContain(tl("de", "limit.hoursNoBasis"));
  });
});

describe("limit.hoursNoBasis texts", () => {
  it("German main text is exactly the approved wording", () => {
    expect(tl("de", "limit.hoursNoBasis")).toBe(
      "Kein einheitliches Stundenlimit berechenbar. Maßgeblich ist die Entgeltgrenze in Euro.",
    );
  });

  it("exists in all five languages, translated, without placeholders", () => {
    const texts = (["de", "en", "ru", "tr", "pl"] as const).map((lang) =>
      tl(lang, "limit.hoursNoBasis"),
    );
    for (const text of texts) {
      expect(text).not.toBe("limit.hoursNoBasis");
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/[{}]/);
    }
    expect(new Set(texts).size).toBe(5);
  });
});

describe("why 'different rates' and 'no entries' share one explanation", () => {
  // LimitUsage carries neither an entry count nor a rate count. A month with entries of two
  // Minijobs at different rates but no hours and no pay looks exactly like an empty month, so
  // telling them apart from the usage would be a guess (and could state "no entries" wrongly).
  // If LimitUsage ever gains such a field, this test fails and the card can split the cases.
  const mk = (id: string, rate: number): Job =>
    ({
      id,
      name: id,
      color: "#000",
      mode: "flex",
      employmentType: "minijob",
      rate,
      startDate: "2025-01-01",
    }) as Job;
  const zeroHours = (id: string, jobId: string): Shift => ({
    id,
    jobId,
    kind: "arbeit",
    date: "2026-10-05",
    start: "09:00",
    end: "09:00",
    breakMinutes: 0,
  });
  const settings = { ...DEFAULT_SETTINGS, defaultRate: 14 };
  const jobs = [mk("a", 14), mk("b", 16)];

  it("both states give hoursLimit 0 and the same limit-relevant figures", () => {
    const resolve = makeResolver(jobs, settings);
    const empty = monthUsage([], resolve, settings, 2026, 9, "2026-10-31");
    const mixed = monthUsage(
      [zeroHours("1", "a"), zeroHours("2", "b")],
      resolve,
      settings,
      2026,
      9,
      "2026-10-31",
    );
    expect(empty.hoursLimit).toBe(0);
    expect(mixed.hoursLimit).toBe(0);
    for (const key of [
      "hours",
      "earnings",
      "paidAbsenceHours",
      "absenceEarnings",
      "expectedAdditional",
      "estimated",
    ] as const) {
      expect(mixed[key], key).toEqual(empty[key]);
    }
  });
});
