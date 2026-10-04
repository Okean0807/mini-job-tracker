/**
 * Render-Test (react-dom/client + act, happy-dom) der Statistik-Seite – S3 / B4.
 *
 * Prüft am echten Aufrufort (StatsPage), dass die rechtliche Minijob-Jahresgrenze
 * (Jahr-Karte „Jahresgrenze“ + Bericht-Kennzahl „Grenze“) bei jedem Job-Filter
 * gleich bleibt, während Jahresverdienst/-stunden weiter gefiltert werden.
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

vi.mock("@/lib/minijob/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/minijob/store")>();
  return { ...actual, useAppData: () => state.data };
});

import { tl } from "@/lib/i18n";
import { formatEuro } from "@/lib/minijob/calc";
import { Route } from "./statistik";
import {
  B4_JOBS,
  B4_SETTINGS,
  B4_SHIFTS,
  HB,
  KF,
  LEGACY,
  SE,
  SHIFTS_HB,
  work,
} from "@/lib/minijob/__fixtures__/stats-legal-limit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const StatsPage = (Route as unknown as { options: { component: ComponentType } }).options.component;
const t = (key: string, vars?: Record<string, string | number>) => tl("de", key, vars);
const norm = (s: string) => s.replace(/\u00a0/g, " ");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let container: HTMLDivElement;
let root: Root;

function setData(partial: Partial<AppData>) {
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

/** Jahr-Tab: „Jahresgrenze“-Karte (Prozent + Grenze) und Jahresverdienst. */
function readYearTab() {
  const s = text();
  const limit = s.match(new RegExp(`${esc(t("stats.card.yearLimit"))}\\s*(\\d+) %`));
  const hint = s.includes(t("stats.card.yearLimitHint", { amount: norm(formatEuro(7236)) }));
  const earn = s.match(new RegExp(`${esc(t("stats.card.yearEarnings"))}\\s*([\\d.,]+ €)`));
  return { limitPct: limit?.[1] ?? null, limitHint: hint, yearEarnings: earn?.[1] ?? null };
}

/** Bericht-Tab: Kennzahl „Grenze: N %“ und Jahresverdienst des Berichts. */
function readReportTab() {
  const s = text();
  const m = s.match(new RegExp(`${esc(t("annual.kpi.limit"))}: (\\d+) %`));
  const e = s.match(new RegExp(`${esc(t("annual.kpi.earnings"))}\\s*([\\d.,]+ €)`));
  return { limitPct: m?.[1] ?? null, earnings: e?.[1] ?? null };
}

const FILTERS = [t("stats.allJobs"), "Minijob A", "Minijob B", "Hauptjob"];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 4, 12, 0, 0));
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

describe("Statistik (Seite): Jahresgrenze unabhängig vom Job-Filter", () => {
  it("Jahr-Tab: Jahresgrenze 14 % bei Alle / Minijob A / Minijob B / Hauptjob; Jahresverdienst gefiltert", () => {
    setData({});
    render();
    openTab(t("stats.tab.year"));
    const rows = FILTERS.map((f) => {
      clickButton(f);
      return { filter: f, ...readYearTab() };
    });
    for (const r of rows) {
      expect(r.limitPct, r.filter).toBe("14"); // 1.020 € / 7.236 €
      expect(r.limitHint, r.filter).toBe(true);
    }
    // Darstellungswerte folgen weiterhin dem Filter.
    expect(rows.map((r) => r.yearEarnings)).toEqual([
      "2.674,00 €",
      "594,00 €",
      "480,00 €",
      "1.600,00 €",
    ]);
  });

  it("Bericht-Tab: Kennzahl „Grenze“ gleich bei jedem Filter; Berichtsverdienst gefiltert", () => {
    setData({});
    render();
    openTab(t("stats.tab.report"));
    const rows = FILTERS.map((f) => {
      clickButton(f);
      return { filter: f, ...readReportTab() };
    });
    for (const r of rows) expect(r.limitPct, r.filter).toBe("14");
    expect(new Set(rows.map((r) => r.earnings)).size).toBe(4);
  });

  it("ohne geeigneten Minijob (HB/kurzfristig/selbstständig/Altbestand): 0 % wie bisher", () => {
    setData({
      jobs: [HB, KF, SE, LEGACY],
      shifts: [
        ...SHIFTS_HB,
        work("KF", "2026-07-01", "08:00", "16:00"),
        work("SE", "2026-07-02", "08:00", "16:00"),
        work("LG", "2026-07-03", "08:00", "16:00"),
      ],
    });
    render();
    openTab(t("stats.tab.year"));
    for (const f of [t("stats.allJobs"), "Hauptjob", "Altbestand"]) {
      clickButton(f);
      expect(readYearTab().limitPct, f).toBe("0");
    }
  });
});
