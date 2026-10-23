/**
 * R6 proposed compat: legacy settings.premium (true/false/unset) loads, is
 * preserved verbatim in local storage, JSON backup and cloud payload, and has
 * no effect: all Excel exports (month list, year list, annual report) work.
 */
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ data: null as unknown }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), message: vi.fn() }));
const exportMock = vi.hoisted(() => ({ exportXlsx: vi.fn(), exportPdf: vi.fn() }));
const annualMock = vi.hoisted(() => ({ exportAnnualPdf: vi.fn(), exportAnnualXlsx: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children }: { children?: unknown }) => children,
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/minijob/annual-export", () => annualMock);
vi.mock("@/lib/minijob/export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/minijob/export")>();
  return { ...actual, exportXlsx: exportMock.exportXlsx, exportPdf: exportMock.exportPdf };
});
vi.mock("@/lib/minijob/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/minijob/store")>();
  return { ...actual, useAppData: () => state.data };
});

import { tl } from "@/lib/i18n";
import { stripDeviceAuthForCloud } from "@/lib/minijob/device-auth";
import { canAddJob, canUse, type PremiumFeature } from "@/lib/minijob/premium";
import { B4_JOBS, B4_SETTINGS, B4_SHIFTS } from "@/lib/minijob/__fixtures__/stats-legal-limit";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
} from "@/lib/minijob/store";
import { Route } from "./statistik";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const StatsPage = (Route as unknown as { options: { component: ComponentType } }).options.component;
const t = (key: string) => tl("de", key);
const norm = (s: string) =>
  s
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const FEATURES: PremiumFeature[] = [
  "multiJob",
  "ai",
  "cloud",
  "excel",
  "advancedReports",
  "forecast",
];

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 15, 12, 0, 0));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  toastMock.error.mockClear();
  toastMock.success.mockClear();
  exportMock.exportXlsx.mockClear();
  annualMock.exportAnnualXlsx.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function click(label: string) {
  const btn = [...container.querySelectorAll("button")].find(
    (b) => norm(b.textContent ?? "") === label,
  );
  if (!btn) throw new Error(`Button ${label} fehlt`);
  act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function openTab(label: string) {
  const tab = [...container.querySelectorAll('[role="tab"]')].find(
    (b) => norm(b.textContent ?? "") === label,
  ) as HTMLElement | undefined;
  if (!tab) throw new Error(`Tab ${label} fehlt`);
  act(() => {
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    tab.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
  expect(tab.getAttribute("aria-selected")).toBe("true");
}

describe("legacy settings.premium is loaded, preserved and inert", () => {
  it.each([true, false])(
    "premium=%s survives storage, JSON backup and cloud payload",
    (premium) => {
      loadFromStorage();
      act(() => activateScope(DEMO_SCOPE));
      act(() => {
        replaceAll({
          ...EMPTY_DATA,
          jobs: B4_JOBS,
          settings: { ...B4_SETTINGS, premium },
        } as never);
      });
      const data = getData();
      expect(data.settings.premium).toBe(premium);
      expect(data.jobs).toHaveLength(B4_JOBS.length);
      const raw = Object.keys(window.localStorage)
        .filter((k) => k.startsWith("minijob-tracker-v1"))
        .map((k) => JSON.parse(window.localStorage.getItem(k) ?? "null"))
        .find((v) => v && typeof v === "object" && "settings" in v);
      expect(raw?.settings?.premium).toBe(premium);
      expect(JSON.parse(JSON.stringify(data)).settings.premium).toBe(premium);
      expect(stripDeviceAuthForCloud(data).settings.premium).toBe(premium);
      for (const f of FEATURES) expect(canUse(data.settings, f)).toBe(true);
      expect(canAddJob(data.settings, data.jobs.length)).toBe(true);
    },
  );
});

describe("Excel exports consistent (month list, year list, annual report)", () => {
  it.each([undefined, false, true])("premium=%s → all three Excel exports run", (premium) => {
    state.data = {
      shifts: B4_SHIFTS,
      jobs: B4_JOBS,
      payments: [],
      objects: [],
      settings: { ...B4_SETTINGS, premium },
    };
    act(() => root.render(createElement(StatsPage)));
    click(t("stats.export.listExcel"));
    expect(exportMock.exportXlsx).toHaveBeenCalledTimes(1);
    openTab(t("stats.tab.year"));
    click(t("stats.export.listExcel"));
    expect(exportMock.exportXlsx).toHaveBeenCalledTimes(2);
    click(`${t("stats.export.annualReport")} Excel`);
    expect(annualMock.exportAnnualXlsx).toHaveBeenCalledTimes(1);
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(norm(container.textContent ?? "")).not.toMatch(/Premium/);
  });
});
