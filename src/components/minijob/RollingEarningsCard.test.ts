/**
 * RollingEarningsCard – "Verdienste der letzten 12 Monate": states, separation of recorded
 * and future-dated figures, and informational (never violation) styling.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RollingEarningsCard } from "./RollingEarningsCard";
import { t } from "@/lib/i18n";
import { forecastRolling12Months } from "@/lib/minijob/legal/rolling";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

/** 12 months of 2026: `actual` per month, optional entered-for-later amounts. */
function card(actual: number[], planned: number[] = []) {
  const inputs = actual.map((a, i) => ({
    date: `2026-${String(i + 1).padStart(2, "0")}-01`,
    actual: a,
    expectedAdditional: planned[i] ?? 0,
  }));
  const rolling = forecastRolling12Months(inputs, "2026-12-01");
  act(() => root.render(createElement(RollingEarningsCard, { rolling })));
  return {
    text: container.textContent ?? "",
    html: container.innerHTML,
    q: (id: string) => container.querySelector(`[data-testid="${id}"]`)?.textContent ?? "",
  };
}
const flat = (amount: number) => Array.from({ length: 12 }, () => amount);

describe("RollingEarningsCard", () => {
  it("title and subtitle identify an orientation value", () => {
    const c = card(flat(100));
    expect(c.text).toContain("Verdienste der letzten 12 Monate");
    expect(c.text).toContain(t("rolling.subtitle"));
  });

  it("within the range: neutral status, no above-range hint, disclaimer present", () => {
    const c = card(flat(500)); // 6,000 EUR of 7,236
    expect(c.text).toContain(t("rolling.statusWithin"));
    expect(c.text).not.toContain(t("rolling.aboveHint"));
    expect(c.text).toContain(t("rolling.disclaimer"));
  });

  it("near the range: shows the percentage of the reference range", () => {
    const c = card(flat(550)); // 6,600 EUR = 91 %
    expect(c.text).toContain(t("rolling.statusNear", { percent: 91 }));
  });

  it("above the range: orientation wording plus the 'no legal determination' hint", () => {
    const c = card(flat(700)); // 8,400 EUR
    expect(c.text).toContain(t("rolling.statusAbove"));
    expect(c.text).toContain(t("rolling.aboveHint"));
    expect(c.text).not.toMatch(
      /Verstoß|rechtlich überschritten|Prognose|Maximalrahmen|Sondermonate/,
    );
  });

  it("recorded, entered-for-later and total are three separate figures", () => {
    const planned = Array(12).fill(0);
    planned[11] = 300;
    const c = card(flat(100), planned);
    expect(c.q("rolling-actual")).toContain("1.200");
    expect(c.q("rolling-planned")).toContain("300");
    expect(c.q("rolling-total")).toContain("1.500");
    expect(c.q("rolling-frame")).toContain("7.236");
    expect(c.text).toContain(t("rolling.plannedNote"));
  });

  it("without entries for later there is no planning note and the planned figure is zero", () => {
    const c = card(flat(100));
    expect(c.q("rolling-planned")).toContain("0,00");
    expect(c.text).not.toContain(t("rolling.plannedNote"));
  });

  it("an extreme month shows the informational signal, which says what it does not decide", () => {
    const c = card([1800, 1800, 1800, 204, 204, 204, 204, 204, 204, 204, 204, 204]);
    expect(c.text).toContain(t("rolling.signal"));
    expect(c.text).toContain("entscheidet nicht darüber, ob die gesetzliche Ausnahme");
  });

  it("no signal for ordinary months, and its absence is not presented as acceptance", () => {
    const c = card(flat(550));
    expect(c.text).not.toContain(t("rolling.signal"));
    expect(c.text).not.toMatch(/zulässig|unbedenklich|konform|compliant/i);
  });

  it("no special-months, 'Maximalrahmen' or destructive styling anywhere in the card", () => {
    for (const amounts of [flat(100), flat(550), flat(700)]) {
      const c = card(amounts);
      expect(c.html).not.toMatch(/destructive/);
      expect(c.text).not.toMatch(/Sondermonate|Maximalrahmen/);
    }
  });

  it("always states that the range is 12 months and that proration is not calculated", () => {
    expect(card(flat(100)).text).toContain(t("rolling.windowNote"));
  });
});
