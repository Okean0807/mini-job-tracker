/**
 * Gemeinsame Render-Hilfen für die Smart-Eintrag-Tests (react-dom + act, happy-dom, ECHTER
 * Store im Demo-Scope). Nur für Tests; keine neue Dependency.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { ShiftDialog } from "./ShiftDialog";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  loadFromStorage,
  replaceAll,
  useAppData,
} from "@/lib/minijob/store";
import {
  DEFAULT_SETTINGS,
  type Job,
  type Settings,
  type Shift,
  type WorkObject,
} from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const DAY = "2026-09-24";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
export const closed = { count: 0 };

function Harness({ shiftId, date }: { shiftId: string | null; date: string }) {
  const data = useAppData();
  const shift = shiftId ? (data.shifts.find((s) => s.id === shiftId) ?? null) : null;
  return createElement(ShiftDialog, {
    open: true,
    onOpenChange: (open: boolean) => {
      if (!open) closed.count += 1;
    },
    date,
    shift,
    shiftId,
    jobs: data.jobs,
    customers: data.customers,
    projects: data.projects,
    settings: data.settings,
    objects: data.objects,
  });
}

export function setup(
  data: {
    jobs?: Job[];
    shifts?: Shift[];
    objects?: WorkObject[];
    settings?: Partial<Settings>;
  } = {},
) {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
  loadFromStorage();
  act(() => {
    activateScope(DEMO_SCOPE);
    replaceAll({
      ...EMPTY_DATA,
      jobs: data.jobs ?? [{ id: "j1", name: "Reinigung Nord", color: "#0d9488", mode: "flex" }],
      objects: data.objects ?? [],
      shifts: data.shifts ?? [],
      settings: { ...DEFAULT_SETTINGS, onboarded: true, localDemoMode: true, ...data.settings },
    } as never);
  });
  closed.count = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
}

export function teardown() {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
}

export function open(shiftId: string | null = null, date: string = DAY) {
  act(() => {
    root!.render(createElement(Harness, { shiftId, date }));
  });
}

export function unmount() {
  act(() => root!.render(createElement("div")));
}

export function q<T extends Element = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`not found: ${sel}`);
  return el;
}

export function has(sel: string): boolean {
  return document.querySelector(sel) !== null;
}

export function setValue(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}

export function click(el: Element) {
  act(() => {
    (el as HTMLElement).click();
  });
}

export function save() {
  click(q('[data-testid="entry-save"]'));
}

export function work(partial: Partial<Shift> & { id: string; start: string; end: string }): Shift {
  return {
    kind: "arbeit",
    date: "2026-09-20",
    breakMinutes: 30,
    jobId: "j1",
    createdAt: "2026-09-20",
    ...partial,
  };
}
