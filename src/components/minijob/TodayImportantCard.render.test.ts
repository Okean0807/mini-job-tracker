/**
 * Render-Test (react-dom/client + act, happy-dom) der Heute-Karte:
 * - B1: flex-Job mit EMPTY_WEEK ist nicht „heute geplant“
 * - ungeklärter Altbestand fest → Hinweis „Beschäftigungsart wählen“, keine Grenzwarnung
 * - 85-%-Schwelle (Business/UX) wie Dashboard-Banner
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children?: unknown; className?: string }) =>
    createElement("a", { href: to, className }, children as never),
}));

import { TodayImportantCard } from "./TodayImportantCard";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/minijob/calc";
import { makeResolver } from "@/lib/minijob/resolve";
import type { LegalWarningStatus } from "@/lib/minijob/legal/warnings";
import { DEFAULT_SETTINGS, EMPTY_WEEK, type Job, type Shift } from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-09-30"; // Mittwoch
const settings = { ...DEFAULT_SETTINGS, defaultRate: 15 };
const usage = (share: number, earningsLimit = 603) => ({ share, earnings: 0, earningsLimit });

let container: HTMLDivElement;
let root: Root;

function render(
  jobs: Job[],
  shifts: Shift[] = [],
  share = 0,
  extra: { yearShare?: number; rollingStatus?: LegalWarningStatus; highVariation?: boolean } = {},
) {
  act(() => {
    root.render(
      createElement(TodayImportantCard, {
        shifts,
        jobs,
        payments: [],
        settings,
        resolve: makeResolver(jobs, settings),
        monthUsage: usage(share),
        yearUsage: usage(extra.yearShare ?? 0, 7236),
        ...(extra.rollingStatus ? { rollingStatus: extra.rollingStatus } : {}),
        ...(extra.highVariation ? { highVariation: true } : {}),
        onNewEntry: () => {},
      }),
    );
  });
  return container.textContent ?? "";
}

const planned = () => t("dash.todayPlanned");
const job = (overrides: Partial<Job>): Job => ({
  id: "j1",
  name: "Reinigung",
  color: "#000",
  mode: "flex",
  rate: 15,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 30, 10, 0));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("TodayImportantCard – heute geplant", () => {
  it("B1: flex job with EMPTY_WEEK (as JobDialog writes it) is NOT planned today", () => {
    expect(
      render([job({ mode: "flex", week: EMPTY_WEEK, employmentType: "minijob" })]),
    ).not.toContain(planned());
  });

  it("fest job with today active and nothing recorded IS planned", () => {
    expect(render([job({ mode: "fest", week: EMPTY_WEEK, employmentType: "minijob" })])).toContain(
      planned(),
    );
  });

  it("fest job already recorded today or archived is not planned", () => {
    const fest = job({ mode: "fest", week: EMPTY_WEEK, employmentType: "minijob" });
    const entry: Shift = {
      id: "s",
      jobId: "j1",
      kind: "arbeit",
      date: TODAY,
      start: "09:00",
      end: "12:00",
      breakMinutes: 0,
    };
    expect(render([fest], [entry])).not.toContain(planned());
    expect(render([{ ...fest, archived: true }])).not.toContain(planned());
  });
});

describe("TodayImportantCard – Beschäftigungsart / Grenze", () => {
  it("B: legacy fest without employmentType → hint to choose, no limit warning", () => {
    const text = render([job({ mode: "fest", name: "Alt-Fest" })], [], 120);
    expect(text).toContain(t("dash.todayEmploymentType", { names: "Alt-Fest" }));
    expect(text).not.toContain(t("dash.todayLimit", { percent: 120 }));
  });

  it("A: legacy flex without employmentType → no hint (fallback Minijob)", () => {
    expect(render([job({ mode: "flex", name: "Alt-Flex" })])).not.toContain(
      t("dash.todayEmploymentType", { names: "Alt-Flex" }),
    );
  });

  it("85 % threshold (Business/UX): 84 % no warning, 85 % warning", () => {
    const mini = [job({ employmentType: "minijob" })];
    expect(render(mini, [], 84)).not.toContain(t("dash.todayLimit", { percent: 84 }));
    expect(render(mini, [], 85)).toContain(t("dash.todayLimit", { percent: 85 }));
  });

  it("only Hauptbeschäftigung → no limit warning even at a high share", () => {
    const main = [job({ employmentType: "hauptbeschaeftigung" })];
    expect(render(main, [], 95)).not.toContain(t("dash.todayLimit", { percent: 95 }));
  });
});

describe("TodayImportantCard – AUD-09A: Grenzwarnung mit getrennten Begriffen", () => {
  const mini = [job({ employmentType: "minijob" })];
  const yearAbove = t("dash.limitYearAbove", { amount: formatEuro(7236) });

  it("exactly 100 % of the monthly reference is informative (100 %), not an exceedance", () => {
    const text = render(mini, [], 100);
    expect(text).toContain(t("dash.todayLimit", { percent: 100 }));
    expect(text).not.toContain(yearAbove);
  });

  it("a month above the reference shows the month-above hint, not an exceedance", () => {
    const text = render(mini, [], 165.8, { yearShare: 13.8, rollingStatus: "OK" });
    expect(text).toContain(
      t("dash.limitMonthAbove", { amount: formatEuro(603), yearAmount: formatEuro(7236) }),
    );
    expect(text).not.toContain(yearAbove);
    expect(text).not.toContain(t("dash.todayLimit", { percent: 166 }));
  });

  it("a calendar-year total above the reference is worded as a statistic, never as 'exceeded'", () => {
    const text = render(mini, [], 10, { yearShare: 103.6, rollingStatus: "OK" });
    expect(text).toContain(yearAbove);
    expect(text).toContain("Kalenderjahresverdienst über dem Richtwert");
    expect(text).not.toContain(t("rolling.statusAbove"));
    expect(text).not.toContain(t("rolling.statusAbove"));
  });

  it("the rolling indicator above its range uses the card's own orientation wording, not a legal finding", () => {
    const text = render(mini, [], 10, { yearShare: 40, rollingStatus: "MAXIMUM_EXCEEDED" });
    expect(text).toContain(t("rolling.statusAbove"));
    expect(text).toContain(t("rolling.aboveHint"));
    expect(text).not.toContain(yearAbove);
    expect(text).not.toMatch(/Verstoß|rechtlich überschritten/);
  });

  it("the rolling indicator above its range wins over a calendar-year statistic", () => {
    const text = render(mini, [], 10, { yearShare: 120, rollingStatus: "REGULAR_LIMIT_EXCEEDED" });
    expect(text).toContain(t("rolling.statusAbove"));
    expect(text).not.toContain(yearAbove);
  });

  it("an extreme month inside a compliant total is shown as a hint, not waved through", () => {
    const text = render(mini, [], 50, {
      yearShare: 100,
      rollingStatus: "NEAR_LIMIT",
      highVariation: true,
    });
    expect(text).toContain(t("rolling.signal"));
  });

  it("no limit line when everything is below the 85 % threshold", () => {
    const text = render(mini, [], 50, { yearShare: 20, rollingStatus: "OK" });
    expect(text).not.toContain(yearAbove);
    expect(text).not.toContain(t("rolling.statusAbove"));
    expect(text).not.toContain(t("rolling.signal"));
  });
});
