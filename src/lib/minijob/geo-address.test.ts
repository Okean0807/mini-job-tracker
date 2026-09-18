import { describe, expect, it, vi } from "vitest";

import {
  applyReverseOrKeep,
  formatGermanAddress,
  isUsableGermanAddress,
  looksLikeCoordinates,
  mapNominatimToGermanAddress,
  reverseGeocodeGerman,
} from "./geo-address";

describe("mapNominatimToGermanAddress", () => {
  it("maps Straße, Nr, PLZ, Ort from Nominatim", () => {
    const mapped = mapNominatimToGermanAddress({
      address: {
        road: "Musterstraße",
        house_number: "15",
        postcode: "10115",
        city: "Berlin",
      },
    });
    expect(mapped).toEqual({
      street: "Musterstraße",
      houseNo: "15",
      zip: "10115",
      city: "Berlin",
    });
  });

  it("falls back to town/village and rejects empty", () => {
    expect(
      mapNominatimToGermanAddress({
        address: { postcode: "80331", town: "München" },
      }),
    ).toEqual({ zip: "80331", city: "München" });
    expect(mapNominatimToGermanAddress({ address: {} })).toBeNull();
    expect(mapNominatimToGermanAddress({ error: "Unable to geocode" })).toBeNull();
    expect(mapNominatimToGermanAddress(null)).toBeNull();
  });
});

describe("isUsableGermanAddress / looksLikeCoordinates", () => {
  it("rejects coord-like strings as address", () => {
    expect(looksLikeCoordinates("52.52000, 13.40500")).toBe(true);
    expect(looksLikeCoordinates("Musterstraße")).toBe(false);
    expect(isUsableGermanAddress({ street: "52.52, 13.40" })).toBe(false);
    expect(isUsableGermanAddress({ street: "Hauptstraße" })).toBe(true);
    expect(isUsableGermanAddress({ zip: "10115", city: "Berlin" })).toBe(true);
  });
});

describe("formatGermanAddress", () => {
  it("formats DE line without injecting coords", () => {
    expect(
      formatGermanAddress({
        street: "Musterstraße",
        houseNo: "15",
        zip: "10115",
        city: "Berlin",
      }),
    ).toBe("Musterstraße 15, 10115 Berlin");
  });
});

describe("applyReverseOrKeep", () => {
  it("keeps previous when reverse fails — never writes coords as street", () => {
    const previous = { street: "Altstraße", houseNo: "1", zip: "20095", city: "Hamburg" };
    expect(applyReverseOrKeep(previous, null)).toEqual(previous);
    expect(
      applyReverseOrKeep(previous, { street: "52.52000, 13.40500", city: "x" }),
    ).toEqual(previous);
  });

  it("merges usable reverse result", () => {
    expect(
      applyReverseOrKeep(
        { street: "Alt" },
        { street: "Neue Straße", houseNo: "9", zip: "50667", city: "Köln" },
      ),
    ).toEqual({
      street: "Neue Straße",
      houseNo: "9",
      zip: "50667",
      city: "Köln",
    });
  });
});

describe("reverseGeocodeGerman", () => {
  it("returns null on network failure and does not invent address", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
    await expect(reverseGeocodeGerman(52.52, 13.405, fetchImpl)).resolves.toBeNull();
  });

  it("returns null on non-OK HTTP", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(reverseGeocodeGerman(52.52, 13.405, fetchImpl)).resolves.toBeNull();
  });

  it("maps successful Nominatim JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        address: {
          road: "Unter den Linden",
          house_number: "1",
          postcode: "10117",
          city: "Berlin",
        },
      }),
    });
    await expect(reverseGeocodeGerman(52.517, 13.389, fetchImpl)).resolves.toEqual({
      street: "Unter den Linden",
      houseNo: "1",
      zip: "10117",
      city: "Berlin",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("nominatim.openstreetmap.org");
  });

  it("rejects invalid coordinates without fetch", async () => {
    const fetchImpl = vi.fn();
    await expect(reverseGeocodeGerman(Number.NaN, 0, fetchImpl)).resolves.toBeNull();
    await expect(reverseGeocodeGerman(91, 0, fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
