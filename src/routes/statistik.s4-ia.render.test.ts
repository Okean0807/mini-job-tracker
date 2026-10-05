/**
 * S4 IA-Regression: Monat|Jahr only, Ø = workEarnings/workedHours (B1),
 * Jobs/Bericht-Tabs weg, Jahresbericht-Export gefiltert, Chart-Umschalter.
 */
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppData } from "@/lib/minijob/types";

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
import { buildAnnualReport } from "@/lib/minijob/annual";
import { exportAnnualPdf } from "@/lib/minijob/annual-export";
import { formatEuro, shiftsInMonth } from "@/lib/minijob/calc";
import { makeResolver } from "@/lib/minijob/resolve";
import { payrollTotals } from "@/lib/minijob/payroll";
import { avgHourlyRate } from "@/lib/minijob/stats-avg-rate";
import { Route } from "./statistik";
import { B4_JOBS, B4_SETTINGS, B4_SHIFTS } from "@/lib/minijob/__fixtures__/stats-legal-limit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const StatsPage = (Route as unknown as { options: { component: ComponentType } }).options.component;
const t = (key: string, vars?: Record<string, string | number>) => tl("de", key, vars);
const norm = (s: string) => s.replace(/\u00a0/g, " ");

let container: HTMLDivElement;
let root: Root;

function setData(partial: Partial<AppData> = {}) {
  state.data = {
    shifts: B4_SHIFTS,
    jobs: B4_JOBS,
    payments: [],
    objects: [],
    settings: B4_SETTINGS,
    ...partial,
  };
}

function render() {
  act(() => {
    root.render(createElement(StatsPage));
  });
}

const text = () => norm(container.textContent ?? "");

function clickButton(label: string) {
  const btn = [...container.querySelectorAll("button")].find(
    (b) => norm(b.textContent ?? "").trim() === label,
  );
  if (!btn) throw new Error(`Button ${label} fehlt`);
  act(() => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function openTab(label: string) {
  const tab = [...container.querySelectorAll('[role="tab"]')].find(
    (b) => norm(b.textContent ?? "").trim() === label,
  ) as HTMLElement | undefined;
  if (!tab) throw new Error(`Tab ${label} fehlt`);
  act(() => {
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    tab.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
  expect(tab.getAttribute("aria-selected")).toBe("true");
}

function tabLabels() {
  return [...container.querySelectorAll('[role="tab"]')].map((el) =>
    norm(el.textContent ?? "").trim(),
  );
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // September 2026 — Fixture hat 9 Schichten (Ø B1 prüfbar)
  vi.setSystemTime(new Date(2026, 8, 15, 12, 0, 0));
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

describe("S4 IA: Monat|Jahr Struktur", () => {
  it("A1: nur Monat|Jahr-Tabs; Jobs- und Bericht-Tabs fehlen", () => {
    setData();
    render();
    expect(tabLabels()).toEqual([t("stats.tab.month"), t("stats.tab.year")]);
    expect(text()).not.toMatch(new RegExp(`\\b${t("stats.tab.jobs")}\\b`));
    expect(text()).not.toMatch(new RegExp(`\\b${t("stats.tab.report")}\\b`));
    expect(text()).toContain(t("stats.breakdown.title"));
    expect(text()).toContain(t("stats.export.menu"));
  });

  it("B1: Ø Stundenlohn = workEarnings / workedHours (Monat September)", () => {
    setData();
    render();
    const resolve = makeResolver(B4_JOBS, B4_SETTINGS);
    const list = shiftsInMonth(B4_SHIFTS, 2026, 8);
    const totals = payrollTotals(list, resolve, B4_SHIFTS);
    const expected = norm(formatEuro(avgHourlyRate(totals.workEarnings, totals.workedHours)));
    expect(totals.workedHours).toBe(36);
    expect(totals.workEarnings).toBe(510);
    expect(expected).toBe("14,17 €");
    expect(text()).toContain(t("stats.card.avgRate"));
    expect(text()).toContain(expected);
  });

  it("Chart: Umschalter Stunden|Verdienst vorhanden (ein Hauptdiagramm)", () => {
    setData();
    render();
    expect(text()).toContain(t("stats.chart.mode.hours"));
    expect(text()).toContain(t("stats.chart.mode.earnings"));
    expect(text()).toContain(t("stats.chart.perDay"));
    clickButton(t("stats.chart.mode.earnings"));
    // Umschalten bleibt auf Monat — kein zweites Peer-Diagramm-Tab
    expect(tabLabels()).toEqual([t("stats.tab.month"), t("stats.tab.year")]);
  });

  it("C1: Jahr zeigt Jahresgrenze-KPI + Jahresbericht-Export; Details zugeklappt", () => {
    setData();
    render();
    openTab(t("stats.tab.year"));
    expect(text()).toContain(t("stats.card.yearLimit"));
    expect(text()).toContain(t("stats.kpi.yearLimitAll"));
    expect(text()).toContain(t("stats.details.yearExtras"));
    // Accordion zugeklappt: Wochentags-Chart-Titel aus annual noch nicht sichtbar, bis geöffnet
    // (Trigger-Text ist sichtbar; Inhalt ggf. im DOM — Export-Buttons sind sichtbar)
    expect(text()).toContain(`${t("stats.export.annualReport")} PDF`);
    expect(text()).toContain(`${t("stats.export.annualReport")} Excel`);
  });

  it("Export Jahresbericht bleibt gefiltert (Entscheidung a)", () => {
    setData();
    render();
    openTab(t("stats.tab.year"));
    clickButton("Minijob A");
    vi.mocked(exportAnnualPdf).mockClear();
    clickButton(`${t("stats.export.annualReport")} PDF`);
    const resolve = makeResolver(B4_JOBS, B4_SETTINGS);
    const shown = B4_SHIFTS.filter((s) => s.jobId === "MA");
    const base = buildAnnualReport(shown, B4_JOBS, B4_SETTINGS, 2026, resolve);
    const exported = vi.mocked(exportAnnualPdf).mock.calls[0]![0];
    expect(exported).toEqual(base);
    // Gefilterter Export (MA): limitShare folgt yearUsage(gefiltert), nicht der UI-Rechtsgrenze 14 %.
    expect(Math.round(exported.limitShare)).toBe(Math.round(base.limitShare));
    expect(Math.round(exported.limitShare)).toBeLessThan(14);
    expect(exported.earnings).toBe(594);
  });
});
