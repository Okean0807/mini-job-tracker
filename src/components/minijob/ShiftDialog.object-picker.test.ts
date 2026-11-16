/**
 * B3 – Einsatzort-Picker im echten Editor (react-dom + act, echter Store): Gruppen, Suche,
 * Tastatur, Tippen ändert die Auswahl nicht, fehlende Objekt-ID und Adress-Schnappschuss bleiben.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getData } from "@/lib/minijob/store";
import type { Shift, WorkObject } from "@/lib/minijob/types";
import { click, has, open, q, save, setValue, setup, teardown, work } from "./entry-test-harness";

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
  { id: "o2", name: "Lager Nord", street: "Hafenweg", houseNo: "2", zip: "20457", city: "Hamburg" },
  {
    id: "o3",
    name: "Praxis Süd",
    street: "Ringstraße",
    houseNo: "9",
    zip: "80331",
    city: "München",
  },
  { id: "o4", name: "Aula West", street: "Schulweg", houseNo: "1", zip: "50667", city: "Köln" },
];
const o = (id: string, date: string, objectId: string, jobId = "j1"): Shift => ({
  ...work({ id, date, start: "08:00", end: "12:00", breakMinutes: 0, jobId }),
  objectId,
});

beforeEach(() => {
  setup({
    jobs: JOBS,
    objects: OBJECTS,
    shifts: [
      o("s1", "2026-09-01", "o1"),
      o("s2", "2026-09-02", "o1"),
      o("s3", "2026-09-03", "o3"),
      o("s4", "2026-09-04", "o2"),
      o("x1", "2026-09-10", "o4", "j2"),
    ],
  });
});
afterEach(teardown);

const trigger = () => q<HTMLButtonElement>('[data-testid="object-picker-trigger"]');
const openPicker = () => click(trigger());
const search = () => q<HTMLInputElement>('[data-testid="object-search"]');
const optionIds = (group?: string) =>
  [
    ...document.querySelectorAll(
      `${group ? `[data-testid="object-group-${group}"] ` : ""}[role="option"]`,
    ),
  ].map((el) => el.getAttribute("data-testid")!.replace("object-option-", ""));
function key(el: Element, k: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });
}

describe("B3 Einsatzort-Picker", () => {
  it("Gruppen: Letzter, Häufig (ohne Duplikat), Alle", () => {
    open(null);
    openPicker();
    expect(optionIds("last")).toEqual(["o2"]);
    expect(optionIds("frequent")).toEqual(["o1"]);
    expect(optionIds("all")).toEqual(["o4", "o3"]);
    expect(optionIds()).toHaveLength(4);
  });

  it("Historie eines anderen Jobs wirkt nicht: j2 hat nur o4 als Letzten", () => {
    open(null);
    click(
      [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Lager Süd"))!,
    );
    openPicker();
    expect(optionIds("last")).toEqual(["o4"]);
    expect(has('[data-testid="object-group-frequent"]')).toBe(false);
    expect(optionIds("all")).toEqual(["o1", "o2", "o3"]);
  });

  it("Suche nach Namen filtert; leere Treffer zeigen den Leerzustand", () => {
    open(null);
    openPicker();
    setValue(search(), "buro");
    expect(optionIds()).toEqual(["o1"]);
    setValue(search(), "zzz");
    expect(optionIds()).toEqual([]);
    expect(q('[data-testid="object-no-results"]').textContent).toBeTruthy();
  });

  it("Tippen ändert die Auswahl nicht und wählt nie das erste Ergebnis", () => {
    open(null);
    openPicker();
    setValue(search(), "lager");
    key(search(), "Enter"); // keine Zeile angesteuert → nichts passiert
    expect(q('[data-testid="entry-object"]').getAttribute("data-object")).toBe("empty");
    expect(has('[data-testid="object-picker-panel"]')).toBe(true);
    save();
    const saved = getData().shifts.find((s) => (s.id !== "s1" && s.start === "09:00") || false);
    expect(saved?.objectId).toBeUndefined();
  });

  it("Auswahl per Klick/Touch setzt Objekt und Adress-Schnappschuss und leert die Suche", () => {
    open(null);
    openPicker();
    setValue(search(), "praxis");
    click(q('[data-testid="object-option-o3"]'));
    expect(has('[data-testid="object-picker-panel"]')).toBe(false);
    expect(trigger().textContent).toContain("Praxis Süd");
    expect(trigger().textContent).toContain("Ringstraße 9");
    openPicker();
    expect(search().value).toBe("");
  });

  it("Auswahl per Tastatur: Pfeil runter + Enter; Escape schließt nur den Picker", () => {
    open(null);
    openPicker();
    key(search(), "ArrowDown");
    key(search(), "ArrowDown"); // o2 (Letzter) → o1 (Häufig)
    expect(q('[data-testid="object-option-o1"]').getAttribute("data-active")).toBe("true");
    key(search(), "Enter");
    expect(trigger().textContent).toContain("Bürohaus Mitte");
    openPicker();
    key(search(), "Escape");
    expect(has('[data-testid="object-picker-panel"]')).toBe(false);
    expect(has('[data-testid="entry-save"]')).toBe(true); // Dialog bleibt offen
  });

  it("Auswahl speichert ID und Adress-Schnappschuss im Eintrag", () => {
    open(null);
    openPicker();
    click(q('[data-testid="object-option-o3"]'));
    setValue(q<HTMLInputElement>("#von"), "13:00");
    setValue(q<HTMLInputElement>("#bis"), "15:00");
    save();
    const saved = getData().shifts.find((s) => s.start === "13:00")!;
    expect(saved.objectId).toBe("o3");
    expect(saved.workplace).toBe("Praxis Süd");
    expect(saved.street).toBe("Ringstraße");
    expect(saved.city).toBe("München");
  });
});

describe("B3 fehlende Objekt-ID (Altbestand)", () => {
  const legacy: Shift = {
    ...work({ id: "legacy", date: "2026-09-24", start: "08:00", end: "12:00", breakMinutes: 0 }),
    objectId: "deleted-obj",
    workplace: "Altes Objekt",
    street: "Alte Gasse",
    houseNo: "3",
    zip: "01067",
    city: "Dresden",
  };
  beforeEach(() => {
    teardown();
    setup({ jobs: JOBS, objects: OBJECTS, shifts: [legacy] });
  });

  it("zeigt den gespeicherten Schnappschuss als aktuelle Auswahl, markiert als nicht mehr verfügbar", () => {
    open("legacy");
    expect(trigger().textContent).toContain("Altes Objekt");
    expect(trigger().textContent).toContain("Alte Gasse 3");
    expect(q('[data-testid="object-unavailable"]').textContent).toBeTruthy();
  });

  it("Speichern ohne Änderung behält den Adress-Schnappschuss des Eintrags", () => {
    open("legacy");
    save();
    const saved = getData().shifts.find((s) => s.id === "legacy")!;
    expect(saved.workplace).toBe("Altes Objekt");
    expect(saved.street).toBe("Alte Gasse");
    expect(saved.houseNo).toBe("3");
    expect(saved.zip).toBe("01067");
    expect(saved.city).toBe("Dresden");
  });

  it("Speichern ohne Änderung behält die fehlende objectId und legt kein Ersatzobjekt an", () => {
    open("legacy");
    const catalogBefore = getData()
      .objects.map((o) => o.id)
      .sort();
    save();
    expect(getData().shifts.find((s) => s.id === "legacy")!.objectId).toBe("deleted-obj");
    expect(
      getData()
        .objects.map((o) => o.id)
        .sort(),
    ).toEqual(catalogBefore);
    expect(getData().objects.map((o) => o.id)).not.toContain("deleted-obj");
  });

  it("Picker öffnen, suchen und per Escape schließen verändert die fehlende objectId nicht", () => {
    open("legacy");
    openPicker();
    setValue(search(), "lager");
    key(search(), "Escape");
    save();
    const saved = getData().shifts.find((s) => s.id === "legacy")!;
    expect(saved.objectId).toBe("deleted-obj");
    expect(saved.street).toBe("Alte Gasse");
  });

  it("bewusstes Ersetzen durch ein vorhandenes Objekt funktioniert", () => {
    open("legacy");
    openPicker();
    click(q('[data-testid="object-option-o1"]'));
    expect(has('[data-testid="object-unavailable"]')).toBe(false);
    save();
    const saved = getData().shifts.find((s) => s.id === "legacy")!;
    expect(saved.objectId).toBe("o1");
    expect(saved.street).toBe("Hauptstraße");
    expect(saved.city).toBe("Berlin");
  });
});
