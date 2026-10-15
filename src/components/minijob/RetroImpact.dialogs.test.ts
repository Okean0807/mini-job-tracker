/**
 * D3 (Owner R4): Rückwirkende Änderungen in Eintrags- und Abwesenheits-Dialog.
 * Echter Render + echter Store (Testmodus). Abbrechen speichert nichts
 * (auch nach "Neustart" = erneutem Laden unverändert), Bestätigen speichert.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsenceDialog } from "./AbsenceDialog";
import { RetroImpactDialog } from "./RetroImpactDialog";
import { ShiftDialog } from "./ShiftDialog";
import { tl } from "@/lib/i18n";
import { formatEuro, isoDate } from "@/lib/minijob/calc";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
  useAppData,
} from "@/lib/minijob/store";
import { DEFAULT_SETTINGS, type Job, type Shift } from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const day = { start: "09:00", end: "14:00", breakMinutes: 0 };
const JOB = {
  id: "j1",
  name: "Büro",
  color: "#0d9488",
  mode: "fest",
  employmentType: "minijob",
  rate: 15,
  startDate: "2025-01-01",
  week: [true, true, true, true, true, false, false].map((active) => ({ active, ...day })),
} as unknown as Job;

function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");
  for (; d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() >= 1 && d.getDay() <= 5) out.push(isoDate(d));
  }
  return out;
}
/** Neu erfasste Kette 19.10.–31.12. (Mo–Fr): ab Tag 43 automatisch unbezahlt. */
const CHAIN: Shift[] = weekdays("2026-10-19", "2026-12-31").map(
  (date) =>
    ({
      id: `k-${date}`,
      jobId: "j1",
      kind: "krank",
      date,
      ...day,
      sickRule: "continuous",
      createdAt: "2026-12-31",
    }) as Shift,
);

let container: HTMLDivElement;
let root: Root;
let closed = 0;

function clearAppKeys() {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const tid = (id: string) => q(`[data-testid="${id}"]`);
function click(el: Element | null) {
  if (!el) throw new Error("element missing");
  act(() => (el as HTMLElement).click());
}
function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function reload() {
  act(() => {
    loadFromStorage();
    activateScope(DEMO_SCOPE);
  });
}

beforeEach(() => {
  clearAppKeys();
  loadFromStorage();
  act(() => {
    activateScope(DEMO_SCOPE);
    replaceAll({
      ...EMPTY_DATA,
      jobs: [JOB],
      shifts: CHAIN,
      settings: { ...DEFAULT_SETTINGS, onboarded: true, localDemoMode: true },
    } as never);
  });
  closed = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function ShiftHarness({ shiftId }: { shiftId: string }) {
  const data = useAppData();
  return createElement(ShiftDialog, {
    open: true,
    onOpenChange: (open: boolean) => {
      if (!open) closed += 1;
    },
    date: "2026-10-19",
    shift: data.shifts.find((s) => s.id === shiftId) ?? null,
    shiftId,
    jobs: data.jobs,
    customers: data.customers,
    projects: data.projects,
    settings: data.settings,
    objects: data.objects,
  });
}

function AbsenceHarness({ seedId }: { seedId: string }) {
  const data = useAppData();
  return createElement(AbsenceDialog, {
    open: true,
    onOpenChange: (open: boolean) => {
      if (!open) closed += 1;
    },
    jobs: data.jobs,
    shifts: data.shifts,
    seed: data.shifts.find((s) => s.id === seedId) ?? null,
  });
}

describe("RetroImpactDialog", () => {
  it("zeigt Monate mit Vorher/Nachher, aufgehobene Bestätigungen; Abbrechen/Bestätigen", () => {
    let confirmed = 0;
    let cancelled = 0;
    act(() =>
      root.render(
        createElement(RetroImpactDialog, {
          impact: {
            months: [
              { month: "2026-11", before: 300, after: 0 },
              { month: "2026-12", before: 0, after: 0 },
            ],
            lapsedMonths: ["2026-12"],
          },
          onConfirm: () => (confirmed += 1),
          onCancel: () => (cancelled += 1),
        }),
      ),
    );
    const rows = document.querySelectorAll('[data-testid="retro-impact-row"]');
    expect([...rows].map((r) => r.getAttribute("data-month"))).toEqual(["2026-11", "2026-12"]);
    expect(rows[0]!.textContent).toContain(
      tl("de", "retro.row", { before: formatEuro(300), after: formatEuro(0) }),
    );
    expect(tid("retro-impact-lapsed")).not.toBeNull();
    click(tid("retro-impact-cancel"));
    expect(cancelled).toBe(1);
    expect(confirmed).toBe(0);
    click(tid("retro-impact-confirm"));
    expect(confirmed).toBe(1);
    expect(cancelled).toBe(1); // Bestätigen löst kein Abbrechen aus
  });

  it("impact = null → nichts sichtbar", () => {
    act(() =>
      root.render(
        createElement(RetroImpactDialog, { impact: null, onConfirm: () => {}, onCancel: () => {} }),
      ),
    );
    expect(tid("retro-impact-dialog")).toBeNull();
  });
});

describe("ShiftDialog: rückwirkendes Löschen", () => {
  it("Abbrechen → nichts gelöscht (auch nach Neuladen); Bestätigen → gelöscht", () => {
    const before = JSON.stringify(getData().shifts);
    act(() => root.render(createElement(ShiftHarness, { shiftId: "k-2026-10-19" })));
    click(tid("entry-delete"));
    expect(tid("retro-impact-dialog")).not.toBeNull();
    const months = [...document.querySelectorAll('[data-testid="retro-impact-row"]')].map((r) =>
      r.getAttribute("data-month"),
    );
    expect(months).toEqual(["2026-11"]);
    click(tid("retro-impact-cancel"));
    expect(tid("retro-impact-dialog")).toBeNull();
    expect(JSON.stringify(getData().shifts)).toBe(before);
    expect(closed).toBe(0);
    reload();
    expect(JSON.stringify(getData().shifts)).toBe(before);

    act(() => root.render(createElement(ShiftHarness, { shiftId: "k-2026-10-19" })));
    click(tid("entry-delete"));
    click(tid("retro-impact-confirm"));
    expect(getData().shifts.some((s) => s.id === "k-2026-10-19")).toBe(false);
    expect(getData().shifts).toHaveLength(CHAIN.length - 1);
    expect(closed).toBe(1);
  });

  it("Löschen ohne Wirkung auf andere Einträge → ohne Rückfrage", () => {
    act(() => root.render(createElement(ShiftHarness, { shiftId: "k-2026-12-31" })));
    click(tid("entry-delete"));
    expect(tid("retro-impact-dialog")).toBeNull();
    expect(getData().shifts.some((s) => s.id === "k-2026-12-31")).toBe(false);
    expect(closed).toBe(1);
  });
});

describe("AbsenceDialog: rückwirkender Zeitraum", () => {
  it("Zeitraum löschen: Abbrechen ändert nichts, Bestätigen löscht in einem Schritt", () => {
    const before = JSON.stringify(getData().shifts);
    act(() => root.render(createElement(AbsenceHarness, { seedId: "k-2026-10-19" })));
    setValue(q("#absence-from") as HTMLInputElement, "2026-10-19");
    setValue(q("#absence-to") as HTMLInputElement, "2026-10-23");
    click(tid("absence-remove"));
    expect(tid("retro-impact-dialog")).not.toBeNull();
    expect(
      [...document.querySelectorAll('[data-testid="retro-impact-row"]')].map((r) =>
        r.getAttribute("data-month"),
      ),
    ).toEqual(["2026-11", "2026-12"]);
    click(tid("retro-impact-cancel"));
    expect(JSON.stringify(getData().shifts)).toBe(before);
    expect(closed).toBe(0);

    click(tid("absence-remove"));
    click(tid("retro-impact-confirm"));
    expect(getData().shifts).toHaveLength(CHAIN.length - 5);
    expect(getData().shifts.some((s) => s.date <= "2026-10-23")).toBe(false);
    expect(closed).toBe(1);
  });
});
