import { describe, expect, it } from "vitest";

import { nightHours, shiftBreakdown, shiftHours } from "./calc";
import { isHoliday } from "./holidays";
import { DEFAULT_SUPPLEMENTS, type Shift, type Supplements } from "./types";

function makeShift(patch: Partial<Shift> = {}): Shift {
  return {
    id: "s1",
    kind: "arbeit",
    date: "2026-03-04", // Mittwoch
    start: "09:00",
    end: "17:00",
    breakMinutes: 0,
    rate: 10,
    ...patch,
  };
}

function supplements(patch: Partial<Supplements> = {}): Supplements {
  return { ...DEFAULT_SUPPLEMENTS, ...patch };
}

describe("shiftHours", () => {
  it("berechnet eine normale Wochentagsschicht", () => {
    expect(shiftHours(makeShift())).toBe(8);
  });

  it("zieht die Pause ab", () => {
    expect(shiftHours(makeShift({ breakMinutes: 45 }))).toBeCloseTo(7.25, 10);
  });

  it("rechnet über Mitternacht", () => {
    expect(shiftHours(makeShift({ start: "22:00", end: "02:00" }))).toBe(4);
    expect(shiftHours(makeShift({ start: "22:00", end: "02:00", breakMinutes: 30 }))).toBe(3.5);
  });
});

describe("nightHours", () => {
  it("zählt nur den Anteil im Nachtfenster", () => {
    const shift = makeShift({ start: "22:00", end: "02:00" });
    expect(nightHours(shift, "23:00", "06:00")).toBeCloseTo(3, 10);
  });

  it("verteilt die Pause anteilig", () => {
    const shift = makeShift({ start: "22:00", end: "02:00", breakMinutes: 60 });
    // 3h von 4h brutto im Nachtfenster, bezahlt 3h -> 2.25h
    expect(nightHours(shift, "23:00", "06:00")).toBeCloseTo(2.25, 10);
  });

  it("liefert 0 ohne Überschneidung", () => {
    expect(nightHours(makeShift(), "23:00", "06:00")).toBe(0);
  });
});

describe("shiftBreakdown", () => {
  it("normale Schicht ohne Zuschläge", () => {
    const b = shiftBreakdown(makeShift());
    expect(b.hours).toBe(8);
    expect(b.base).toBe(80);
    expect(b.bonus).toBe(0);
    expect(b.total).toBe(80);
    expect(b.labels).toEqual([]);
  });

  it("Schicht mit Pause verdient weniger", () => {
    const b = shiftBreakdown(makeShift({ breakMinutes: 30 }));
    expect(b.hours).toBe(7.5);
    expect(b.total).toBe(75);
  });

  it("Samstagszuschlag (20 %)", () => {
    const b = shiftBreakdown(makeShift({ date: "2026-03-07" }), {
      supplements: supplements({ saturday: { enabled: true, mode: "prozent", value: 20 } }),
    });
    expect(b.base).toBe(80);
    expect(b.bonus).toBeCloseTo(16, 10);
    expect(b.total).toBeCloseTo(96, 10);
    expect(b.labels).toEqual(["Samstag"]);
  });

  it("Sonntagszuschlag (50 %)", () => {
    const b = shiftBreakdown(makeShift({ date: "2026-03-08" }), {
      supplements: supplements({ sunday: { enabled: true, mode: "prozent", value: 50 } }),
    });
    expect(b.bonus).toBeCloseTo(40, 10);
    expect(b.total).toBeCloseTo(120, 10);
    expect(b.labels).toEqual(["Sonntag"]);
  });

  it("Feiertagszuschlag ersetzt Wochenendzuschlag", () => {
    // 2026-01-01 (Neujahr) ist ein Donnerstag und bundesweiter Feiertag
    expect(isHoliday("2026-01-01", "NW")).toBe(true);
    const b = shiftBreakdown(makeShift({ date: "2026-01-01" }), {
      holiday: true,
      supplements: supplements({
        holiday: { enabled: true, mode: "prozent", value: 100 },
        sunday: { enabled: true, mode: "prozent", value: 50 },
      }),
    });
    expect(b.bonus).toBeCloseTo(80, 10);
    expect(b.total).toBeCloseTo(160, 10);
    expect(b.labels).toEqual(["Feiertag"]);
  });

  it("Nachtzuschlag nur auf die Nachtstunden (fester Betrag)", () => {
    const b = shiftBreakdown(makeShift({ start: "22:00", end: "02:00" }), {
      supplements: supplements({ night: { enabled: true, mode: "fest", value: 2 } }),
    });
    expect(b.hours).toBe(4);
    expect(b.base).toBe(40);
    expect(b.bonus).toBeCloseTo(6, 10); // 3 Nachtstunden x 2 EUR
    expect(b.total).toBeCloseTo(46, 10);
    expect(b.labels).toEqual(["Nacht"]);
  });

  it("Überstundenzuschlag nur bei markierter Schicht", () => {
    const sup = supplements({ overtime: { enabled: true, mode: "prozent", value: 25 } });
    expect(shiftBreakdown(makeShift(), { supplements: sup }).bonus).toBe(0);
    const b = shiftBreakdown(makeShift({ overtime: true }), { supplements: sup });
    expect(b.bonus).toBeCloseTo(20, 10);
    expect(b.total).toBeCloseTo(100, 10);
    expect(b.labels).toEqual(["Überstunden"]);
  });

  it("kombiniert Feiertag + Nacht + Überstunden", () => {
    // Sonntag 2026-03-08 als Feiertag markiert, 22:00-02:00, 4h
    const b = shiftBreakdown(makeShift({ date: "2026-03-08", start: "22:00", end: "02:00", overtime: true }), {
      holiday: true,
      supplements: supplements({
        holiday: { enabled: true, mode: "prozent", value: 100 },
        sunday: { enabled: true, mode: "prozent", value: 50 },
        night: { enabled: true, mode: "prozent", value: 25 },
        overtime: { enabled: true, mode: "prozent", value: 25 },
      }),
    });
    expect(b.hours).toBe(4);
    expect(b.base).toBe(40);
    // Feiertag 40 + Nacht (3h * 10 * 25%) 7.5 + Überstunden 10
    expect(b.bonus).toBeCloseTo(57.5, 10);
    expect(b.total).toBeCloseTo(97.5, 10);
    expect(b.labels).toEqual(["Feiertag", "Nacht", "Überstunden"]);
  });

  it("nutzt Job-Zuschläge vor den globalen Zuschlägen", () => {
    const b = shiftBreakdown(makeShift({ date: "2026-03-07" }), {
      job: {
        id: "j1",
        name: "Job",
        color: "#000",
        rate: 10,
        mode: "flex",
        supplements: supplements({ saturday: { enabled: true, mode: "fest", value: 1.5 } }),
      },
      supplements: supplements({ saturday: { enabled: true, mode: "prozent", value: 20 } }),
    });
    expect(b.bonus).toBeCloseTo(12, 10); // 8h x 1.50 EUR
  });
});
