import { beforeEach, describe, expect, it } from "vitest";

import {
  EMPTY_DATA,
  addObject,
  getData,
  normalize,
  removeObject,
  replaceAll,
  upsertObject,
} from "./store";
import type { WorkObject } from "./types";
import {
  applyObjectToFormFields,
  resolveEntryDate,
  withEntryDate,
} from "./work-objects";

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

describe("objects CRUD", () => {
  beforeEach(() => {
    replaceAll({ ...EMPTY_DATA });
  });

  it("addObject / upsertObject / removeObject round-trip", () => {
    const obj: WorkObject = {
      id: "o1",
      name: "Büro",
      street: "Hauptstraße",
      houseNo: "1",
      zip: "30159",
      city: "Hannover",
    };
    addObject(obj);
    expect(getData().objects).toHaveLength(1);
    expect(getData().objects[0]?.name).toBe("Büro");

    upsertObject({ ...obj, name: "Büro West", floor: "2. OG" });
    expect(getData().objects).toHaveLength(1);
    expect(getData().objects[0]).toMatchObject({ name: "Büro West", floor: "2. OG" });

    removeObject("o1");
    expect(getData().objects).toHaveLength(0);
  });

  it("normalize defaults missing objects to []", () => {
    const data = normalize({ shifts: [], jobs: [] });
    expect(data.objects).toEqual([]);
  });
});
