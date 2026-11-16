/**
 * B3 – Auto-Lernen beim Speichern (`saveShift`): fehlende objectId bleibt unverändert; gültige
 * oder fehlende objectId verhalten sich wie bisher.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { DEMO_SCOPE } from "./storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
  saveShift,
} from "./store";
import { DEFAULT_SETTINGS, type Shift, type WorkObject } from "./types";

const CATALOG: WorkObject[] = [
  {
    id: "o1",
    name: "Bürohaus Mitte",
    street: "Hauptstraße",
    houseNo: "5",
    zip: "10115",
    city: "Berlin",
  },
];

function shift(partial: Partial<Shift> & { id: string }): Shift {
  return {
    kind: "arbeit",
    date: "2026-09-24",
    start: "08:00",
    end: "12:00",
    breakMinutes: 0,
    jobId: "j1",
    ...partial,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  loadFromStorage();
  activateScope(DEMO_SCOPE);
  replaceAll({
    ...EMPTY_DATA,
    jobs: [{ id: "j1", name: "Job", color: "#0d9488", mode: "flex" }],
    objects: CATALOG,
    settings: { ...DEFAULT_SETTINGS, onboarded: true, localDemoMode: true },
  } as never);
});

describe("saveShift: objectId-Verknüpfung", () => {
  it("fehlende objectId: ID, Schnappschuss bleiben, kein Ersatzobjekt, keine Neuverknüpfung", () => {
    const before = getData().objects;
    saveShift(
      shift({
        id: "legacy",
        objectId: "deleted-obj",
        workplace: "Altes Objekt",
        street: "Alte Gasse",
        houseNo: "3",
        zip: "01067",
        city: "Dresden",
      }),
    );
    const saved = getData().shifts.find((s) => s.id === "legacy")!;
    expect(saved.objectId).toBe("deleted-obj");
    expect(saved.workplace).toBe("Altes Objekt");
    expect(saved.street).toBe("Alte Gasse");
    expect(saved.city).toBe("Dresden");
    expect(getData().objects).toEqual(before);
  });

  it("gültige objectId: wie bisher (bleibt verknüpft, Katalog ergänzt fehlende Felder konservativ)", () => {
    saveShift(
      shift({
        id: "valid",
        objectId: "o1",
        workplace: "Bürohaus Mitte",
        street: "Hauptstraße",
        houseNo: "5",
        zip: "10115",
        city: "Berlin",
        floor: "3. OG",
      }),
    );
    expect(getData().shifts.find((s) => s.id === "valid")!.objectId).toBe("o1");
    expect(getData().objects).toHaveLength(1);
    expect(getData().objects[0]!.floor).toBe("3. OG");
  });

  it("ohne objectId: neue Adresse legt ein Objekt an und verknüpft (unverändertes Auto-Lernen)", () => {
    saveShift(
      shift({ id: "fresh", workplace: "Neu", street: "Nebenstraße", houseNo: "7", city: "Bonn" }),
    );
    const learned = getData().objects.find((o) => o.street === "Nebenstraße");
    expect(learned).toBeTruthy();
    expect(getData().shifts.find((s) => s.id === "fresh")!.objectId).toBe(learned!.id);
    expect(getData().objects).toHaveLength(2);
  });

  it("ohne objectId, bekannte Adresse: verknüpft mit dem vorhandenen Objekt", () => {
    saveShift(
      shift({ id: "match", street: "Hauptstraße", houseNo: "5", zip: "10115", city: "Berlin" }),
    );
    expect(getData().shifts.find((s) => s.id === "match")!.objectId).toBe("o1");
    expect(getData().objects).toHaveLength(1);
  });
});
