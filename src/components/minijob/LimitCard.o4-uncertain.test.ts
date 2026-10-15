/** Owner R5 / D6 Variante B: unsicherer O4-Status → expliziter Zustand, kein Prozentwert. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LegalForecastCard } from "./LegalForecastCard";
import { LimitCard } from "./LimitCard";
import { tl } from "@/lib/i18n";
import type { Rolling12ForecastResult } from "@/lib/minijob/legal/rolling";
import type { LimitUsage } from "@/lib/minijob/limits";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USAGE: LimitUsage = {
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
};
const FORECAST: Rolling12ForecastResult = {
  anchorMonth: "2026-09-01",
  months: [],
  projectedEarnings: 5350,
  regularLimit: 7095,
  maximumAllowedIncome: 8514,
  unpredictableMonths: 0,
  exceedsRegularLimit: false,
  exceedsMaximumAllowedIncome: false,
  allowedIfForecastRealized: true,
};

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

describe("O4 unsicher (Variante B)", () => {
  it("LimitCard: Unsicher-Hinweis + Monate, keine Balken, kein Prozent, keine Überschreitung", () => {
    act(() =>
      root.render(
        createElement(LimitCard, {
          usage: USAGE,
          scopeLabel: "Jahr · 2026",
          rate: 13.9,
          auto: true,
          o4Uncertain: true,
          uncertainMonths: ["2026-05"],
        }),
      ),
    );
    const text = container.textContent ?? "";
    expect(container.querySelector('[data-testid="limit-o4-uncertain"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="limit-o4-uncertain-months"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
    expect(text).toContain(tl("de", "limit.o4Uncertain"));
    expect(text).toContain(tl("de", "limit.o4UncertainHint"));
    expect(text).not.toContain("%");
    expect(text).not.toContain(tl("de", "limit.overExplain"));
  });

  it("LegalForecastCard: kein OK-Status, Unsicher-Hinweis + Monate", () => {
    act(() =>
      root.render(
        createElement(LegalForecastCard, {
          forecast: FORECAST,
          o4Uncertain: true,
          uncertainMonths: ["2026-05"],
        }),
      ),
    );
    const text = container.textContent ?? "";
    expect(container.querySelector('[data-testid="legal-forecast-o4-uncertain"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="forecast-o4-uncertain-months"]')).not.toBeNull();
    expect(text).toContain(tl("de", "limit.o4Uncertain"));
    expect(text).not.toContain(tl("de", "legalForecast.statusOk"));
    expect(text).not.toContain("%");
  });

  it("Übersetzungen in allen 5 Sprachen", () => {
    for (const lang of ["de", "en", "ru", "tr", "pl"] as const) {
      for (const key of ["limit.o4Uncertain", "limit.o4UncertainHint"] as const) {
        const value = tl(lang, key);
        expect(value).not.toBe(key);
        expect(value.length).toBeGreaterThan(5);
      }
      const months = tl(lang, "limit.o4UncertainMonths", { months: "Mai 2026" });
      expect(months).toContain("Mai 2026");
    }
  });
});
