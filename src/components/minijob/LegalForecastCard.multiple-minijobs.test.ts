/** P1-145-a: Prognosekarte zeigt bei HB + mehreren Minijobs keinen Status. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LegalForecastCard } from "./LegalForecastCard";
import { tl } from "@/lib/i18n";
import type { Rolling12ForecastResult } from "@/lib/minijob/legal/rolling";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const render = (multipleMinijobs?: boolean) =>
  act(() =>
    root.render(
      createElement(LegalForecastCard, {
        forecast: FORECAST,
        ...(multipleMinijobs === undefined ? {} : { multipleMinijobs }),
      }),
    ),
  );

describe("LegalForecastCard multipleMinijobs", () => {
  it("ohne Flag: Status 'OK' wie bisher", () => {
    render();
    expect(container.textContent).toContain(tl("de", "legalForecast.statusOk"));
  });

  it("mit Flag: Hinweis, kein OK-Status, keine Grenzwerte", () => {
    render(true);
    const text = container.textContent ?? "";
    expect(
      container.querySelector('[data-testid="legal-forecast-multiple-minijobs"]'),
    ).not.toBeNull();
    expect(text).toContain(tl("de", "limit.multipleMinijobs"));
    expect(text).not.toContain(tl("de", "legalForecast.statusOk"));
    expect(text).not.toContain(tl("de", "legalForecast.regular"));
    expect(text).not.toContain("%");
  });
});
