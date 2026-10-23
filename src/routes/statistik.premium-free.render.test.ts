/**
 * R5b: Excel-Liste (XLSX-Export) funktioniert ohne Premium; kein Premium-Toast.
 * (Betrifft nur den Export — der deaktivierte XLSX-Import bleibt unverändert.)
 */
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ data: null as unknown }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const exportMock = vi.hoisted(() => ({ exportXlsx: vi.fn(), exportPdf: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children }: { children?: unknown }) => children,
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/minijob/annual-export", () => ({
  exportAnnualPdf: vi.fn(),
  exportAnnualXlsx: vi.fn(),
}));
vi.mock("@/lib/minijob/export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/minijob/export")>();
  return { ...actual, exportXlsx: exportMock.exportXlsx, exportPdf: exportMock.exportPdf };
});
vi.mock("@/lib/minijob/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/minijob/store")>();
  return { ...actual, useAppData: () => state.data };
});

import { tl } from "@/lib/i18n";
import { B4_JOBS, B4_SETTINGS, B4_SHIFTS } from "@/lib/minijob/__fixtures__/stats-legal-limit";
import { Route } from "./statistik";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const StatsPage = (Route as unknown as { options: { component: ComponentType } }).options.component;
const t = (key: string) => tl("de", key);
const norm = (s: string) => s.replace(/\u00a0/g, " ");

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 15, 12, 0, 0));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  toastMock.error.mockClear();
  exportMock.exportXlsx.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Statistik: Excel-Export ohne Premium (v1.0 kostenlos)", () => {
  it.each([undefined, false])(
    "premium=%s → Excel-Liste exportiert, kein Premium-Hinweis",
    (premium) => {
      state.data = {
        shifts: B4_SHIFTS,
        jobs: B4_JOBS,
        payments: [],
        objects: [],
        settings: { ...B4_SETTINGS, premium },
      };
      act(() => root.render(createElement(StatsPage)));
      const btn = [...container.querySelectorAll("button")].find(
        (b) => norm(b.textContent ?? "").trim() === t("stats.export.listExcel"),
      );
      if (!btn) throw new Error("Excel-Liste fehlt");
      act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(exportMock.exportXlsx).toHaveBeenCalledTimes(1);
      expect(toastMock.error).not.toHaveBeenCalled();
      expect(toastMock.success).toHaveBeenCalledWith(t("stats.toast.exportSuccess"));
    },
  );
});
