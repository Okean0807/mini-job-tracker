import { beforeEach, describe, expect, it } from "vitest";

import { noteCell } from "./arbeitsnachweis";
import {
  EMPTY_DATA,
  addObject,
  getData,
  normalize,
  removeObject,
  replaceAll,
  saveShift,
  upsertObject,
} from "./store";
import type { Shift, WorkObject } from "./types";
import {
  applyObjectToFormFields,
  clearObjectIdFromShifts,
  conservativeFillObject,
  ensureObjectsFromShifts,
  findMatchingObject,
  normalizeCompareValue,
  normalizePrimaryKey,
  resolveEntryDate,
  upsertObjectFromShiftAddress,
  withEntryDate,
} from "./work-objects";

function baseShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: "s1",
    kind: "arbeit",
    date: "2026-09-20",
    start: "08:00",
    end: "12:00",
    breakMinutes: 0,
    ...overrides,
  };
}

describe("resolveEntryDate / withEntryDate", () => {
  it("uses calendar date for new entries and shift.date when editing", () => {
    expect(resolveEntryDate(null, "2026-09-20")).toBe("2026-09-20");
    expect(resolveEntryDate(undefined, "2026-09-20")).toBe("2026-09-20");
    expect(resolveEntryDate({ date: "2026-09-18" }, "2026-09-20")).toBe("2026-09-18");
  });

  it("maps save payload date to entryDate (move existing shift, same id)", () => {
    const saved = withEntryDate(
      { id: "s1", date: "2026-09-18", kind: "arbeit" as const },
      "2026-09-22",
    );
    expect(saved).toEqual({ id: "s1", date: "2026-09-22", kind: "arbeit" });
  });
});

describe("applyObjectToFormFields", () => {
  it("copies objectId and address fields including workplace=name", () => {
    const obj: WorkObject = {
      id: "o1",
      name: "Objekt Nord",
      street: "Musterstraße",
      houseNo: "10",
      floor: "3. OG",
      doorSide: "linke Tür",
      zip: "30159",
      city: "Hannover",
    };
    expect(applyObjectToFormFields(obj)).toEqual({
      objectId: "o1",
      workplace: "Objekt Nord",
      street: "Musterstraße",
      houseNo: "10",
      floor: "3. OG",
      doorSide: "linke Tür",
      zip: "30159",
      city: "Hannover",
    });
  });
});

describe("normalize / identity", () => {
  it("trims, collapses spaces, case-insensitive — no umlaut folding", () => {
    expect(normalizeCompareValue("  Muster  Straße  ")).toBe("muster straße");
    expect(normalizeCompareValue("MUSTERSTRASSE")).toBe("musterstrasse");
    // Straße vs Strasse bleiben unterscheidbar (kein Folding)
    expect(normalizePrimaryKey({ street: "Musterstraße", houseNo: "1", zip: "30159", city: "Hannover" })).not.toBe(
      normalizePrimaryKey({ street: "Musterstrasse", houseNo: "1", zip: "30159", city: "Hannover" }),
    );
  });

  it("matches primary address ignoring floor/doorSide", () => {
    const objects: WorkObject[] = [
      { id: "o1", name: "A", street: "Hauptstraße", houseNo: "1", zip: "30159", city: "Hannover", floor: "1. OG" },
    ];
    const match = findMatchingObject(objects, {
      street: " hauptstraße ",
      houseNo: "1",
      zip: "30159",
      city: "Hannover",
    });
    expect(match?.id).toBe("o1");
    expect(
      findMatchingObject(objects, {
        street: "Andere",
        houseNo: "1",
        zip: "30159",
        city: "Hannover",
      }),
    ).toBeUndefined();
  });
});

describe("upsertObjectFromShiftAddress (pure)", () => {
  const opts = { newId: () => "new-obj", now: "2026-09-20" };

  it("1. new address → object created", () => {
    const result = upsertObjectFromShiftAddress(
      [],
      { street: "Berckhusenstraße", houseNo: "12", zip: "30161", city: "Hannover", workplace: "Kunde A" },
      opts,
    );
    expect(result.created).toBe(true);
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]).toMatchObject({
      id: "new-obj",
      name: "Kunde A",
      street: "Berckhusenstraße",
      houseNo: "12",
      zip: "30161",
      city: "Hannover",
    });
    expect(result.objectId).toBe("new-obj");
  });

  it("2. same primary address → no duplicate", () => {
    const first = upsertObjectFromShiftAddress(
      [],
      { street: "Hauptstraße", houseNo: "5", zip: "30159", city: "Hannover" },
      opts,
    );
    const second = upsertObjectFromShiftAddress(
      first.objects,
      { street: "Hauptstraße", houseNo: "5", zip: "30159", city: "Hannover", floor: "2. OG" },
      { newId: () => "should-not-use", now: "2026-09-20" },
    );
    expect(second.created).toBe(false);
    expect(second.objects).toHaveLength(1);
    expect(second.objectId).toBe("new-obj");
  });

  it("3. fill empty floor/doorSide; never overwrite conflicting non-empty", () => {
    const existing: WorkObject = {
      id: "o1",
      name: "Büro",
      street: "Hauptstraße",
      houseNo: "5",
      zip: "30159",
      city: "Hannover",
      floor: "2. OG",
    };
    // fill doorSide (empty), leave conflicting floor
    const filled = conservativeFillObject(existing, {
      street: "Hauptstraße",
      houseNo: "5",
      zip: "30159",
      city: "Hannover",
      floor: "3. OG",
      doorSide: "links",
    });
    expect(filled).toMatchObject({ floor: "2. OG", doorSide: "links" });

    const noChange = conservativeFillObject(existing, {
      street: "Hauptstraße",
      houseNo: "5",
      zip: "30159",
      city: "Hannover",
      floor: "3. OG",
    });
    expect(noChange).toBeUndefined();
  });
});

describe("objects CRUD + auto-learn via saveShift", () => {
  beforeEach(() => {
    replaceAll({ ...EMPTY_DATA });
  });

  it("4. manual object edit persists (store update)", () => {
    const obj: WorkObject = {
      id: "o1",
      name: "Büro",
      street: "Hauptstraße",
      houseNo: "1",
      zip: "30159",
      city: "Hannover",
    };
    addObject(obj);
    upsertObject({ ...obj, name: "Büro West", floor: "2. OG" });
    expect(getData().objects).toHaveLength(1);
    expect(getData().objects[0]).toMatchObject({ name: "Büro West", floor: "2. OG" });
  });

  it("5. delete object → shifts retain address fields; object gone", () => {
    addObject({
      id: "o1",
      name: "Büro",
      street: "Hauptstraße",
      houseNo: "1",
      zip: "30159",
      city: "Hannover",
    });
    saveShift(
      baseShift({
        id: "s1",
        objectId: "o1",
        street: "Hauptstraße",
        houseNo: "1",
        zip: "30159",
        city: "Hannover",
      }),
    );
    // saveShift may keep/relink objectId — ensure linked then delete
    expect(getData().shifts[0]?.street).toBe("Hauptstraße");
    removeObject("o1");
    expect(getData().objects).toHaveLength(0);
    const shift = getData().shifts[0]!;
    expect(shift.street).toBe("Hauptstraße");
    expect(shift.houseNo).toBe("1");
    expect(shift.zip).toBe("30159");
    expect(shift.city).toBe("Hannover");
    expect(shift.objectId).toBeUndefined();
  });

  it("6. select object → address copied into form fields (applyObjectToFormFields)", () => {
    const obj: WorkObject = {
      id: "o1",
      name: "Nord",
      street: "Musterstraße",
      houseNo: "10",
      floor: "3. OG",
      doorSide: "links",
      zip: "30159",
      city: "Hannover",
    };
    const fields = applyObjectToFormFields(obj);
    expect(fields.street).toBe("Musterstraße");
    expect(fields.houseNo).toBe("10");
    expect(fields.floor).toBe("3. OG");
    expect(fields.objectId).toBe("o1");
  });

  it("7. edit entry address after select → object unchanged", () => {
    addObject({
      id: "o1",
      name: "Original",
      street: "Hauptstraße",
      houseNo: "1",
      zip: "30159",
      city: "Hannover",
      floor: "1. OG",
    });
    // User selected object then changed street → new primary → new object; old untouched
    saveShift(
      baseShift({
        id: "s1",
        objectId: "o1",
        street: "Nebenstraße",
        houseNo: "2",
        zip: "30159",
        city: "Hannover",
      }),
    );
    const original = getData().objects.find((o) => o.id === "o1");
    expect(original).toMatchObject({
      street: "Hauptstraße",
      houseNo: "1",
      floor: "1. OG",
      name: "Original",
    });
    expect(getData().objects.length).toBeGreaterThanOrEqual(2);
    const learned = getData().objects.find((o) => o.street === "Nebenstraße");
    expect(learned).toBeTruthy();
    expect(getData().shifts[0]?.objectId).toBe(learned!.id);
  });

  it("8. legacy shift with address → upsert creates object without mutating shift address", () => {
    const legacy = baseShift({
      id: "legacy-1",
      street: "Altstraße",
      houseNo: "9",
      zip: "30159",
      city: "Hannover",
      floor: "EG",
    });
    // ensureObjectsFromShifts only adds objects
    const objects = ensureObjectsFromShifts([], [legacy], {
      newId: () => "from-legacy",
      now: "2026-09-20",
    });
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({
      id: "from-legacy",
      street: "Altstraße",
      houseNo: "9",
      floor: "EG",
    });
    // original shift untouched
    expect(legacy.street).toBe("Altstraße");
    expect(legacy.objectId).toBeUndefined();

    // via saveShift path
    replaceAll({ ...EMPTY_DATA, shifts: [legacy] });
    // replaceAll runs ensureObjectsFromShifts
    expect(getData().objects).toHaveLength(1);
    expect(getData().shifts[0]).toMatchObject({
      street: "Altstraße",
      houseNo: "9",
      zip: "30159",
      city: "Hannover",
      floor: "EG",
    });
    // shifts not linked by ensure (only ADD) — objectId may still be undefined
    expect(getData().shifts[0]?.street).toBe("Altstraße");
  });

  it("1+2 via saveShift: create then no duplicate on second save", () => {
    saveShift(
      baseShift({
        id: "a",
        street: "Testweg",
        houseNo: "3",
        zip: "30159",
        city: "Hannover",
      }),
    );
    expect(getData().objects).toHaveLength(1);
    const objId = getData().objects[0]!.id;
    expect(getData().shifts[0]?.objectId).toBe(objId);

    saveShift(
      baseShift({
        id: "b",
        street: "Testweg",
        houseNo: "3",
        zip: "30159",
        city: "Hannover",
        floor: "4. OG",
      }),
    );
    expect(getData().objects).toHaveLength(1);
    expect(getData().objects[0]?.floor).toBe("4. OG");
    expect(getData().shifts.find((s) => s.id === "b")?.objectId).toBe(objId);
  });

  it("3 via saveShift: fill empty extras; no overwrite of conflicting floor", () => {
    addObject({
      id: "o1",
      name: "X",
      street: "Fillweg",
      houseNo: "1",
      zip: "30159",
      city: "Hannover",
      floor: "2. OG",
    });
    saveShift(
      baseShift({
        id: "s1",
        street: "Fillweg",
        houseNo: "1",
        zip: "30159",
        city: "Hannover",
        floor: "3. OG",
        doorSide: "rechts",
      }),
    );
    const obj = getData().objects.find((o) => o.id === "o1")!;
    expect(obj.floor).toBe("2. OG");
    expect(obj.doorSide).toBe("rechts");
    expect(getData().shifts[0]?.objectId).toBe("o1");
  });

  it("normalize defaults missing objects to []", () => {
    const data = normalize({ shifts: [], jobs: [] });
    expect(data.objects).toEqual([]);
  });

  it("clearObjectIdFromShifts keeps address fields", () => {
    const shifts = clearObjectIdFromShifts(
      [
        baseShift({
          objectId: "o1",
          street: "A",
          houseNo: "1",
          zip: "1",
          city: "C",
        }),
      ],
      "o1",
    );
    expect(shifts[0]?.objectId).toBeUndefined();
    expect(shifts[0]?.street).toBe("A");
  });
});

describe("9. PDF noteCell reads shift address (not object lookup)", () => {
  it("noteCell uses shift street/floor/zip — independent of objects list", () => {
    const shift = baseShift({
      street: "Berckhusenstraße",
      houseNo: "12",
      floor: "3. OG",
      doorSide: "links",
      zip: "30161",
      city: "Hannover",
      note: "Klingel defekt",
      // objectId pointing nowhere — PDF must still show shift fields
      objectId: "missing-object",
    });
    const cell = noteCell(shift);
    expect(cell).toContain("Berckhusenstraße 12");
    expect(cell).toContain("3. OG");
    expect(cell).toContain("links");
    expect(cell).toContain("30161 Hannover");
    expect(cell).toContain("Klingel defekt");
    // sanity: noteCell signature is shift-only (no objects param)
    expect(noteCell.length).toBe(1);
  });
});
