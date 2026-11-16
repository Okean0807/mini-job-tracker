/**
 * AUD-09A/09C – consistency of wording and severity across the limit surfaces.
 *
 * Real engine output is rendered through the real components (TodayImportantCard, LimitCard,
 * RollingEarningsCard); the dashboard route's banner mapping is checked at source level.
 * Nothing is worded or styled as a confirmed legal violation: calendar-year and month figures
 * are statistics against a reference, and the rolling 12-month indicator is an orientation
 * value ("Erfasste Verdienste über dem Orientierungsrahmen").
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

import { LimitCard } from "./LimitCard";
import { RollingEarningsCard } from "./RollingEarningsCard";
import { TodayImportantCard } from "./TodayImportantCard";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/minijob/calc";
import { assessLegalIncome, evaluateRollingWarning } from "@/lib/minijob/legal";
import { hasMonthAboveDoubleReference } from "@/lib/minijob/legal/warnings";
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
const entry = (month: number, amount: number, day = 3): Shift => ({
  id: `c${n++}`,
  jobId: "a",
  kind: "arbeit",
  date: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
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
function surfaces(shifts: Shift[], month: number, ref = "2026-12-31") {
  const resolve = makeResolver([job], settings);
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
        rollingStatus: status,
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
      }),
    ),
    rollingCard: renderText(createElement(RollingEarningsCard, { rolling })),
    rolling,
    status,
  };
}

const series = (amounts: number[]) => amounts.map((a, i) => entry(i + 1, a));
const violationWords =
  /Verstoß|rechtlich überschritten|Überschreitung festgestellt|überschreitet die (reguläre|Grenze)/i;

describe("calendar-year total above the reference, rolling indicator within its range (March view of 12 x 700 EUR)", () => {
  const s = () => surfaces(series(Array(12).fill(700)), 2);

  it("each figure is on its own time basis and worded as what it is", () => {
    const out = s();
    expect(out.status).toBe("OK");
    expect(out.today).toContain(t("dash.limitYearAbove", { amount: formatEuro(7236) }));
    expect(out.yearCard).toContain(t("limit.yearAboveNote"));
    expect(out.yearCard).toContain("8.400"); // calendar-year statistic
    expect(out.rollingCard).toContain(t("rolling.statusWithin"));
    expect(out.rollingCard).toContain("2.100"); // rolling 12 months ending in March
    expect(out.rollingCard).not.toContain("8.400");
    expect(out.rollingCard).not.toContain(t("rolling.statusAbove"));
  });

  it("the rolling card says that being within the range proves nothing", () => {
    expect(s().rollingCard).toContain(t("rolling.disclaimer"));
    expect(s().rollingCard).toContain(t("rolling.windowNote"));
  });
});

describe("rolling indicator above the reference range (December view of 12 x 700 EUR)", () => {
  it("the card and 'Heute wichtig' share one orientation wording; the statistic card stays a statistic", () => {
    const out = surfaces(series(Array(12).fill(700)), 11);
    expect(out.status).toBe("MAXIMUM_EXCEEDED"); // historic engine name; it only means "above the range"
    expect(out.rollingCard).toContain(t("rolling.statusAbove"));
    expect(out.rollingCard).toContain(t("rolling.aboveHint"));
    expect(out.today).toContain(t("rolling.statusAbove"));
    expect(out.today).toContain(t("rolling.aboveHint"));
    expect(out.yearCard).toContain(t("limit.yearAboveNote"));
  });

  it("no surface carries violation or legal-conclusion wording", () => {
    const out = surfaces(series(Array(12).fill(700)), 11);
    for (const text of [out.today, out.yearCard, out.rollingCard]) {
      expect(text).not.toMatch(violationWords);
      expect(text).not.toContain("Prognose");
      expect(text).not.toContain("Maximalrahmen");
    }
  });
});

describe("recorded earnings and shifts entered for later are shown apart", () => {
  it("the card shows recorded, entered-for-later and total separately, with the planning note", () => {
    vi.setSystemTime(new Date(2026, 5, 15, 10, 0));
    const out = surfaces([entry(6, 500, 10), entry(6, 700, 25)], 5, "2026-06-15");
    expect(out.rollingCard).toContain(t("rolling.actual"));
    expect(out.rollingCard).toContain(t("rolling.planned"));
    expect(out.rollingCard).toContain(t("rolling.plannedNote"));
    const card = container.querySelector('[data-testid="rolling-actual"]')?.textContent ?? "";
    expect(card).toContain("500");
    expect(container.querySelector('[data-testid="rolling-planned"]')?.textContent).toContain(
      "700",
    );
    expect(container.querySelector('[data-testid="rolling-total"]')?.textContent).toContain(
      "1.200",
    );
  });
});

describe("extreme fluctuation inside a total within the range (Minijob-Zentrale example)", () => {
  it("the same informational signal on 'Heute wichtig' and on the card, labelled as no legal rule", () => {
    const out = surfaces(
      series([1800, 1800, 1800, 204, 204, 204, 204, 204, 204, 204, 204, 204]),
      11,
    );
    expect(out.status).not.toBe("MAXIMUM_EXCEEDED");
    expect(out.today).toContain(t("rolling.signal"));
    expect(out.rollingCard).toContain(t("rolling.signal"));
    expect(t("rolling.signal")).toMatch(/Orientierung/);
  });
});

describe("the dashboard route maps the same levels to the same wording", () => {
  const src = readFileSync(resolvePath(process.cwd(), "src/routes/index.tsx"), "utf8");

  it("uses the shared decision and the shared keys; no alarm tone and no retired wording", () => {
    expect(src).toMatch(/limitAlertLevel\(/);
    expect(src).toMatch(
      /limitAlert === "rollingAbove"[\s\S]*rolling\.statusAbove[\s\S]*rolling\.aboveHint/,
    );
    expect(src).toMatch(/limitAlert === "highVariation"[\s\S]*rolling\.signal/);
    expect(src).toMatch(/limitAlert === "yearAbove"[\s\S]*dash\.limitYearAbove/);
    expect(src).toMatch(/limitAlert === "monthAbove"[\s\S]*dash\.limitMonthAbove/);
    expect(src).not.toMatch(
      /dash\.limitYearOver|dash\.limitMonthOver|["']legalForecast\.[A-Za-z]+["']/,
    );
    expect(src).not.toMatch(/tone=/);
    expect(src).not.toMatch(/bg-destructive|text-destructive|border-destructive/);
  });

  it("keeps the persisted widget id but shows the new card", () => {
    expect(src).toMatch(/legalForecast: <RollingEarningsCard rolling=/);
  });
});
