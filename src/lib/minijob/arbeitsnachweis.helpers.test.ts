import { describe, expect, it } from "vitest";

import {
  addressLine,
  addressLine1,
  addressLine2,
  leistungsartCell,
  noteCell,
  streetHouseLine,
} from "./arbeitsnachweis";
import type { Shift } from "./types";

function makeShift(patch: Partial<Shift> = {}): Shift {
  return {
    id: "s1",
    kind: "arbeit",
    date: "2026-03-04",
    start: "09:00",
    end: "17:00",
    breakMinutes: 0,
    rate: 10,
    ...patch,
  };
}

describe("streetHouseLine", () => {
  it("joins street + houseNo without zip/city", () => {
    expect(
      streetHouseLine(
        makeShift({
          street: "Berckhusenstraße",
          houseNo: "12",
          zip: "30161",
          city: "Hannover",
        }),
      ),
    ).toBe("Berckhusenstraße 12");
  });

  it("returns street only or houseNo only", () => {
    expect(streetHouseLine(makeShift({ street: "Hauptstraße" }))).toBe("Hauptstraße");
    expect(streetHouseLine(makeShift({ houseNo: "5" }))).toBe("5");
  });

  it("returns empty when both missing", () => {
    expect(streetHouseLine(makeShift())).toBe("");
    expect(streetHouseLine(makeShift({ street: "  ", houseNo: "" }))).toBe("");
  });
});

describe("addressLine1 / addressLine2", () => {
  it("formats street + floor + doorSide without trailing commas", () => {
    expect(
      addressLine1(
        makeShift({
          street: "Musterstraße",
          houseNo: "10",
          floor: "3. OG",
          doorSide: "linke Tür",
        }),
      ),
    ).toBe("Musterstraße 10, 3. OG, linke Tür");
    expect(
      addressLine1(makeShift({ street: "Musterstraße", houseNo: "10", floor: "3. OG" })),
    ).toBe("Musterstraße 10, 3. OG");
    expect(addressLine1(makeShift({ street: "Musterstraße", houseNo: "10" }))).toBe(
      "Musterstraße 10",
    );
  });

  it("joins zip and city with a space; empty when both missing", () => {
    expect(addressLine2(makeShift({ zip: "30159", city: "Hannover" }))).toBe("30159 Hannover");
    expect(addressLine2(makeShift({ zip: "30159" }))).toBe("30159");
    expect(addressLine2(makeShift({ city: "Hannover" }))).toBe("Hannover");
    expect(addressLine2(makeShift())).toBe("");
  });

  it("omits empty floor/door without double commas", () => {
    expect(
      addressLine1(
        makeShift({
          street: "Musterstraße",
          houseNo: "10",
          floor: "  ",
          doorSide: "linke Tür",
        }),
      ),
    ).toBe("Musterstraße 10, linke Tür");
  });
});

describe("leistungsartCell", () => {
  it("returns trimmed workCode only", () => {
    expect(leistungsartCell(makeShift({ workCode: " UR " }))).toBe("UR");
  });

  it("never invents from tasks or name", () => {
    expect(
      leistungsartCell(
        makeShift({
          tasks: ["Unterhaltsreinigung"],
          workplace: "Büro",
          note: "UR",
        }),
      ),
    ).toBe("");
  });

  it("empty when workCode missing", () => {
    expect(leistungsartCell(makeShift())).toBe("");
  });
});

describe("noteCell", () => {
  it("street+houseNo only when no note", () => {
    expect(
      noteCell(makeShift({ street: "Berckhusenstraße", houseNo: "12", workCode: "UR" })),
    ).toBe("Berckhusenstraße 12");
  });

  it("adds note as further line and never includes workCode", () => {
    expect(
      noteCell(
        makeShift({
          street: "Musterstraße",
          houseNo: "1",
          workCode: "FR",
          note: "Schlüssel beim Hausmeister",
        }),
      ),
    ).toBe("Musterstraße 1\nSchlüssel beim Hausmeister");
  });

  it("puts floor/door on line1 and zip+city on line2", () => {
    expect(
      noteCell(
        makeShift({
          street: "Musterstraße",
          houseNo: "10",
          zip: "30159",
          city: "Hannover",
          floor: "3. OG",
          doorSide: "linke Tür",
        }),
      ),
    ).toBe("Musterstraße 10, 3. OG, linke Tür\n30159 Hannover");
  });

  it("skips missing floor without empty lines or trailing commas", () => {
    expect(
      noteCell(
        makeShift({
          street: "Musterstraße",
          houseNo: "10",
          city: "Hannover",
          doorSide: "linke Tür",
        }),
      ),
    ).toBe("Musterstraße 10, linke Tür\nHannover");
  });

  it("trims optional fields and omits empty lines", () => {
    expect(
      noteCell(
        makeShift({
          street: " Musterstraße ",
          houseNo: " 10 ",
          zip: " 30159 ",
          city: "  Hannover  ",
          floor: "   ",
          doorSide: " linke Tür ",
          note: " Schlüssel beim Hausmeister ",
        }),
      ),
    ).toBe("Musterstraße 10, linke Tür\n30159 Hannover\nSchlüssel beim Hausmeister");
  });

  it("note only when no street", () => {
    expect(noteCell(makeShift({ note: "Nur Notiz", workCode: "UR" }))).toBe("Nur Notiz");
  });

  it("empty when neither street nor note", () => {
    expect(noteCell(makeShift({ workCode: "UR" }))).toBe("");
  });

  it("old shift without floor/door/zip/city exports street only", () => {
    expect(noteCell(makeShift({ street: "Musterstraße", houseNo: "10" }))).toBe("Musterstraße 10");
  });
});

describe("addressLine still includes PLZ/Ort (geo)", () => {
  it("keeps full line for geo tests", () => {
    expect(
      addressLine(
        makeShift({
          street: "Musterstraße",
          houseNo: "15",
          zip: "10115",
          city: "Berlin",
        }),
      ),
    ).toBe("Musterstraße 15, 10115 Berlin");
  });
});
