/**
 * Echter Render-Test des Eintrags-Editors (react-dom/client + act, happy-dom;
 * keine neue Dependency) mit ECHTEM Store im Testmodus-Scope:
 * - bestehende Schicht bearbeiten → gleiche ID, keine Duplikate
 * - zweiter Eintrag am selben Tag → beide unabhängig
 * - Objekt / Leistungsart / Tätigkeit wählen, speichern, erneut öffnen → Werte erhalten
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ShiftDialog } from "./ShiftDialog";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
  useAppData,
} from "@/lib/minijob/store";
import { DEFAULT_SETTINGS, type Shift } from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = "2026-09-24";

function Harness({ shiftId, onClose }: { shiftId: string | null; onClose: () => void }) {
  const data = useAppData();
  const shift = shiftId ? (data.shifts.find((s) => s.id === shiftId) ?? null) : null;
  return createElement(ShiftDialog, {
    open: true,
    onOpenChange: (open: boolean) => {
      if (!open) onClose();
    },
    date: DAY,
    shift,
    shiftId,
    jobs: data.jobs,
    customers: data.customers,
    projects: data.projects,
    settings: data.settings,
    objects: data.objects,
  });
}

let container: HTMLDivElement;
let root: Root;
let closed = 0;

function open(shiftId: string | null) {
  act(() => {
    root.render(createElement(Harness, { shiftId, onClose: () => (closed += 1) }));
  });
}

function q<T extends Element = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`not found: ${sel}`);
  return el;
}

function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
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

function click(el: Element) {
  act(() => {
    (el as HTMLElement).click();
  });
}

function save() {
  click(q('[data-testid="entry-save"]'));
}

function unmount() {
  act(() => root.render(createElement("div")));
}

const existing: Shift = {
  id: "shift-a",
  kind: "arbeit",
  date: DAY,
  start: "08:00",
  end: "12:00",
  breakMinutes: 0,
  jobId: "j1",
  createdAt: "2026-09-20",
};

function clearAppKeys() {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
}

beforeEach(() => {
  clearAppKeys();
  loadFromStorage();
  act(() => {
    activateScope(DEMO_SCOPE);
    replaceAll({
      ...EMPTY_DATA,
      jobs: [{ id: "j1", name: "Reinigung Nord", color: "#0d9488", mode: "flex" }],
      objects: [
        {
          id: "obj-1",
          name: "Bürohaus Mitte",
          street: "Hauptstraße",
          houseNo: "5",
          zip: "10115",
          city: "Berlin",
          createdAt: "2026-09-01",
          updatedAt: "2026-09-01",
        },
      ],
      shifts: [existing],
      settings: {
        ...DEFAULT_SETTINGS,
        onboarded: true,
        localDemoMode: true,
        workCodes: [{ code: "GL", label: "Glasreinigung" }],
        customTasks: ["Dachfenster reinigen"],
      },
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

describe("Eintrags-Editor (Render)", () => {
  it("bestehende Schicht öffnen, ändern, speichern → gleiche ID, kein Duplikat", () => {
    open("shift-a");
    expect(q<HTMLInputElement>("#von").value).toBe("08:00");
    setValue(q<HTMLInputElement>("#von"), "09:30");
    save();
    expect(closed).toBe(1);
    const shifts = getData().shifts;
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.id).toBe("shift-a");
    expect(shifts[0]!.start).toBe("09:30");
    expect(shifts[0]!.createdAt).toBe("2026-09-20");
  });

  it("zweiter Eintrag am selben Tag → neue ID, bestehender Eintrag unverändert", () => {
    const before = JSON.stringify(getData().shifts[0]);
    open(null);
    setValue(q<HTMLInputElement>("#von"), "14:00");
    setValue(q<HTMLInputElement>("#bis"), "16:00");
    save();
    const shifts = getData().shifts.filter((s) => s.date === DAY);
    expect(shifts).toHaveLength(2);
    const added = shifts.find((s) => s.id !== "shift-a")!;
    expect(added.id).toBeTruthy();
    expect(added.start).toBe("14:00");
    expect(JSON.stringify(getData().shifts.find((s) => s.id === "shift-a"))).toBe(before);

    // Den zweiten erneut bearbeiten → bleibt bei seiner ID, der erste unberührt.
    unmount();
    open(added.id);
    setValue(q<HTMLInputElement>("#bis"), "17:00");
    save();
    const after = getData().shifts.filter((s) => s.date === DAY);
    expect(after).toHaveLength(2);
    expect(after.find((s) => s.id === added.id)!.end).toBe("17:00");
    expect(JSON.stringify(after.find((s) => s.id === "shift-a"))).toBe(before);
  });

  it("Objekt, gespeicherte Leistungsart und Tätigkeit wählen → speichern → erneut öffnen: Werte erhalten", () => {
    open("shift-a");
    setValue(q<HTMLSelectElement>('[data-testid="object-select"]'), "obj-1");
    setValue(q<HTMLSelectElement>('[data-testid="work-code-select"]'), "GL");
    setValue(q<HTMLSelectElement>('[data-testid="task-select"]'), "Dachfenster reinigen");
    save();
    const saved = getData().shifts.find((s) => s.id === "shift-a")!;
    expect(getData().shifts).toHaveLength(1);
    expect(saved.objectId).toBe("obj-1");
    expect(saved.street).toBe("Hauptstraße");
    expect(saved.workCode).toBe("GL");
    expect(saved.workCodeLabel).toBe("Glasreinigung");
    expect(saved.tasks).toContain("Dachfenster reinigen");

    unmount();
    open("shift-a");
    expect(q<HTMLSelectElement>('[data-testid="object-select"]').value).toBe("obj-1");
    expect(q<HTMLSelectElement>('[data-testid="work-code-select"]').value).toBe("GL");
    expect(q('[data-testid="entry-tasks"]').getAttribute("data-task-count")).toBe("1");
    expect(q('[data-testid="entry-tasks"]').textContent).toContain("Dachfenster reinigen");
    // Unverändert erneut speichern → nichts geht verloren, keine Duplikate.
    save();
    const again = getData().shifts.find((s) => s.id === "shift-a")!;
    expect(getData().shifts).toHaveLength(1);
    expect(again.objectId).toBe("obj-1");
    expect(again.workCode).toBe("GL");
    expect(again.tasks).toEqual(saved.tasks);
  });

  it("neue Leistungsart + neue Tätigkeit im Editor → im Katalog des aktiven Scopes (settings), kein eigener Key", () => {
    open(null);
    click(
      [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Neue Leistungsart"),
      )!,
    );
    setValue(q<HTMLInputElement>('[data-testid="work-code-input"]'), "FS");
    setValue(q<HTMLInputElement>('[data-testid="work-code-label-input"]'), "Fassadenschutz");
    click(
      [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Neue Tätigkeit"),
      )!,
    );
    setValue(q<HTMLInputElement>('[data-testid="custom-task-input"]'), "Rinne säubern");
    save();
    const data = getData();
    expect(data.settings.workCodes).toEqual(
      expect.arrayContaining([{ code: "FS", label: "Fassadenschutz" }]),
    );
    expect(data.settings.customTasks).toEqual(expect.arrayContaining(["Rinne säubern"]));
    const keys = Object.keys(window.localStorage).filter((k) => k.startsWith("minijob-"));
    expect(keys.every((k) => k === "minijob-active-scope-v1" || k.includes(":"))).toBe(true);
    expect(window.localStorage.getItem("minijob-tracker-v1:demo")).toContain("Fassadenschutz");
    expect(window.localStorage.getItem("minijob-tracker-v1:guest") ?? "").not.toContain(
      "Fassadenschutz",
    );
  });
});
