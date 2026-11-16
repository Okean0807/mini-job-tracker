/**
 * AUD-09A – consistency of wording and severity across the limit surfaces.
 *
 * Real engine output is rendered through the real components (TodayImportantCard,
 * LimitCard, LegalForecastCard) and the dashboard route's banner mapping is checked
 * at source level. Only the legal assessment (rolling 12-month forecast) may be worded
 * as an exceedance; calendar-year and month figures are statistics against a reference.
 */
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children?: unknown; className?: string }) =>
    createElement("a", { href: to, className }, children as never),
}));

import { LegalForecastCard } from "./LegalForecastCard";
import { LimitCard } from "./LimitCard";
import { TodayImportantCard } from "./TodayImportantCard";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/minijob/calc";
import { assessLegalIncome, evaluateRollingWarning } from "@/lib/minijob/legal";
import {
  hasMonthAboveDoubleReference,
  isLegalExceedanceStatus,
} from "@/lib/minijob/legal/warnings";
import { monthUsage, yearUsage } from "@/lib/minijob/limits";
import { makeResolver } from "@/lib/minijob/resolve";
import {
  DEFAULT_SETTINGS,
  type AppData,
  type Job,
  type Settings,
  type Shift,
} from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settings: Settings = { ...DEFAULT_SETTINGS, limitAuto: true };
const job: Job = {
  id: "a",
  name: "A",
  color: "#000",
  mode: "flex",
  employmentType: "minijob",
  rate: 13.9,
};
let n = 0;
const entry = (month: number, amount: number): Shift => ({
  id: `c${n++}`,
  jobId: "a",
  kind: "arbeit",
  date: `2026-${String(month).padStart(2, "0")}-03`,
  start: "08:00",
  end: "09:00",
  breakMinutes: 0,
  rate: amount,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 11, 31, 10, 0));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const renderText = (node: ReturnType<typeof createElement>) => {
  act(() => root.render(node));
  return container.textContent ?? "";
};

/** Everything the user sees for `shifts` when the dashboard displays `month` (0-based) of 2026. */
function surfaces(shifts: Shift[], month: number) {
  const resolve = makeResolver([job], settings);
  const ref = "2026-12-31";
  const mu = monthUsage(shifts, resolve, settings, 2026, month, ref);
  const yu = yearUsage(shifts, resolve, settings, 2026, ref);
  const data = { jobs: [job], shifts, settings } as AppData;
  const rolling = assessLegalIncome(
    data,
    `2026-${String(month + 1).padStart(2, "0")}-01`,
    ref,
  ).rolling;
  const status = evaluateRollingWarning(rolling).status;
  const highVariation = hasMonthAboveDoubleReference(rolling);
  return {
    today: renderText(
      createElement(TodayImportantCard, {
        shifts,
        jobs: [job],
        payments: [],
        settings,
        resolve,
        monthUsage: mu,
        yearUsage: yu,
        forecastStatus: status,
        highVariation,
        onNewEntry: () => {},
      }),
    ),
    yearCard: renderText(
      createElement(LimitCard, {
        usage: yu,
        scope: "year",
        scopeLabel: "2026",
        rate: 13.9,
        auto: true,
        legalExceeded: isLegalExceedanceStatus(status),
      }),
    ),
    forecastCard: renderText(createElement(LegalForecastCard, { forecast: rolling })),
    status,
  };
}

const series = (amounts: number[]) => amounts.map((a, i) => entry(i + 1, a));

describe("calendar-year total above the reference, compliant legal assessment (March view of 12 x 700 EUR)", () => {
  const s = () => surfaces(series(Array(12).fill(700)), 2);

  it("only statistics are worded as such; no surface claims an exceedance", () => {
    const out = s();
    expect(out.status).toBe("OK");
    expect(out.today).toContain(t("dash.limitYearAbove", { amount: formatEuro(7236) }));
    expect(out.yearCard).toContain(t("limit.yearAboveNote"));
    expect(out.forecastCard).toContain(t("legalForecast.statusOk"));
    for (const text of [out.today, out.yearCard, out.forecastCard]) {
      expect(text).not.toContain(t("legalForecast.statusMaximum"));
      expect(text).not.toContain(t("legalForecast.statusRegularExceeded"));
      expect(text).not.toContain(t("limit.overExplain"));
    }
  });

  it("the calendar-year phrase is the same on the banner text, the card and the note", () => {
    const out = s();
    for (const text of [out.today, out.yearCard]) {
      expect(text).toContain("Kalenderjahresverdienst über dem Richtwert");
    }
  });
});

describe("a genuine legal exceedance (December view of 12 x 700 EUR)", () => {
  it("the legal surfaces share one wording; the statistic card stays a statistic", () => {
    const out = surfaces(series(Array(12).fill(700)), 11);
    expect(out.status).toBe("MAXIMUM_EXCEEDED");
    expect(out.today).toContain(t("legalForecast.statusMaximum"));
    expect(out.forecastCard).toContain(t("legalForecast.statusMaximum"));
    // the card carries the exceedance explanation only because the legal assessment says so
    expect(out.yearCard).toContain(t("limit.overExplain"));
  });
});

describe("extreme fluctuation inside a total within the limit (Minijob-Zentrale example)", () => {
  it("is shown as the same hint on the card and the forecast card, never as OK-with-certainty", () => {
    const out = surfaces(
      series([1800, 1800, 1800, 204, 204, 204, 204, 204, 204, 204, 204, 204]),
      11,
    );
    expect(out.status).not.toBe("MAXIMUM_EXCEEDED");
    expect(out.today).toContain(t("legalForecast.highVariation"));
    expect(out.forecastCard).toContain(t("legalForecast.highVariation"));
  });
});

describe("the dashboard route maps the same levels to the same wording", () => {
  const src = readFileSync(resolvePath(process.cwd(), "src/routes/index.tsx"), "utf8");

  it("uses the shared decision and the shared keys, and no retired exceedance wording for statistics", () => {
    expect(src).toMatch(/limitAlertLevel\(/);
    expect(src).toMatch(/limitAlert === "forecastOver"[\s\S]*forecastExceededTextKey/);
    expect(src).toMatch(/limitAlert === "highVariation"[\s\S]*legalForecast\.highVariation/);
    expect(src).toMatch(/limitAlert === "yearAbove"[\s\S]*dash\.limitYearAbove/);
    expect(src).toMatch(/limitAlert === "monthAbove"[\s\S]*dash\.limitMonthAbove/);
    expect(src).not.toMatch(/dash\.limitYearOver/);
    expect(src).not.toMatch(/dash\.limitMonthOver/);
    // only the legal level uses the alarm tone
    const over = [...src.matchAll(/tone="over"/g)].length;
    expect(over).toBe(1);
  });
});
