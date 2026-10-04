import { describe, expect, it } from "vitest";

import { eachIsoDateInclusive } from "./absence-range";
import {
  addDays,
  compareDateKeys,
  dayNumber,
  dayOfYear,
  daysInMonth,
  daysInYear,
  diffDays,
  eachDateKey,
  fromDayNumber,
  intersectRanges,
  isDateKey,
  isLeapYear,
  isoWeekday,
  parseDateKey,
  rangeContains,
  rangeLength,
  toDateKey,
} from "./date-key";
import { daysInCalendarMonth } from "./stats-charts";

describe("date-key: Parsen / Formatieren", () => {
  it("parst DateKeys mit 0-basiertem Monat", () => {
    expect(parseDateKey("2026-01-01")).toEqual({ year: 2026, month: 0, day: 1 });
    expect(parseDateKey("2026-12-31")).toEqual({ year: 2026, month: 11, day: 31 });
    expect(parseDateKey("2028-02-29")).toEqual({ year: 2028, month: 1, day: 29 });
  });

  it("formatiert mit führenden Nullen (Monat 0-basiert)", () => {
    expect(toDateKey(2026, 0, 1)).toBe("2026-01-01");
    expect(toDateKey(2026, 9, 25)).toBe("2026-10-25");
    expect(toDateKey(2028, 1, 29)).toBe("2028-02-29");
  });

  it("lehnt ungültige Werte ab (kein Date-Überlauf)", () => {
    for (const bad of [
      "",
      "2026-1-01",
      "2026-13-01",
      "2026-00-10",
      "2026-02-29",
      "2027-02-29",
      "2026-04-31",
      "2026-10-25T00:00",
      "26-10-25",
      "0000-01-01",
    ]) {
      expect(isDateKey(bad), bad).toBe(false);
      expect(() => parseDateKey(bad), bad).toThrow(RangeError);
    }
    expect(isDateKey(20261025)).toBe(false);
    expect(() => toDateKey(2026, 1, 29)).toThrow(RangeError);
    expect(() => toDateKey(2026, 12, 1)).toThrow(RangeError);
    expect(() => toDateKey(2026, 0, 0)).toThrow(RangeError);
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2000-02-29")).toBe(true);
    expect(isDateKey("1900-02-29")).toBe(false);
  });
});

describe("date-key: Monats- und Jahreslängen", () => {
  it.each([
    [2026, 0, 31],
    [2026, 1, 28],
    [2027, 1, 28],
    [2028, 1, 29],
    [2100, 1, 28],
    [2000, 1, 29],
    [2026, 3, 30],
    [2026, 8, 30],
    [2026, 9, 31],
    [2026, 10, 30],
    [2026, 11, 31],
  ])("daysInMonth(%i, %i) = %i (wie daysInCalendarMonth)", (y, m, n) => {
    expect(daysInMonth(y, m)).toBe(n);
    expect(daysInCalendarMonth(y, m)).toBe(n);
  });

  it("wirft bei Monat außerhalb 0–11", () => {
    expect(() => daysInMonth(2026, 12)).toThrow(RangeError);
    expect(() => daysInMonth(2026, -1)).toThrow(RangeError);
  });

  it("Schaltjahre", () => {
    expect([2024, 2028, 2000].map(isLeapYear)).toEqual([true, true, true]);
    expect([2026, 2027, 1900, 2100].map(isLeapYear)).toEqual([false, false, false, false]);
    expect(daysInYear(2026)).toBe(365);
    expect(daysInYear(2028)).toBe(366);
  });
});

describe("date-key: Tagesarithmetik", () => {
  it("Monats- und Jahreswechsel", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2026-10-04", 0)).toBe("2026-10-04");
    expect(addDays("2026-01-31", 365)).toBe("2027-01-31");
  });

  it("über Zeitumstellungen hinweg genau ein Kalendertag (25.10.2026 / 29.03.2026)", () => {
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-26", -1)).toBe("2026-10-25");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(diffDays("2026-10-24", "2026-10-26")).toBe(2);
    expect(diffDays("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("dayNumber / fromDayNumber sind invers", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(dayNumber("1969-12-31")).toBe(-1);
    for (const k of ["0001-01-01", "1899-12-31", "2026-10-25", "2028-02-29", "9999-12-31"]) {
      expect(fromDayNumber(dayNumber(k))).toBe(k);
    }
    expect(() => fromDayNumber(1.5)).toThrow(RangeError);
  });

  it("diffDays / dayOfYear / compare", () => {
    expect(diffDays("2026-01-01", "2026-12-31")).toBe(364);
    expect(diffDays("2028-01-01", "2028-12-31")).toBe(365);
    expect(diffDays("2026-10-04", "2026-09-04")).toBe(-30);
    expect(dayOfYear("2026-01-01")).toBe(1);
    expect(dayOfYear("2026-12-31")).toBe(365);
    expect(dayOfYear("2028-12-31")).toBe(366);
    expect(["2026-10-01", "2025-12-31", "2026-09-30"].sort(compareDateKeys)).toEqual([
      "2025-12-31",
      "2026-09-30",
      "2026-10-01",
    ]);
  });

  it("ISO-Wochentag 1 = Montag … 7 = Sonntag", () => {
    expect(isoWeekday("2026-10-05")).toBe(1);
    expect(isoWeekday("2026-10-04")).toBe(7);
    expect(isoWeekday("2026-10-25")).toBe(7);
    expect(isoWeekday("2026-03-29")).toBe(7);
    expect(isoWeekday("2026-01-01")).toBe(4);
    expect(isoWeekday("2027-01-01")).toBe(5);
    expect(isoWeekday("2028-01-01")).toBe(6);
    expect(isoWeekday("2029-01-01")).toBe(1);
    expect(isoWeekday("1970-01-01")).toBe(4);
    expect(isoWeekday("1969-12-29")).toBe(1);
  });
});

describe("date-key: Bereiche", () => {
  it("eachDateKey: Oktober 2026 hat 31 eindeutige Tage inkl. 25.10. genau einmal", () => {
    const days = eachDateKey({ start: "2026-10-01", end: "2026-10-31" });
    expect(days).toHaveLength(31);
    expect(new Set(days).size).toBe(31);
    expect(days.filter((d) => d === "2026-10-25")).toHaveLength(1);
    expect(days[24]).toBe("2026-10-25");
    expect(days[25]).toBe("2026-10-26");
  });

  it("eachDateKey: März 2026 (DST vor) 31 Tage, Feb 2028 29 Tage, Jahreswechsel", () => {
    expect(eachDateKey({ start: "2026-03-01", end: "2026-03-31" })).toHaveLength(31);
    expect(eachDateKey({ start: "2028-02-01", end: "2028-02-29" })).toHaveLength(29);
    expect(eachDateKey({ start: "2026-12-30", end: "2027-01-02" })).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(eachDateKey({ start: "2026-10-05", end: "2026-10-04" })).toEqual([]);
    expect(eachDateKey({ start: "2026-10-04", end: "2026-10-04" })).toEqual(["2026-10-04"]);
  });

  it("stimmt mit dem bestehenden eachIsoDateInclusive (absence-range.ts) überein", () => {
    for (const [a, b] of [
      ["2026-10-19", "2026-10-26"],
      ["2026-03-23", "2026-03-30"],
      ["2025-12-28", "2027-01-04"],
      ["2028-02-27", "2028-03-01"],
    ] as const) {
      expect(eachDateKey({ start: a, end: b })).toEqual(eachIsoDateInclusive(a, b));
    }
  });

  it("rangeContains / rangeLength / intersectRanges", () => {
    const r = { start: "2026-09-28", end: "2026-10-04" };
    expect(rangeContains(r, "2026-09-28")).toBe(true);
    expect(rangeContains(r, "2026-10-04")).toBe(true);
    expect(rangeContains(r, "2026-10-05")).toBe(false);
    expect(rangeContains(r, "2026-09-27")).toBe(false);
    expect(rangeLength(r)).toBe(7);
    expect(rangeLength({ start: "2026-10-05", end: "2026-10-04" })).toBe(0);
    expect(intersectRanges(r, { start: "2026-09-01", end: "2026-09-30" })).toEqual({
      start: "2026-09-28",
      end: "2026-09-30",
    });
    expect(intersectRanges(r, { start: "2026-10-05", end: "2026-10-31" })).toBeNull();
  });
});
