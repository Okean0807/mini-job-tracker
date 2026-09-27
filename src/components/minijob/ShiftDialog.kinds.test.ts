/**
 * Block ART im Eintrags-Editor: alle 6 Arten (Shift.kind) sichtbar, wählbar,
 * korrekt gespeichert, beim erneuten Öffnen markiert, gleiche ID.
 *
 * Regression: Mit `onRequestAbsence` (so bindet das Dashboard den Editor ein)
 * hat ein Tipp auf Urlaub/Krank/Frei/Sonstige im NEUEN Eintrag den Editor
 * geschlossen und durch den Abwesenheits-Dialog (nur 4 Arten, ohne
 * Arbeit/Feiertag) ersetzt – der Block ART war damit weg.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShiftDialog } from "./ShiftDialog";
import { td } from "@/lib/minijob/document-i18n";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
  useAppData,
} from "@/lib/minijob/store";
import { DEFAULT_SETTINGS, type Shift, type ShiftKind } from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = "2026-09-24"; // kein Feiertag
const KINDS: ShiftKind[] = ["arbeit", "urlaub", "krank", "feiertag", "frei", "sonstige"];

let container: HTMLDivElement;
let root: Root;
let closed = 0;
const onRequestAbsence = vi.fn();

function Harness({ shiftId }: { shiftId: string | null }) {
  const data = useAppData();
  const shift = shiftId ? (data.shifts.find((s) => s.id === shiftId) ?? null) : null;
  return createElement(ShiftDialog, {
    open: true,
    onOpenChange: (open: boolean) => {
      if (!open) closed += 1;
    },
    date: DAY,
    shift,
    shiftId,
    jobs: data.jobs,
    customers: data.customers,
    projects: data.projects,
    settings: data.settings,
    objects: data.objects,
    // Wie im Dashboard (routes/index.tsx) eingebunden.
    onRequestAbsence,
  });
}

function open(shiftId: string | null) {
  act(() => root.render(createElement(Harness, { shiftId })));
}
function unmount() {
  act(() => root.render(createElement("div")));
}
function click(el: Element) {
  act(() => (el as HTMLElement).click());
}
function kindGroup() {
  return document.querySelector<HTMLElement>(
    `[data-testid="shift-dialog"] [role="group"][aria-label="${td("label.kind")}"]`,
  );
}
function kindButtons() {
  return [...(kindGroup()?.querySelectorAll<HTMLButtonElement>("button[data-kind]") ?? [])];
}
function kindButton(k: ShiftKind) {
  return kindGroup()!.querySelector<HTMLButtonElement>(`button[data-kind="${k}"]`)!;
}
function pressed() {
  return kindButtons()
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.dataset["kind"]);
}
function save() {
  click(document.querySelector('[data-testid="entry-save"]')!);
}

function clearAppKeys() {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
}

function seed(shifts: Shift[] = []) {
  act(() => {
    replaceAll({
      ...EMPTY_DATA,
      jobs: [{ id: "j1", name: "Reinigung Nord", color: "#0d9488", mode: "flex" }],
      shifts,
      settings: { ...DEFAULT_SETTINGS, onboarded: true, localDemoMode: true },
    } as never);
  });
}

beforeEach(() => {
  clearAppKeys();
  loadFromStorage();
  act(() => activateScope(DEMO_SCOPE));
  seed();
  closed = 0;
  onRequestAbsence.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Block ART – alle 6 Arten", () => {
  it("zeigt genau die 6 Arten aus Shift.kind mit den i18n-Labels", () => {
    open(null);
    expect(kindGroup()).not.toBeNull();
    expect(kindButtons().map((b) => b.dataset["kind"])).toEqual(KINDS);
    expect(kindButtons().map((b) => b.textContent?.trim())).toEqual(
      KINDS.map((k) => td(`kind.${k}`)),
    );
  });

  it.each(KINDS)(
    "%s: neuer Eintrag → wählbar, gespeichert, erneut geöffnet markiert, gleiche ID",
    (k) => {
      open(null);
      click(kindButton(k));
      // Editor bleibt offen, Block bleibt vollständig, Art markiert.
      expect(closed).toBe(0);
      expect(onRequestAbsence).not.toHaveBeenCalled();
      expect(kindButtons()).toHaveLength(6);
      expect(pressed()).toEqual([k]);
      save();
      expect(closed).toBe(1);
      const created = getData().shifts;
      expect(created).toHaveLength(1);
      const id = created[0]!.id;
      expect(created[0]!.kind).toBe(k);
      expect(created[0]!.date).toBe(DAY);

      unmount();
      open(id);
      expect(kindButtons()).toHaveLength(6);
      expect(pressed()).toEqual([k]);
      save();
      const after = getData().shifts;
      expect(after).toHaveLength(1);
      expect(after[0]!.id).toBe(id);
      expect(after[0]!.kind).toBe(k);
    },
  );

  it.each(KINDS)("%s: bestehender Eintrag → Art geladen, markiert, Speichern behält sie", (k) => {
    seed([
      {
        id: `s-${k}`,
        kind: k,
        date: DAY,
        start: "08:00",
        end: "12:00",
        breakMinutes: 0,
        jobId: "j1",
        createdAt: "2026-09-20",
      },
    ]);
    open(`s-${k}`);
    expect(kindButtons().map((b) => b.dataset["kind"])).toEqual(KINDS);
    expect(pressed()).toEqual([k]);
    save();
    const after = getData().shifts;
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(`s-${k}`);
    expect(after[0]!.kind).toBe(k);
  });

  it("Regression: mit onRequestAbsence schließt ein Tipp auf eine Abwesenheitsart den Editor NICHT mehr", () => {
    open(null);
    for (const k of ["urlaub", "krank", "frei", "sonstige"] as const) {
      click(kindButton(k));
      expect(closed).toBe(0);
      expect(onRequestAbsence).not.toHaveBeenCalled();
      expect(kindButtons()).toHaveLength(6);
      expect(pressed()).toEqual([k]);
    }
    // Mehrtägige Abwesenheit bleibt als optionaler Weg erreichbar.
    const range = document.querySelector<HTMLElement>('[data-testid="entry-absence-range"]');
    expect(range).not.toBeNull();
    click(range!);
    expect(onRequestAbsence).toHaveBeenCalledWith("sonstige", DAY);
    expect(closed).toBe(1);
  });

  it("Zeitraum-Link nur bei Abwesenheitsarten im neuen Eintrag", () => {
    open(null);
    expect(document.querySelector('[data-testid="entry-absence-range"]')).toBeNull();
    click(kindButton("feiertag"));
    expect(document.querySelector('[data-testid="entry-absence-range"]')).toBeNull();
    click(kindButton("urlaub"));
    expect(document.querySelector('[data-testid="entry-absence-range"]')).not.toBeNull();
  });
});
