/**
 * Einheitliche Exportregel in der Statistik: Excel (Monatsliste, Jahresliste, Jahresbericht) nur
 * mit Premium, PDF immer. Geprüft am echten Aufrufort (StatsPage) mit den echten Klick-Handlern.
 *
 * Hinweis: `settings.premium` ist ein lokales Flag – diese Regel ist eine Produktregel der Oberfläche,
 * kein serverseitiger Schutz (die Dateien entstehen im Browser).
 */
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ data: null as unknown }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children }: { children?: unknown }) => children,
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/minijob/annual-export", () => ({
  exportAnnualPdf: vi.fn(),
  exportAnnualXlsx: vi.fn(),
}));
vi.mock("@/lib/minijob/export", () => ({ exportPdf: vi.fn(), exportXlsx: vi.fn() }));
vi.mock("@/lib/minijob/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/minijob/store")>();
  return { ...actual, useAppData: () => state.data };
});

import { tl } from "@/lib/i18n";
import { exportAnnualPdf, exportAnnualXlsx } from "@/lib/minijob/annual-export";
import { exportPdf, exportXlsx } from "@/lib/minijob/export";
import { canExport } from "@/lib/minijob/premium";
import { B4_JOBS, B4_SETTINGS, work } from "@/lib/minijob/__fixtures__/stats-legal-limit";
import { Route } from "./statistik";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const StatsPage = (Route as unknown as { options: { component: ComponentType } }).options.component;
const t = (key: string) => tl("de", key);
const norm = (s: string) => s.replace(/\u00a0/g, " ");

let container: HTMLDivElement;
let root: Root;

function render(premium: boolean) {
  state.data = {
    shifts: [
      work("MA", "2026-10-02", "08:00", "12:00"),
      work("MA", "2026-10-05", "08:00", "12:00"),
    ],
    jobs: B4_JOBS,
    payments: [],
    objects: [],
    settings: { ...B4_SETTINGS, premium },
  };
  act(() => {
    root.render(createElement(StatsPage));
  });
}

function click(label: string) {
  const btn = [...container.querySelectorAll("button")].find(
    (b) => norm(b.textContent ?? "").trim() === label,
  );
  if (!btn) throw new Error(`Button ${label} fehlt`);
  act(() => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function openYear() {
  const tab = [...container.querySelectorAll('[role="tab"]')].find(
    (b) => norm(b.textContent ?? "").trim() === t("stats.tab.year"),
  ) as HTMLElement;
  act(() => {
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    tab.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
}

const LIST_XLSX = t("stats.export.listExcel");
const LIST_PDF = t("stats.export.listPdf");
const ANNUAL_XLSX = `${t("stats.export.annualReport")} Excel`;
const ANNUAL_PDF = `${t("stats.export.annualReport")} PDF`;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 4, 12, 0, 0));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("canExport (reine Regel)", () => {
  it("PDF immer, Excel nur mit Premium", () => {
    expect(canExport({ premium: false }, "pdf")).toBe(true);
    expect(canExport({}, "pdf")).toBe(true);
    expect(canExport({ premium: false }, "xlsx")).toBe(false);
    expect(canExport({}, "xlsx")).toBe(false);
    expect(canExport({ premium: true }, "xlsx")).toBe(true);
  });
});

describe("ohne Premium: jeder Excel-Export blockiert, mit sichtbarem Hinweis; PDF läuft", () => {
  it("Monat: Listen-Excel blockiert, Listen-PDF erlaubt", () => {
    render(false);
    click(LIST_XLSX);
    expect(exportXlsx).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(t("premium.title"), {
      description: t("premium.excel"),
    });
    click(LIST_PDF);
    expect(exportPdf).toHaveBeenCalledTimes(1);
  });

  it("Jahr: Listen-Excel UND Jahresbericht-Excel blockiert, beide PDF erlaubt", () => {
    render(false);
    openYear();
    click(LIST_XLSX);
    click(ANNUAL_XLSX);
    expect(exportXlsx).not.toHaveBeenCalled();
    expect(exportAnnualXlsx).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledTimes(2);
    click(LIST_PDF);
    click(ANNUAL_PDF);
    expect(exportPdf).toHaveBeenCalledTimes(1);
    expect(exportAnnualPdf).toHaveBeenCalledTimes(1);
  });
});

describe("mit Premium: alle Exporte laufen", () => {
  it("Monat und Jahr", () => {
    render(true);
    click(LIST_XLSX);
    expect(exportXlsx).toHaveBeenCalledTimes(1);
    openYear();
    click(LIST_XLSX);
    click(ANNUAL_XLSX);
    expect(exportXlsx).toHaveBeenCalledTimes(2);
    expect(exportAnnualXlsx).toHaveBeenCalledTimes(1);
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});

describe("Statistik zeigt die vier Stundenkennzahlen getrennt", () => {
  it("Monat und Jahr: Beschriftungen und Werte (2 × 4 h gearbeitet, keine Abwesenheit)", () => {
    render(false);
    const monthText = norm(container.textContent ?? "");
    for (const key of ["hours.worked", "hours.paidAbsence", "hours.paidTotal", "hours.soll"]) {
      expect(monthText, key).toContain(t(key));
    }
    expect(monthText).toMatch(new RegExp(`${t("hours.worked")}\\s*8,00 h`.replace(".", "\\.")));
    expect(monthText).toMatch(new RegExp(`${t("hours.paidAbsence")}\\s*0,00 h`));
    expect(monthText).toMatch(new RegExp(`${t("hours.paidTotal")}\\s*8,00 h`));
    openYear();
    expect(norm(container.textContent ?? "")).toContain(t("hours.paidTotal"));
  });
});
