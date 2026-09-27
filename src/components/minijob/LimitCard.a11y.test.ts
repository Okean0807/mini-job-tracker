/**
 * LimitCard – Accessible Names der Progressbars (axe: aria-progressbar-name).
 * Echter Render (react-dom/client + act, happy-dom; keine neue Dependency).
 * Der Name wird nach ARIA-Regel für aria-labelledby berechnet: Textinhalt der
 * referenzierten Elemente in Reihenfolge der IDs, mit Leerzeichen verbunden.
 */
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LimitCard } from "./LimitCard";
import { tl } from "@/lib/i18n";
import type { LimitUsage } from "@/lib/minijob/limits";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function usage(over: Partial<LimitUsage>): LimitUsage {
  return {
    earnings: 0,
    earningsLimit: 603,
    earningsShare: 0,
    hours: 0,
    hoursLimit: 44.67,
    hoursShare: 0,
    earningsLeft: 603,
    hoursLeft: 44.67,
    share: 0,
    limitSource: "legal",
    paidAbsenceHours: 0,
    absenceEarnings: 0,
    estimated: false,
    ...over,
  };
}

const MONTH = usage({
  earnings: 301.5,
  earningsShare: 50,
  earningsLeft: 301.5,
  hours: 22.25,
  hoursShare: 49.8,
  hoursLeft: 22.42,
  share: 50,
});
const YEAR = usage({
  earnings: 7500,
  earningsLimit: 7236,
  earningsShare: 103.6,
  earningsLeft: 0,
  hours: 540,
  hoursLimit: 536,
  hoursShare: 100.7,
  hoursLeft: 0,
  share: 103.6,
});

const monthScope = `${tl("de", "limit.month")} · September`;
const yearScope = `${tl("de", "limit.year")} · 2026`;

let container: HTMLDivElement;
let root: Root;

function renderCards() {
  act(() => {
    root.render(
      createElement(
        Fragment,
        null,
        createElement(LimitCard, { usage: MONTH, scopeLabel: monthScope, rate: 13.5, auto: true }),
        createElement(LimitCard, { usage: YEAR, scopeLabel: yearScope, rate: 13.5, auto: false }),
      ),
    );
  });
}

/** Accessible name über aria-labelledby (ARIA/AccName 2B). */
function nameOf(el: Element): string {
  const ids = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
  return ids
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

function cards(): HTMLElement[] {
  return [...container.children] as HTMLElement[];
}
function bars(card: Element): HTMLElement[] {
  return [...card.querySelectorAll<HTMLElement>('[role="progressbar"]')];
}
/** Sichtbarer Kartentitel und Label des jeweiligen Balkens aus dem DOM. */
function visibleTitle(card: Element): string {
  return card.querySelector("span")!.textContent!.trim();
}
function visibleLabel(bar: Element): string {
  return bar.parentElement!.querySelector("span.font-medium")!.textContent!.trim();
}

/** Markup ohne die neuen a11y-Attribute – muss dem Stand vor dem Fix entsprechen. */
function markupWithoutA11yIds(): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));
  clone.querySelectorAll("[aria-labelledby]").forEach((e) => e.removeAttribute("aria-labelledby"));
  return clone.innerHTML;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  renderCards();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("LimitCard progressbar accessible names", () => {
  it("rendert Monats- und Jahreskarte mit je zwei Progressbars", () => {
    expect(cards()).toHaveLength(2);
    for (const card of cards()) expect(bars(card)).toHaveLength(2);
  });

  it("jeder Balken hat einen Namen aus sichtbarem Label + Kartentitel", () => {
    const expectedLabels = [tl("de", "limit.earnings"), tl("de", "limit.hours")];
    const names: string[] = [];
    for (const card of cards()) {
      const title = visibleTitle(card);
      expect(title).toContain(tl("de", "limit.title"));
      bars(card).forEach((bar, i) => {
        const label = visibleLabel(bar);
        expect(label).toBe(expectedLabels[i]);
        const name = nameOf(bar);
        expect(name).not.toBe("");
        expect(name).toBe(`${label} ${title}`);
        names.push(name);
      });
    }
    expect(names[0]).toContain(monthScope);
    expect(names[1]).toContain(monthScope);
    expect(names[2]).toContain(yearScope);
    expect(names[3]).toContain(yearScope);
    // Monat und Jahr sind unterscheidbar.
    expect(new Set(names).size).toBe(4);
  });

  it("referenziert nur existierende, eindeutige IDs; keine Kollision Monat/Jahr", () => {
    const allIds = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(allIds).toHaveLength(6); // 2 Titel + 4 Labels
    expect(new Set(allIds).size).toBe(allIds.length);
    const [month, year] = cards() as [HTMLElement, HTMLElement];
    const monthRefs = bars(month).flatMap((b) => b.getAttribute("aria-labelledby")!.split(" "));
    const yearRefs = bars(year).flatMap((b) => b.getAttribute("aria-labelledby")!.split(" "));
    for (const id of [...monthRefs, ...yearRefs]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(monthRefs.filter((id) => yearRefs.includes(id))).toEqual([]);
    for (const id of monthRefs) expect(month.contains(document.getElementById(id))).toBe(true);
    for (const id of yearRefs) expect(year.contains(document.getElementById(id))).toBe(true);
  });

  it("Markup (ohne id/aria-labelledby) ist unverändert gegenüber vor dem Fix", () => {
    expect(markupWithoutA11yIds()).toMatchSnapshot();
  });

  it("Berechnungen unverändert: Prozent, Beträge, Stunden, Balkenwert", () => {
    const [month, year] = cards() as [HTMLElement, HTMLElement];
    const pct = (card: Element) =>
      [...card.querySelectorAll("span.tabular-nums")].map((s) => s.textContent!.trim());
    expect(pct(month)).toEqual(["50 %", "50 %"]);
    expect(pct(year)).toEqual(["104 %", "101 %"]);
    const transforms = (card: Element) =>
      bars(card).map((b) => (b.firstElementChild as HTMLElement).style.transform);
    expect(transforms(month)).toEqual(["translateX(-50%)", "translateX(-50%)"]);
    expect(transforms(year)).toEqual(["translateX(-0%)", "translateX(-0%)"]);
    const txt = (card: Element) => card.textContent!.replace(/[\u00a0\u202f]/g, " ");
    expect(txt(month)).toContain("301,50 € / 603,00 € · noch 301,50 €");
    expect(txt(month)).toContain("22,25 h / 44,67 h · 44,67 h bei 13,50 €/Std.");
    expect(txt(year)).toContain("7.500,00 € / 7.236,00 € · noch 0,00 €");
    expect(txt(year)).toContain("540,00 h / 536,00 h · noch 0,00 h");
    // Überschreitung: roter Balken + Hinweis nur in der Jahreskarte
    expect(bars(year).every((b) => b.className.includes("[&>div]:bg-destructive"))).toBe(true);
    expect(bars(month).some((b) => b.className.includes("[&>div]:bg-destructive"))).toBe(false);
    expect(year.textContent).toContain(tl("de", "limit.overExplain"));
    expect(month.textContent).not.toContain(tl("de", "limit.overExplain"));
  });
});
