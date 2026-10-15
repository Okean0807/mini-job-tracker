/** B3-1 / O4: LimitCard zeigt bei HB + mehreren Minijobs nur einen Hinweis. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LimitCard } from "./LimitCard";
import { tl } from "@/lib/i18n";
import type { LimitUsage } from "@/lib/minijob/limits";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OVER: LimitUsage = {
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

let container: HTMLDivElement;
let root: Root;

function render(multipleMinijobs?: boolean) {
  act(() => {
    root.render(
      createElement(LimitCard, {
        usage: OVER,
        scopeLabel: "Monat · September",
        rate: 13.9,
        auto: true,
        ...(multipleMinijobs === undefined ? {} : { multipleMinijobs }),
      }),
    );
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

describe("LimitCard multipleMinijobs", () => {
  it("zeigt Hinweis, keine Progressbars, keinen Prozentwert, keine Überschreitungs-Erklärung", () => {
    render(true);
    const text = container.textContent ?? "";
    expect(container.querySelector('[data-testid="limit-multiple-minijobs"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
    expect(text).toContain(tl("de", "limit.multipleMinijobs"));
    expect(text).toContain(tl("de", "limit.multipleMinijobsHint"));
    expect(text).not.toContain("%");
    expect(text).not.toContain(tl("de", "limit.overExplain"));
    expect(container.querySelector(".text-destructive")).toBeNull();
  });

  it("ohne Flag: Karte unverändert (Balken + Überschreitungs-Erklärung)", () => {
    render();
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
    expect(container.textContent).toContain(tl("de", "limit.overExplain"));
    expect(container.querySelector('[data-testid="limit-multiple-minijobs"]')).toBeNull();
  });

  it("Übersetzungen in allen Sprachen vorhanden", () => {
    for (const lang of ["de", "en", "ru", "tr", "pl"] as const) {
      for (const key of [
        "limit.multipleMinijobs",
        "limit.multipleMinijobsHint",
        "limit.multipleMinijobsSum",
      ]) {
        const value = tl(lang, key as Parameters<typeof tl>[1]);
        expect(value).not.toBe(key);
        expect(value.length).toBeGreaterThan(5);
      }
    }
  });
});
