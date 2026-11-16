/**
 * B5 – "Speichern & Neuer Eintrag": ein Eintrag, Dialog bleibt offen, neuer Eintrag mit Anschluss
 * (A1) und leerem Ende, nichts Eintragsspezifisches wird kopiert; Fehlerfälle behalten das Formular;
 * Doppeltippen verdoppelt nichts; "Speichern" schließt weiterhin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shiftHours } from "@/lib/minijob/calc";
import { getData, isPersistFailed } from "@/lib/minijob/store";
import type { WorkObject } from "@/lib/minijob/types";
import { click, closed, has, open, q, save, setValue, setup, teardown } from "./entry-test-harness";

const JOBS = [
  { id: "j1", name: "Reinigung Nord", color: "#0d9488", mode: "flex" as const },
  { id: "j2", name: "Lager Süd", color: "#2563eb", mode: "flex" as const },
];
const OBJECTS: WorkObject[] = [
  {
    id: "o1",
    name: "Bürohaus Mitte",
    street: "Hauptstraße",
    houseNo: "5",
    zip: "10115",
    city: "Berlin",
  },
];

beforeEach(() =>
  setup({
    jobs: JOBS,
    objects: OBJECTS,
    settings: {
      workCodes: [{ code: "GL", label: "Glasreinigung" }],
      customTasks: ["Dachfenster reinigen"],
    },
  }),
);
afterEach(() => {
  vi.restoreAllMocks();
  teardown();
});

const start = () => q<HTMLInputElement>("#von");
const end = () => q<HTMLInputElement>("#bis");
const saveNew = () => click(q('[data-testid="entry-save-new"]'));
const shifts = () => getData().shifts;

function fillFirst(s = "08:00", e = "12:00") {
  setValue(start(), s);
  setValue(end(), e);
}

describe("B5 Speichern & Neuer Eintrag – Erfolg", () => {
  it("speichert genau einen Eintrag, der Dialog bleibt offen", () => {
    open(null);
    fillFirst();
    saveNew();
    expect(shifts()).toHaveLength(1);
    expect(shifts()[0]).toMatchObject({ start: "08:00", end: "12:00", date: "2026-09-24" });
    expect(closed.count).toBe(0);
    expect(has('[data-testid="entry-save"]')).toBe(true);
  });

  it("der neue Eintrag schließt an das Ende an, das Ende bleibt leer, es gibt noch keinen neuen Eintrag", () => {
    open(null);
    fillFirst("08:00", "12:00");
    saveNew();
    expect(start().value).toBe("12:00");
    expect(end().value).toBe("");
    expect(q('[data-testid="entry-duration"]').textContent).toBe("–");
    expect(shifts()).toHaveLength(1); // keine neue Id, bevor wirklich gespeichert wird
  });

  it("kopiert nichts Eintragsspezifisches: Objekt, Leistungsart, Tätigkeit, Notiz, Überstunden, Lohn, Pause", () => {
    open(null);
    fillFirst();
    click(q('[data-testid="object-picker-trigger"]'));
    click(q('[data-testid="object-option-o1"]'));
    setValue(q<HTMLSelectElement>('[data-testid="work-code-select"]'), "GL");
    setValue(q<HTMLSelectElement>('[data-testid="task-select"]'), "Dachfenster reinigen");
    setValue(q<HTMLInputElement>("#pause"), "45");
    click(q('[data-testid="entry-more-toggle"]'));
    setValue(q<HTMLTextAreaElement>("#notiz"), "Schlüssel beim Hausmeister");
    click(q('[role="switch"]'));
    const defaultRate = q<HTMLInputElement>("#lohn").value;
    setValue(q<HTMLInputElement>("#lohn"), "17,50");
    saveNew();

    const saved = shifts()[0]!;
    expect(saved).toMatchObject({
      objectId: "o1",
      workCode: "GL",
      breakMinutes: 45,
      note: "Schlüssel beim Hausmeister",
      overtime: true,
    });
    expect(saved.tasks).toContain("Dachfenster reinigen");

    // neuer Eintrag: alles zurück auf den Stand eines frisch geöffneten Eintrags
    expect(q('[data-testid="entry-object"]').getAttribute("data-object")).toBe("empty");
    expect(q('[data-testid="entry-work-code"]').getAttribute("data-code")).toBe("empty");
    expect(q('[data-testid="entry-tasks"]').getAttribute("data-task-count")).toBe("0");
    expect(q<HTMLInputElement>("#pause").value).toBe("30");
    expect(q<HTMLInputElement>("#lohn").value).toBe(defaultRate);
    if (!has("#notiz")) click(q('[data-testid="entry-more-toggle"]'));
    expect(q<HTMLTextAreaElement>("#notiz").value).toBe("");
    expect(q('[role="switch"]').getAttribute("aria-checked")).toBe("false");
  });

  it("behält Tag und Job (Kontext); der Job-Chip bleibt gewählt", () => {
    open(null);
    click(
      [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Lager Süd"))!,
    );
    fillFirst();
    saveNew();
    expect(shifts()[0]!.jobId).toBe("j2");
    const jobChip = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Lager Süd"),
    )!;
    expect(jobChip.getAttribute("aria-pressed")).toBe("true");
    expect(q<HTMLInputElement>('[data-testid="entry-date"]').value).toBe("2026-09-24");
  });

  it("der zweite Eintrag wird mit eigener Id gespeichert; beide bleiben unverändert", () => {
    open(null);
    fillFirst("08:00", "12:00");
    saveNew();
    setValue(end(), "15:00"); // Beginn 12:00 vom Anschluss
    saveNew();
    expect(shifts()).toHaveLength(2);
    const [a, b] = [...shifts()].sort((x, y) => x.start.localeCompare(y.start));
    expect(a).toMatchObject({ start: "08:00", end: "12:00" });
    expect(b).toMatchObject({ start: "12:00", end: "15:00" });
    expect(a!.id).not.toBe(b!.id);
    expect(start().value).toBe("15:00");
  });

  it("B2 Pause und B4 Dauer funktionieren im neuen Eintrag weiter", () => {
    open(null);
    fillFirst("08:00", "12:00");
    saveNew();
    click(q('[data-testid="duration-chip-4"]'));
    expect(end().value).toBe("16:00");
    click(q('[data-testid="pause-chip-0"]'));
    expect(q<HTMLInputElement>("#pause").value).toBe("0");
    saveNew();
    const second = shifts().find((s) => s.start === "12:00")!;
    expect(second).toMatchObject({ end: "16:00", breakMinutes: 0 });
    expect(shiftHours(second)).toBe(4);
  });

  it("Nachtschicht: der Folgetag-Anschluss bleibt eine ausdrückliche Aktion (bestehende A1-Regel)", () => {
    open(null);
    fillFirst("22:00", "02:00");
    saveNew();
    expect(shifts()[0]).toMatchObject({ date: "2026-09-24", start: "22:00", end: "02:00" });
    // Auf dem selben Tag gibt es keinen stillen Anschluss; Vorschlag für den Folgetag nur per Tipp.
    expect(start().value).toBe("09:00");
    click(q('[data-testid="entry-continuation-apply"]'));
    expect(q<HTMLInputElement>('[data-testid="entry-date"]').value).toBe("2026-09-25");
    expect(start().value).toBe("02:00");
    expect(end().value).toBe("");
  });

  it("ein selbst gesetzter Beginn im neuen Eintrag wird nicht überschrieben", () => {
    open(null);
    fillFirst("08:00", "12:00");
    saveNew();
    setValue(start(), "13:30");
    expect(start().value).toBe("13:30");
  });
});

describe("B5 Fehlerfälle", () => {
  it("Validierungsfehler: nichts wird gespeichert, das Formular bleibt unverändert offen", () => {
    open(null);
    fillFirst("09:00", "09:00"); // Dauer 0 → blockiert
    click(q('[data-testid="entry-more-toggle"]'));
    setValue(q<HTMLTextAreaElement>("#notiz"), "bleibt erhalten");
    setValue(q<HTMLInputElement>("#pause"), "0");
    saveNew();
    expect(shifts()).toHaveLength(0);
    expect(closed.count).toBe(0);
    expect(start().value).toBe("09:00");
    expect(end().value).toBe("09:00");
    expect(q<HTMLTextAreaElement>("#notiz").value).toBe("bleibt erhalten");
  });

  it("Warnung (Überschneidung) braucht Bestätigung und speichert danach im selben Modus", () => {
    open(null);
    fillFirst("08:00", "12:00");
    saveNew();
    setValue(start(), "10:00");
    setValue(end(), "11:00"); // überschneidet 08–12
    saveNew();
    expect(shifts()).toHaveLength(1);
    click(q('[data-testid="entry-confirm-save"]'));
    expect(shifts()).toHaveLength(2);
    expect(closed.count).toBe(0);
    expect(end().value).toBe("");
  });

  it("Speicher des Geräts lehnt ab: Formular bleibt, Eintrag wird an seine Id gebunden – erneutes Speichern verdoppelt nicht", () => {
    open(null);
    fillFirst();
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    saveNew();
    expect(isPersistFailed()).toBe(true);
    expect(closed.count).toBe(0);
    expect(start().value).toBe("08:00");
    expect(end().value).toBe("12:00");
    expect(shifts()).toHaveLength(1);
    const id = shifts()[0]!.id;

    saveNew(); // wieder abgelehnt → weiterhin derselbe Eintrag
    expect(shifts()).toHaveLength(1);
    expect(shifts()[0]!.id).toBe(id);

    spy.mockRestore();
    saveNew(); // Speicher wieder da → gespeichert, danach neuer Eintrag
    expect(isPersistFailed()).toBe(false);
    expect(shifts()).toHaveLength(1);
    expect(shifts()[0]!.id).toBe(id);
    expect(end().value).toBe("");
    expect(start().value).toBe("12:00");
  });

  it("Doppeltippen verdoppelt nichts", () => {
    open(null);
    fillFirst();
    const button = q('[data-testid="entry-save-new"]');
    click(button);
    click(button);
    expect(shifts()).toHaveLength(1);
  });
});

describe("B5 bestehendes Speichern", () => {
  it("Speichern schließt den Dialog wie bisher", () => {
    open(null);
    fillFirst();
    save();
    expect(shifts()).toHaveLength(1);
    expect(closed.count).toBe(1);
  });

  it("Speichern & Neuer Eintrag erscheint nur bei neuen Arbeitseinträgen", () => {
    open(null);
    expect(has('[data-testid="entry-save-new"]')).toBe(true);
    fillFirst();
    save();
    teardown();
    setup({ jobs: JOBS, objects: OBJECTS, shifts: shifts() });
    open(shifts()[0]?.id ?? null);
    expect(has('[data-testid="entry-save-new"]')).toBe(false);
  });
});
