/**
 * Echter Render-Test des Job-Dialogs (react-dom/client + act, happy-dom;
 * Muster: ShiftDialog.render.test.ts) mit ECHTEM Store im Testmodus-Scope.
 * Ersetzt den früheren Regex-auf-Quelltext-Test.
 *
 * - J: Beschäftigungsart wählen → gespeichert
 * - F/G: Bearbeiten erhält employmentType, endDate, archived
 * - Altbestand fest ohne Art: „nicht festgelegt“, kein stilles Minijob
 * - I: nur Arbeitsmodell ändern ändert die Art nicht
 * - selbstständig: Arbeitsmodell und Art bleiben gekoppelt
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JobDialog } from "./JobDialog";
import { t } from "@/lib/i18n";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import { employmentTypeOf } from "@/lib/minijob/legal/employment";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
  useAppData,
} from "@/lib/minijob/store";
import { DEFAULT_SETTINGS, type Job } from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const data = useAppData();
  const job = jobId ? (data.jobs.find((j) => j.id === jobId) ?? null) : null;
  return createElement(JobDialog, {
    open: true,
    onOpenChange: (open: boolean) => {
      if (!open) onClose();
    },
    job,
    defaultRate: 14,
  });
}

let container: HTMLDivElement;
let root: Root;
let closed = 0;

function open(jobId: string | null) {
  act(() => {
    root.render(createElement(Harness, { jobId, onClose: () => (closed += 1) }));
  });
}

function q<T extends Element = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`not found: ${sel}`);
  return el;
}

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
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

const select = () => q<HTMLSelectElement>('[data-testid="job-employment-type"]');
const save = () => click(q('[data-testid="job-save"]'));
const job = (id: string) => getData().jobs.find((j) => j.id === id)!;

function seed(jobs: Job[]) {
  act(() => {
    activateScope(DEMO_SCOPE);
    replaceAll({
      ...EMPTY_DATA,
      jobs,
      settings: { ...DEFAULT_SETTINGS, onboarded: true, localDemoMode: true },
    } as never);
  });
}

function clearAppKeys() {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
}

beforeEach(() => {
  clearAppKeys();
  loadFromStorage();
  closed = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("JobDialog – Beschäftigungsart (Render)", () => {
  it("J: neuer Job – sichtbar Minijob vorbelegt; Hauptbeschäftigung wählen → gespeichert", () => {
    seed([]);
    open(null);
    expect(select().value).toBe("minijob");
    expect(Array.from(select().options).map((o) => o.value)).toEqual([
      "minijob",
      "hauptbeschaeftigung",
      "kurzfristig",
      "selbststaendig",
    ]);
    setValue(q<HTMLInputElement>("#job-name"), "Klinik");
    setValue(select(), "hauptbeschaeftigung");
    save();
    expect(closed).toBe(1);
    const created = getData().jobs;
    expect(created).toHaveLength(1);
    expect(created[0]!.employmentType).toBe("hauptbeschaeftigung");
    expect(created[0]!.mode).toBe("flex");
  });

  it("J: kurzfristige Beschäftigung wählen und erneut öffnen → Wert bleibt", () => {
    seed([{ id: "j1", name: "Messe", color: "#000", mode: "flex", employmentType: "minijob" }]);
    open("j1");
    setValue(select(), "kurzfristig");
    save();
    expect(job("j1").employmentType).toBe("kurzfristig");
    act(() => root.render(createElement("div")));
    open("j1");
    expect(select().value).toBe("kurzfristig");
  });

  it("F/G: Bearbeiten erhält employmentType, endDate und archived", () => {
    seed([
      {
        id: "j1",
        name: "Alt",
        color: "#000",
        mode: "flex",
        employmentType: "kurzfristig",
        endDate: "2026-12-31",
        archived: true,
      },
    ]);
    open("j1");
    expect(select().value).toBe("kurzfristig");
    setValue(q<HTMLInputElement>("#job-name"), "Neu");
    save();
    const saved = job("j1");
    expect(saved.name).toBe("Neu");
    expect(saved.employmentType).toBe("kurzfristig");
    expect(saved.endDate).toBe("2026-12-31");
    expect(saved.archived).toBe(true);
  });

  it("Altbestand fest ohne Art: „nicht festgelegt“ + Hinweis, Speichern ohne Wahl lässt ihn ungeklärt", () => {
    seed([{ id: "j1", name: "Alt-Fest", color: "#000", mode: "fest" }]);
    open("j1");
    expect(select().value).toBe("");
    expect(q('[data-testid="job-employment-type-hint"]').textContent).toBe(
      t("job.employmentTypeHintUnknown"),
    );
    setValue(q<HTMLInputElement>("#job-name"), "Alt-Fest 2");
    save();
    expect(job("j1").employmentType).toBeUndefined();
    expect(employmentTypeOf(job("j1"))).toBe("unknown");
  });

  it("Altbestand fest ohne Art: explizit Minijob wählen → gespeichert, nicht mehr ungeklärt", () => {
    seed([{ id: "j1", name: "Alt-Fest", color: "#000", mode: "fest" }]);
    open("j1");
    setValue(select(), "minijob");
    save();
    expect(job("j1").employmentType).toBe("minijob");
    expect(employmentTypeOf(job("j1"))).toBe("minijob");
  });

  it("I: nur das Arbeitsmodell ändern lässt eine explizite Art unverändert", () => {
    seed([
      {
        id: "j1",
        name: "Haupt",
        color: "#000",
        mode: "flex",
        employmentType: "hauptbeschaeftigung",
      },
    ]);
    open("j1");
    click(q('[data-testid="job-mode-fest"]'));
    save();
    expect(job("j1").mode).toBe("fest");
    expect(job("j1").employmentType).toBe("hauptbeschaeftigung");
  });

  it("I: Altbestand ohne Art – Moduswechsel ohne Wahl wird nicht gespeichert (kein stiller Statuswechsel)", () => {
    seed([{ id: "j1", name: "Alt-Flex", color: "#000", mode: "flex" }]);
    open("j1");
    click(q('[data-testid="job-mode-fest"]'));
    save();
    expect(closed).toBe(0);
    expect(job("j1").mode).toBe("flex");
    expect(job("j1").employmentType).toBeUndefined();
    setValue(select(), "minijob");
    save();
    expect(job("j1").mode).toBe("fest");
    expect(job("j1").employmentType).toBe("minijob");
  });

  it("selbstständig: Arbeitsmodell setzt die Art (Auswahl gesperrt); Art „selbstständig“ setzt das Modell", () => {
    seed([{ id: "j1", name: "Projekt", color: "#000", mode: "flex", employmentType: "minijob" }]);
    open("j1");
    click(q('[data-testid="job-mode-selbststaendig"]'));
    expect(select().value).toBe("selbststaendig");
    expect(select().disabled).toBe(true);
    save();
    expect(job("j1").mode).toBe("selbststaendig");
    expect(job("j1").employmentType).toBe("selbststaendig");

    seed([{ id: "j2", name: "Freelance", color: "#000", mode: "flex", employmentType: "minijob" }]);
    act(() => root.render(createElement("div")));
    open("j2");
    setValue(select(), "selbststaendig");
    save();
    expect(job("j2").mode).toBe("selbststaendig");
    expect(job("j2").employmentType).toBe("selbststaendig");
  });
  it("B: Hauptbeschäftigung → selbstständig → flexibel → speichern behält hauptbeschaeftigung", () => {
    seed([
      {
        id: "j1",
        name: "Haupt",
        color: "#000",
        mode: "flex",
        employmentType: "hauptbeschaeftigung",
      },
    ]);
    open("j1");
    click(q('[data-testid="job-mode-selbststaendig"]'));
    expect(select().value).toBe("selbststaendig");
    click(q('[data-testid="job-mode-flex"]'));
    expect(select().value).toBe("hauptbeschaeftigung");
    save();
    expect(job("j1").mode).toBe("flex");
    expect(job("j1").employmentType).toBe("hauptbeschaeftigung");
    expect(employmentTypeOf(job("j1"))).toBe("hauptbeschaeftigung");
  });

  it("B: kurzfristig + fest → selbstständig → fest → speichern behält kurzfristig", () => {
    seed([{ id: "j1", name: "Messe", color: "#000", mode: "fest", employmentType: "kurzfristig" }]);
    open("j1");
    click(q('[data-testid="job-mode-selbststaendig"]'));
    click(q('[data-testid="job-mode-fest"]'));
    expect(select().value).toBe("kurzfristig");
    save();
    expect(job("j1").mode).toBe("fest");
    expect(job("j1").employmentType).toBe("kurzfristig");
  });

  it("gespeicherte Art wird nie still entfernt (flex + selbstständig → Rundreise → Speichern blockiert)", () => {
    seed([
      { id: "j1", name: "Frei", color: "#000", mode: "flex", employmentType: "selbststaendig" },
    ]);
    open("j1");
    click(q('[data-testid="job-mode-selbststaendig"]'));
    click(q('[data-testid="job-mode-flex"]'));
    expect(select().value).toBe("");
    save();
    expect(closed).toBe(0);
    expect(job("j1").employmentType).toBe("selbststaendig");
  });

  it("D6: neuer Job selbstständig → flexibel → Speichern verlangt eine Beschäftigungsart", () => {
    seed([]);
    open(null);
    setValue(q<HTMLInputElement>("#job-name"), "Neu");
    click(q('[data-testid="job-mode-selbststaendig"]'));
    click(q('[data-testid="job-mode-flex"]'));
    expect(select().value).toBe("");
    save();
    expect(closed).toBe(0);
    expect(getData().jobs).toHaveLength(0);
    setValue(select(), "minijob");
    save();
    expect(getData().jobs).toHaveLength(1);
    expect(getData().jobs[0]!.employmentType).toBe("minijob");
  });
});
