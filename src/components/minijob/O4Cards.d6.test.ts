/** D6 (Owner R4): Karten nennen auslösende Monate; Prognose = Rückblick. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LegalForecastCard } from "./LegalForecastCard";
import { LimitCard, o4MonthLabel } from "./LimitCard";
import { tl } from "@/lib/i18n";
import type { Rolling12ForecastResult } from "@/lib/minijob/legal/rolling";
import type { LimitUsage } from "@/lib/minijob/limits";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USAGE = {
  earnings: 650,
  earningsLimit: 603,
  earningsShare: 107.8,
  hours: 30,
  hoursLimit: 40,
  hoursShare: 75,
  earningsLeft: 0,
  hoursLeft: 10,
  share: 107.8,
  limitSource: "legal",
  paidAbsenceHours: 0,
  absenceEarnings: 0,
  estimated: false,
  expectedAdditional: 0,
  projectedEarnings: 650,
  referenceDate: "2026-09-30",
} as LimitUsage;
const FORECAST = {
  anchorMonth: "2026-09-01",
  months: [],
  projectedEarnings: 5350,
  regularLimit: 7095,
  maximumAllowedIncome: 8514,
  unpredictableMonths: 0,
  exceedsRegularLimit: false,
  exceedsMaximumAllowedIncome: false,
  allowedIfForecastRealized: true,
} as Rolling12ForecastResult;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);

describe("LimitCard (Jahr) – D6", () => {
  it("nennt Monate und erklärt, dass andere Monate den Hinweis auslösen", () => {
    act(() =>
      root.render(
        createElement(LimitCard, {
          usage: USAGE,
          scopeLabel: "Jahr 2026",
          rate: 13.9,
          auto: true,
          multipleMinijobs: true,
          affectedMonths: ["2026-03", "2026-05"],
          causedByOtherMonths: true,
        }),
      ),
    );
    expect(q("limit-o4-months")!.textContent).toBe(
      tl("de", "limit.multipleMinijobsMonths", {
        months: [o4MonthLabel("2026-03"), o4MonthLabel("2026-05")].join(", "),
      }),
    );
    expect(q("limit-o4-other-months")!.textContent).toBe(
      tl("de", "limit.multipleMinijobsOtherMonths"),
    );
  });

  it("gewählter Monat selbst betroffen → keine 'andere Monate'-Erklärung", () => {
    act(() =>
      root.render(
        createElement(LimitCard, {
          usage: USAGE,
          scopeLabel: "Jahr 2026",
          rate: 13.9,
          auto: true,
          multipleMinijobs: true,
          affectedMonths: ["2026-03"],
          causedByOtherMonths: false,
        }),
      ),
    );
    expect(q("limit-o4-months")).not.toBeNull();
    expect(q("limit-o4-other-months")).toBeNull();
  });

  it("ohne O4 bleibt die normale Karte (keine Monatsliste)", () => {
    act(() =>
      root.render(
        createElement(LimitCard, { usage: USAGE, scopeLabel: "Jahr", rate: 13.9, auto: true }),
      ),
    );
    expect(q("limit-o4-months")).toBeNull();
  });
});

describe("LegalForecastCard – D6", () => {
  it("Rückblick-Hinweis + Monate, kein Status", () => {
    act(() =>
      root.render(
        createElement(LegalForecastCard, {
          forecast: FORECAST,
          multipleMinijobs: true,
          affectedMonths: ["2026-03"],
        }),
      ),
    );
    expect(q("forecast-o4-basis")!.textContent).toBe(
      tl("de", "limit.multipleMinijobsForecastBasis"),
    );
    expect(q("forecast-o4-months")!.textContent).toContain(o4MonthLabel("2026-03"));
    expect(container.textContent).not.toContain(tl("de", "legalForecast.statusMaximum"));
  });
});

describe("i18n: neue R4-Schlüssel in allen Sprachen", () => {
  const keys = [
    "pay.notice.sick-case-possibly-separate",
    "sickRecalc.separateDays",
    "retro.title",
    "retro.body",
    "retro.row",
    "retro.lapsed",
    "retro.cancel",
    "retro.confirm",
    "sickLapsed.title",
    "sickLapsed.body",
    "sickLapsed.dismiss",
    "limit.multipleMinijobsOtherMonths",
    "limit.multipleMinijobsForecastBasis",
  ];
  for (const lang of ["de", "en", "ru", "tr", "pl"] as const) {
    it(lang, () => {
      for (const key of keys) {
        const text = tl(lang, key as never);
        expect(text, `${lang}:${key}`).not.toBe(key);
        expect(text.length).toBeGreaterThan(0);
      }
    });
  }
});
