import { describe, expect, it } from "vitest";

import { holidayName, holidaysFor, isHoliday } from "./holidays";

describe("isHoliday / feste Feiertage", () => {
  it("erkennt bundesweite Feiertage in NW", () => {
    expect(isHoliday("2026-01-01", "NW")).toBe(true); // Neujahr
    expect(holidayName("2026-01-01", "NW")).toBe("Neujahr");
    expect(isHoliday("2026-05-01", "NW")).toBe(true); // Tag der Arbeit
    expect(isHoliday("2026-10-03", "NW")).toBe(true); // Tag der Deutschen Einheit
    expect(isHoliday("2026-12-25", "NW")).toBe(true);
    expect(isHoliday("2026-12-26", "NW")).toBe(true);
  });

  it("erkennt NW-spezifische Feiertage", () => {
    expect(isHoliday("2026-06-04", "NW")).toBe(true); // Fronleichnam (Ostern 2026-04-05)
    expect(holidayName("2026-06-04", "NW")).toBe("Fronleichnam");
    expect(isHoliday("2026-11-01", "NW")).toBe(true); // Allerheiligen
  });

  it("unterscheidet Bundesländer (NW vs BY)", () => {
    // Heilige Drei Könige nur BW/BY/ST
    expect(isHoliday("2026-01-06", "BY")).toBe(true);
    expect(isHoliday("2026-01-06", "NW")).toBe(false);
    expect(holidayName("2026-01-06", "BY")).toBe("Heilige Drei Könige");
  });

  it("unterscheidet Bundesländer (NW vs BE)", () => {
    // Internationaler Frauentag nur BE/MV
    expect(isHoliday("2026-03-08", "BE")).toBe(true);
    expect(isHoliday("2026-03-08", "NW")).toBe(false);
  });

  it("liefert false für einen normalen Werktag", () => {
    expect(isHoliday("2026-03-04", "NW")).toBe(false); // Mittwoch, kein Feiertag
    expect(holidayName("2026-03-04", "NW")).toBeUndefined();
  });

  it("behandelt Schaltjahr-Tage ohne Feiertagsstatus", () => {
    expect(isHoliday("2024-02-29", "NW")).toBe(false);
    expect(isHoliday("2024-02-29", "BY")).toBe(false);
  });
});

describe("bewegliche Feiertage (Ostern)", () => {
  it("berechnet Karfreitag und Ostermontag für 2026", () => {
    // Ostersonntag 2026 = 5. April
    expect(isHoliday("2026-04-03", "NW")).toBe(true); // Karfreitag
    expect(holidayName("2026-04-03", "NW")).toBe("Karfreitag");
    expect(isHoliday("2026-04-06", "NW")).toBe(true); // Ostermontag
    expect(holidayName("2026-04-06", "NW")).toBe("Ostermontag");
  });

  it("berechnet Christi Himmelfahrt und Pfingstmontag", () => {
    expect(isHoliday("2026-05-14", "NW")).toBe(true); // +39
    expect(holidayName("2026-05-14", "NW")).toBe("Christi Himmelfahrt");
    expect(isHoliday("2026-05-25", "NW")).toBe(true); // +50
    expect(holidayName("2026-05-25", "NW")).toBe("Pfingstmontag");
  });
});

describe("holidaysFor", () => {
  it("listet sortierte Einträge und filtert nach Bundesland", () => {
    const nw = holidaysFor(2026, "NW");
    const by = holidaysFor(2026, "BY");
    expect(nw.length).toBeGreaterThan(0);
    expect(nw.every((h, i) => i === 0 || h.date >= nw[i - 1]!.date)).toBe(true);
    expect(nw.some((h) => h.name === "Heilige Drei Könige")).toBe(false);
    expect(by.some((h) => h.name === "Heilige Drei Könige")).toBe(true);
    expect(nw.some((h) => h.name === "Allerheiligen")).toBe(true);
  });
});
