/**
 * S5 Wochenansicht – laufende KW 41 am Di 06.10.2026 (F1-Fixture): tatsächliche
 * UND geplante Einträge in derselben Woche, plus Post-S5-Fixes.
 *
 * - P2-1 (aus QA-Scratch übernommen): Hauptwert der KPI-Kachel nur tatsächlich,
 *   geplant separat; Job-Filter ändert die Kachel. Werte aus den abgeleiteten
 *   Goldens (KW 41 am 06.10.: tatsächlich 54 € / 4 h = J1 06.10.,
 *   geplant 60 € / 4 h = J2 07.10.).
 * - P3-1: „Ist inkl. geplant“ nur, wenn Ist der Woche geplante Arbeit enthält.
 * - P3-3: Payroll-Historie ist auch bei Job-Filter die volle Schichtliste.
 * - P3-5: kein Soll vor Beschäftigungsbeginn (Büro Plan ab 01.06.2026).
 */
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppData, Settings, Shift } from "@/lib/minijob/types";

const state = vi.hoisted(() => ({ data: null as unknown, historyLengths: [] as number[] }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children }: { children?: unknown }) => children,
}));

vi.mock("@/lib/minijob/annual-export", () => ({
  exportAnnualPdf: vi.fn(),
  exportAnnualXlsx: vi.fn(),
}));

vi.mock("@/lib/minijob/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/minijob/store")>();
  return { ...actual, useAppData: () => state.data };
});

// Beobachtet nur die übergebene Historie; Berechnung bleibt die echte.
vi.mock("@/lib/minijob/period-payroll", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/minijob/period-payroll")>();
  return {
    ...actual,
    evaluateShifts: (...args: Parameters<typeof actual.evaluateShifts>) => {
      state.historyLengths.push(args[2].length);
      return actual.evaluateShifts(...args);
    },
  };
});

import { tl } from "@/lib/i18n";
import { formatEuro, formatHours } from "@/lib/minijob/calc";
import { DEFAULT_SETTINGS } from "@/lib/minijob/types";
import { F1_JOBS, F1_SHIFTS } from "@/lib/minijob/__fixtures__/stats-periods";
import { Route } from "./statistik";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const StatsPage = (Route as unknown as { options: { component: ComponentType } }).options.component;
const t = (key: string, vars?: Record<string, string | number>) => tl("de", key, vars);
const norm = (s: string) => s.replace(/\u00a0/g, " ").replace(/\u202f/g, " ");
const eur = (n: number) => norm(formatEuro(n));
const hrs = (n: number) => norm(formatHours(n));

let container: HTMLDivElement;
let root: Root;

function setData(settings: Partial<Settings> = {}, shifts: Shift[] = F1_SHIFTS) {
  state.data = {
    shifts,
    jobs: F1_JOBS,
    payments: [],
    objects: [],
    settings: { ...DEFAULT_SETTINGS, activeJobId: "J1", ...settings },
  } as Partial<AppData>;
}

function render() {
  act(() => {
    root.render(createElement(StatsPage));
  });
}

function click(el: Element | null | undefined, what: string) {
  if (!el) throw new Error(`${what} fehlt`);
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
}
const clickButton = (name: string) =>
  click(
    [...container.querySelectorAll("button")].find(
      (b) => norm(b.textContent ?? "").trim() === name,
    ),
    name,
  );
const clickAria = (name: string) =>
  click(container.querySelector(`button[aria-label="${name}"]`), name);
const openTab = (name: string) =>
  click(
    [...container.querySelectorAll('[role="tab"]')].find(
      (b) => norm(b.textContent ?? "").trim() === name,
    ),
    name,
  );
const periodLabel = () => norm(container.querySelector("main p.text-lg")?.textContent ?? "");

/** KPI-Kachel über ihr Label finden (Hauptwert + alle Zeilen). */
function tile(labelKey: string) {
  const lbl = [...container.querySelectorAll("span")].find(
    (s) => norm(s.textContent ?? "").trim() === t(labelKey),
  );
  const card = lbl?.closest("div.rounded-2xl");
  if (!card) throw new Error(`Kachel fehlt: ${labelKey}`);
  return {
    value: norm(card.querySelector("p.text-2xl")?.textContent ?? ""),
    lines: [...card.querySelectorAll("p")].map((p) => norm(p.textContent ?? "")),
  };
}
const plannedLine = (value: string) => t("stats.week.planned", { value });
const hasPlannedLine = (lines: string[]) =>
  lines.some((l) => l.startsWith("+ ") && l.endsWith(t("stats.week.chart.planned")));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 6, 12, 0, 0)); // Di 06.10.2026: KW 41 laufend
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  state.historyLengths = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("P2-1: laufende KW 41 – Hauptwert tatsächlich, geplant separat", () => {
  it("Alle Jobs: 54,00 € / 4,00 h tatsächlich, + 60,00 € / + 4,00 h geplant", () => {
    setData();
    render();
    openTab(t("stats.tab.week"));
    expect(periodLabel()).toBe("KW 41/2026");
    const e = tile("stats.week.kpi.earnings");
    expect(e.value).toBe(eur(54));
    expect(e.lines).toContain(plannedLine(eur(60)));
    const h = tile("stats.week.kpi.hours");
    expect(h.value).toBe(hrs(4));
    expect(h.lines).toContain(plannedLine(hrs(4)));
  });

  it("Job-Filter ändert die Kachel: Büro Plan 0,00 € + 60,00 € geplant; Café Nord 54,00 € ohne geplant", () => {
    setData();
    render();
    openTab(t("stats.tab.week"));
    clickButton("Büro Plan");
    expect(tile("stats.week.kpi.earnings").value).toBe(eur(0));
    expect(tile("stats.week.kpi.hours").value).toBe(hrs(0));
    expect(tile("stats.week.kpi.earnings").lines).toContain(plannedLine(eur(60)));
    clickButton("Café Nord");
    const cafe = tile("stats.week.kpi.earnings");
    expect(cafe.value).toBe(eur(54));
    expect(hasPlannedLine(cafe.lines)).toBe(false);
  });
});

describe("P3-1: „Ist inkl. geplant“ folgt dem Wochenstatus/Flag", () => {
  it("laufende KW 41 mit geplanter Arbeit (J2 07.10.) → Hinweis sichtbar", () => {
    setData({ activeJobId: "J2" });
    render();
    openTab(t("stats.tab.week"));
    const s = tile("stats.week.kpi.sollIst");
    expect(s.value).toBe(`${hrs(4)} / ${hrs(8)}`);
    expect(s.lines).toContain(t("stats.week.inclPlanned"));
  });

  it("abgeschlossene KW 40 → kein Hinweis", () => {
    setData({ activeJobId: "J2" });
    render();
    openTab(t("stats.tab.week"));
    clickAria(t("stats.period.prev"));
    expect(periodLabel()).toBe("KW 40/2026");
    const s = tile("stats.week.kpi.sollIst");
    expect(s.value).toBe(`${hrs(8)} / ${hrs(8)}`);
    expect(s.lines).not.toContain(t("stats.week.inclPlanned"));
    expect(norm(container.textContent ?? "")).not.toContain(t("stats.week.inclPlanned"));
  });
});

describe("P3-3: Payroll-Historie = volle Schichtliste, auch mit Job-Filter (Guardrail)", () => {
  it.each(["Café Nord", "Büro Plan"])(
    "Filter %s: jede Wochen-Bewertung nutzt alle Schichten",
    (job) => {
      setData();
      render();
      openTab(t("stats.tab.week"));
      state.historyLengths = [];
      clickButton(job);
      expect(state.historyLengths.length).toBeGreaterThan(0);
      expect(new Set(state.historyLengths)).toEqual(new Set([F1_SHIFTS.length]));
    },
  );
});

describe("P3-5: kein Soll vor Beschäftigungsbeginn (Büro Plan ab 01.06.2026)", () => {
  function goToMonth(name: string) {
    for (let i = 0; i < 12 && periodLabel() !== name; i++) clickAria(t("stats.period.prev"));
    expect(periodLabel()).toBe(name);
  }

  it("Monat März 2026 und KW 13/2026: Soll 0,00 h", () => {
    setData({ activeJobId: "J2" });
    render();
    goToMonth("März 2026");
    expect(tile("stats.kpi.sollIst").value).toBe(`${hrs(0)} / ${hrs(0)}`);
    openTab(t("stats.tab.week"));
    expect(periodLabel()).toBe("KW 9/2026");
    for (let i = 0; i < 4; i++) clickAria(t("stats.period.next"));
    expect(periodLabel()).toBe("KW 13/2026");
    expect(tile("stats.week.kpi.sollIst").value).toBe(`${hrs(0)} / ${hrs(0)}`);
  });

  it("Regression: September 2026 bleibt 28 h / 36 h, KW 39 bleibt 4 h / 8 h", () => {
    setData({ activeJobId: "J2" });
    render();
    goToMonth("September 2026");
    expect(tile("stats.kpi.sollIst").value).toBe(`${hrs(28)} / ${hrs(36)}`);
    openTab(t("stats.tab.week"));
    for (let i = 0; i < 3; i++) clickAria(t("stats.period.next"));
    expect(periodLabel()).toBe("KW 39/2026");
    expect(tile("stats.week.kpi.sollIst").value).toBe(`${hrs(4)} / ${hrs(8)}`);
  });
});
