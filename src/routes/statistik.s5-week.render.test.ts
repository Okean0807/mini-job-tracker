/**
 * S5 Wochenansicht: Render-Tests der Statistik-Seite (F1-Fixture, heute = 04.10.2026).
 * Werte: abgeleitete Goldens aus `__fixtures__/stats-week-goldens.ts`.
 */
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppData, Settings } from "@/lib/minijob/types";

const state = vi.hoisted(() => ({ data: null as unknown }));

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

import { tl } from "@/lib/i18n";
import { reports } from "@/lib/i18n/dict/reports";
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

function setData(settings: Partial<Settings> = {}, partial: Partial<AppData> = {}) {
  state.data = {
    shifts: F1_SHIFTS,
    jobs: F1_JOBS,
    payments: [],
    objects: [],
    settings: { ...DEFAULT_SETTINGS, activeJobId: "J1", ...settings },
    ...partial,
  };
}

function render() {
  act(() => {
    root.render(createElement(StatsPage));
  });
}

const text = () => norm(container.textContent ?? "");
const byTestId = (id: string) =>
  norm(container.querySelector(`[data-testid="${id}"]`)?.textContent ?? "");

function click(el: Element | null | undefined, what: string) {
  if (!el) throw new Error(`${what} fehlt`);
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
}
const clickButton = (label: string) =>
  click(
    [...container.querySelectorAll("button")].find(
      (b) => norm(b.textContent ?? "").trim() === label,
    ),
    label,
  );
const clickAria = (label: string) =>
  click(container.querySelector(`button[aria-label="${label}"]`), label);
const openTab = (label: string) =>
  click(
    [...container.querySelectorAll('[role="tab"]')].find(
      (b) => norm(b.textContent ?? "").trim() === label,
    ),
    label,
  );
const selectedTab = () =>
  norm(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "").trim();
const label = () => norm(container.querySelector("main p.text-lg")?.textContent ?? "");

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 4, 12, 0, 0)); // So 04.10.2026 (F1_TODAY)
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("S5 Woche: Tabs, Navigation, Startwoche", () => {
  it("Tabs Woche|Monat|Jahr, Default Monat", () => {
    setData();
    render();
    expect(selectedTab()).toBe(t("stats.tab.month"));
    openTab(t("stats.tab.week"));
    expect(selectedTab()).toBe(t("stats.tab.week"));
  });

  it("E9: aktueller Monat → aktuelle KW 40 mit Datumsbereich und Status", () => {
    setData();
    render();
    openTab(t("stats.tab.week"));
    expect(label()).toBe("KW 40/2026");
    expect(byTestId("week-range")).toBe("28.09.2026 – 04.10.2026");
    expect(byTestId("week-status")).toBe(t("stats.week.status.running", { day: 7 }));
  });

  it("E9: anderer Monat (September) → KW des 1. (KW 36); ‹ › und Heute", () => {
    setData();
    render();
    clickAria(t("stats.period.prev"));
    openTab(t("stats.tab.week"));
    expect(label()).toBe("KW 36/2026");
    expect(byTestId("week-status")).toBe(t("stats.week.status.past"));
    clickAria(t("stats.period.next"));
    expect(label()).toBe("KW 37/2026");
    clickButton(t("stats.period.today"));
    expect(label()).toBe("KW 40/2026");
  });

  it("Jahreswechsel: Januar 2027 → KW 53/2026 (28.12.–03.01.), weiter KW 1/2027", () => {
    setData();
    render();
    for (let i = 0; i < 3; i++) clickAria(t("stats.period.next"));
    openTab(t("stats.tab.week"));
    expect(label()).toBe("KW 53/2026");
    expect(byTestId("week-range")).toBe("28.12.2026 – 03.01.2027");
    clickAria(t("stats.period.next"));
    expect(label()).toBe("KW 1/2027");
    expect(byTestId("week-status")).toBe(t("stats.week.status.future"));
  });
});

describe("S5 Woche: KPIs, Vergleich, keine Jahresgrenze/Exporte", () => {
  it("KW 40 (Woche über Monatsgrenze): 201 € / 14 h / 4 Tage; vs. KW 39 +68 % / +250 %", () => {
    setData();
    render();
    openTab(t("stats.tab.week"));
    expect(text()).toContain(eur(201));
    expect(text()).toContain(hrs(14));
    const cmp = byTestId("week-compare");
    expect(cmp).toContain(t("stats.week.compare.title", { week: 39, year: 2026 }));
    expect(byTestId("compare-earnings")).toContain("+68 %");
    expect(byTestId("compare-earnings")).toContain(`+${eur(81)}`);
    expect(byTestId("compare-hours")).toContain("+250 %");
    expect(byTestId("compare-workdays")).toContain("+3");
    expect(byTestId("compare-workdays")).not.toContain("%");
  });

  it("keine Jahresgrenze, keine Exporte, keine Zahlungen in der Woche", () => {
    setData();
    render();
    openTab(t("stats.tab.week"));
    const s = text();
    expect(s).not.toContain(t("stats.card.yearLimit"));
    expect(s).not.toContain(t("stats.kpi.yearLimitAll"));
    expect(s).not.toContain(t("stats.export.menu"));
    expect(s).not.toContain(t("stats.export.listExcel"));
    expect(s).not.toContain(t("stats.details.payments"));
    expect(s).not.toContain(t("stats.card.avgRate"));
  });

  it("KW 38: Urlaub = Verdienst ohne Arbeitszeit; davon Arbeit/Abwesenheit; Filter Café Nord", () => {
    setData();
    render();
    openTab(t("stats.tab.week"));
    clickAria(t("stats.period.prev"));
    clickAria(t("stats.period.prev"));
    expect(label()).toBe("KW 38/2026");
    expect(text()).toContain(eur(211.07));
    expect(text()).toContain(t("stats.week.ofWork", { amount: eur(152.25) }));
    expect(text()).toContain(t("stats.week.ofAbsence", { amount: eur(58.82) }));
    expect(text()).toContain(hrs(10.5));
    expect(byTestId("compare-earnings")).toContain(`${"\u2212"}13 %`);
    clickButton("Café Nord");
    expect(text()).toContain(eur(106.07));
    const bd = byTestId("week-breakdown");
    expect(bd).toContain("Café Nord");
    expect(bd).not.toContain("Büro Plan");
  });

  it("zukünftige KW 41: Hauptwert 0 €, „+ 114,00 € geplant“, kein Vergleich", () => {
    setData();
    render();
    openTab(t("stats.tab.week"));
    clickAria(t("stats.period.next"));
    expect(byTestId("week-status")).toBe(t("stats.week.status.future"));
    expect(text()).toContain(t("stats.week.planned", { value: eur(114) }));
    expect(text()).toContain(t("stats.week.planned", { value: hrs(8) }));
    expect(byTestId("week-compare")).toBe(t("stats.week.compare.future"));
    expect(byTestId("week-legend")).toContain(t("stats.week.chart.planned"));
  });

  it("leere Woche (Juli → KW 27): Keine Werte, leere Aufteilung", () => {
    setData();
    render();
    for (let i = 0; i < 3; i++) clickAria(t("stats.period.prev"));
    openTab(t("stats.tab.week"));
    expect(label()).toBe("KW 27/2026");
    expect(byTestId("compare-earnings")).toContain(t("stats.week.compare.noValues"));
    expect(byTestId("week-breakdown")).toContain(t("stats.week.breakdown.empty"));
  });

  it("Vorwoche ohne Einträge (KW 36 vs. 35) → kein Prozent", () => {
    setData();
    render();
    clickAria(t("stats.period.prev"));
    openTab(t("stats.tab.week"));
    expect(byTestId("compare-earnings")).toContain(t("stats.week.compare.noPrevious"));
  });
});

describe("S5 Woche: Soll/Ist (gleiches Gating wie Monat, E5)", () => {
  it("aktiver Fest-Job Büro Plan: Soll/Ist-Kachel; abgeschlossene KW 39 ohne „inkl. geplant“ (P3-1)", () => {
    setData({ activeJobId: "J2" });
    render();
    openTab(t("stats.tab.week"));
    clickAria(t("stats.period.prev")); // KW 39: Krank 21.09. bleibt Minus (B7)
    expect(text()).toContain(t("stats.week.kpi.sollIst"));
    expect(text()).toContain(`${hrs(4)} / ${hrs(8)}`);
    expect(text()).not.toContain(t("stats.week.inclPlanned"));
  });

  it("zukünftige KW 41 mit geplanter Arbeit: „Ist inkl. geplant“ sichtbar (P3-1)", () => {
    setData({ activeJobId: "J2" });
    render();
    openTab(t("stats.tab.week"));
    clickAria(t("stats.period.next")); // KW 41: J2 07.10. geplant
    expect(text()).toContain(`${hrs(4)} / ${hrs(8)}`);
    expect(text()).toContain(t("stats.week.inclPlanned"));
  });

  /** Soll/Ist-Accordion „Soll / Ist pro Tag“ öffnen und dessen Inhalt liefern (P3-A). */
  function openSollIstDetails(): string {
    clickButton(t("stats.week.details.sollIst"));
    const trigger = [...container.querySelectorAll("button")].find(
      (b) => norm(b.textContent ?? "").trim() === t("stats.week.details.sollIst"),
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    const region = container.querySelector('[role="region"]');
    if (!region) throw new Error("Soll/Ist-Details nicht geöffnet");
    const content = norm(region.textContent ?? "");
    expect(content).toContain(t("stats.week.table.soll"));
    return content;
  }

  it("geöffnete Soll/Ist-Details: abgeschlossene KW 39 ohne „Ist inkl. geplant“ (P3-A)", () => {
    setData({ activeJobId: "J2" });
    render();
    openTab(t("stats.tab.week"));
    clickAria(t("stats.period.prev")); // KW 39
    expect(label()).toBe("KW 39/2026");
    expect(openSollIstDetails()).not.toContain(t("stats.week.inclPlanned"));
    expect(text()).not.toContain(t("stats.week.inclPlanned"));
  });

  it("geöffnete Soll/Ist-Details: KW 41 mit geplanter Arbeit zeigt „Ist inkl. geplant“ (P3-A)", () => {
    setData({ activeJobId: "J2" });
    render();
    openTab(t("stats.tab.week"));
    clickAria(t("stats.period.next")); // KW 41: J2 07.10. geplant
    expect(label()).toBe("KW 41/2026");
    expect(openSollIstDetails()).toContain(t("stats.week.inclPlanned"));
  });

  it("aktiver Flex-Job: keine Soll/Ist-Kachel (wie Monat)", () => {
    setData({ activeJobId: "J1" });
    render();
    openTab(t("stats.tab.week"));
    expect(text()).not.toContain(t("stats.week.kpi.sollIst"));
  });
});

describe("S5 i18n (E10)", () => {
  it("alle neuen S5-Schlüssel sind in de/en/ru/tr/pl vorhanden (kein Deutsch-Fallback)", () => {
    const keys = Object.keys(reports.de ?? {}).filter(
      (k) => k.startsWith("stats.week.") || k === "stats.tab.week",
    );
    expect(keys.length).toBe(39);
    for (const lang of ["en", "ru", "tr", "pl"] as const) {
      for (const k of keys) {
        expect(reports[lang]?.[k], `${lang}:${k}`).toBeTruthy();
      }
    }
  });
});
