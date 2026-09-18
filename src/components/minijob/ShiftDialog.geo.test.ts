import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { addressLine } from "@/lib/minijob/arbeitsnachweis";
import type { Shift } from "@/lib/minijob/types";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ShiftDialog.tsx"), "utf8");

describe("ShiftDialog geo address wiring", () => {
  it("persists zip/city and calls reverse geocode after GPS", () => {
    expect(src).toMatch(/next\.zip = zip\.trim\(\)/);
    expect(src).toMatch(/next\.city = city\.trim\(\)/);
    expect(src).toMatch(/reverseGeocodeGerman\(pos\.lat, pos\.lng\)/);
    expect(src).toMatch(/toast\.message\(t\("worklog\.gpsAddressFail"\)\)/);
  });
});

describe("addressLine with PLZ/Ort", () => {
  it("includes German locality in Arbeitsnachweis line", () => {
    const shift = {
      id: "1",
      kind: "arbeit",
      date: "2026-09-01",
      start: "09:00",
      end: "12:00",
      breakMinutes: 0,
      street: "Musterstraße",
      houseNo: "15",
      zip: "10115",
      city: "Berlin",
    } as Shift;
    expect(addressLine(shift)).toBe("Musterstraße 15, 10115 Berlin");
  });
});
