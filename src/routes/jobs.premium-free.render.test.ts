/**
 * R5b: Ohne Premium-Flag kann ein zweiter (und weiterer) Job angelegt werden;
 * keine Premium-/Kauf-Hinweise auf der Jobs-Seite.
 */
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppData } from "@/lib/minijob/types";

const state = vi.hoisted(() => ({ data: null as unknown }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children }: { children?: unknown }) => children,
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/minijob/JobDialog", async () => {
  const { createElement: h } = await import("react");
  return {
    JobDialog: ({ open }: { open: boolean }) =>
      open ? h("div", { "data-testid": "job-dialog-open" }) : null,
  };
});
vi.mock("@/lib/minijob/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/minijob/store")>();
  return { ...actual, useAppData: () => state.data };
});

import { tl } from "@/lib/i18n";
import { B4_JOBS, B4_SETTINGS, MJ_A } from "@/lib/minijob/__fixtures__/stats-legal-limit";
import { Route } from "./jobs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JobsPage = (Route as unknown as { options: { component: ComponentType } }).options.component;
const t = (key: string) => tl("de", key);
const norm = (s: string) => s.replace(/\u00a0/g, " ");

let container: HTMLDivElement;
let root: Root;

function setData(partial: Partial<AppData>) {
  state.data = {
    shifts: [],
    jobs: [],
    customers: [],
    projects: [],
    payments: [],
    orders: [],
    objects: [],
    settings: { ...B4_SETTINGS },
    ...partial,
  };
}

function render() {
  act(() => root.render(createElement(JobsPage)));
}

function addButton(): HTMLButtonElement {
  const btn = [...container.querySelectorAll("button")].find((b) =>
    norm(b.textContent ?? "").includes(t("job.add")),
  );
  if (!btn) throw new Error("Job hinzufügen fehlt");
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  toastMock.error.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Jobs: mehrere Arbeitgeber ohne Premium (v1.0 kostenlos)", () => {
  it.each([
    { label: "premium unset", settings: { ...B4_SETTINGS } },
    { label: "premium false", settings: { ...B4_SETTINGS, premium: false } },
  ])("1 Job vorhanden, $label → zweiter Job kann angelegt werden", ({ settings }) => {
    setData({ jobs: [MJ_A], settings });
    render();
    const btn = addButton();
    expect(norm(btn.textContent ?? "")).not.toMatch(/Premium/i);
    act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="job-dialog-open"]')).not.toBeNull();
  });

  it("bestehende 3 Jobs (Import/Backup) bleiben sichtbar und erweiterbar", () => {
    setData({ jobs: B4_JOBS, settings: { ...B4_SETTINGS, premium: false } });
    render();
    for (const j of B4_JOBS) expect(norm(container.textContent ?? "")).toContain(j.name);
    act(() => addButton().dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="job-dialog-open"]')).not.toBeNull();
    expect(norm(container.textContent ?? "")).not.toMatch(/Premium|kaufen|Abo\b|Upgrade/i);
  });
});
