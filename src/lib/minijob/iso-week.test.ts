import { getISOWeek, getISOWeekYear, getISOWeeksInYear, startOfISOWeek } from "date-fns";
import { describe, expect, it } from "vitest";

import { isoDate } from "./calc";
import { addDays, eachDateKey, isoWeekday, parseDateKey } from "./date-key";
import {
  formatIsoWeekKey,
  isValidIsoWeek,
  isoWeekEnd,
  isoWeekOf,
  isoWeekRange,
  isoWeekStart,
  isoWeeksInYear,
  parseIsoWeekKey,
  shiftIsoWeek,
} from "./iso-week";
import { T_ISO, WEEKS_IN_YEAR } from "./__fixtures__/period-calendar-goldens";

describe("iso-week: Golden-Tabelle T-ISO", () => {
  it.each(T_ISO)("%s → KW %i/%i, Montag %s", (date, week, isoYear, monday) => {
    expect(isoWeekOf(date)).toEqual({ isoYear, week });
    expect(isoWeekStart(date)).toBe(monday);
    expect(isoWeekEnd(date)).toBe(addDays(monday, 6));
    expect(isoWeekday(isoWeekStart(date))).toBe(1);
    expect(isoWeekday(isoWeekEnd(date))).toBe(7);
  });

  it.each(WEEKS_IN_YEAR)("isoWeeksInYear(%i) = %i", (year, n) => {
    expect(isoWeeksInYear(year)).toBe(n);
  });
});

describe("iso-week: Freigegebene Golden-Fälle", () => {
  it("2026 hat 53 Wochen; KW 53/2026 = 28.12.2026–03.01.2027", () => {
    expect(isoWeeksInYear(2026)).toBe(53);
    expect(isoWeekRange(2026, 53)).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    for (const d of eachDateKey({ start: "2026-12-28", end: "2027-01-03" })) {
      expect(isoWeekOf(d), d).toEqual({ isoYear: 2026, week: 53 });
    }
  });

  it("01.01.2027 = KW 53/2026; 04.01.2027 = KW 1/2027", () => {
    expect(isoWeekOf("2027-01-01")).toEqual({ isoYear: 2026, week: 53 });
    expect(isoWeekOf("2027-01-04")).toEqual({ isoYear: 2027, week: 1 });
    expect(isoWeekRange(2027, 1)).toEqual({ start: "2027-01-04", end: "2027-01-10" });
  });

  it("KW 1/2026 beginnt im Kalenderjahr 2025", () => {
    expect(isoWeekRange(2026, 1)).toEqual({ start: "2025-12-29", end: "2026-01-04" });
    expect(isoWeekRange(2025, 52)).toEqual({ start: "2025-12-22", end: "2025-12-28" });
  });

  it("KW 40/2026 = 28.09.–04.10.2026 (Monatsgrenze)", () => {
    expect(isoWeekRange(2026, 40)).toEqual({ start: "2026-09-28", end: "2026-10-04" });
    expect(isoWeekOf("2026-10-04")).toEqual({ isoYear: 2026, week: 40 });
  });

  it("DST-Wochen KW 13 und KW 43/2026 enthalten 7 eindeutige Tage", () => {
    for (const w of [13, 43]) {
      const r = isoWeekRange(2026, w);
      const days = eachDateKey(r);
      expect(days).toHaveLength(7);
      expect(new Set(days).size).toBe(7);
      expect(days.map(isoWeekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
    expect(isoWeekRange(2026, 43)).toEqual({ start: "2026-10-19", end: "2026-10-25" });
  });

  it("Schalttag 29.02.2028 liegt in KW 9/2028", () => {
    expect(isoWeekOf("2028-02-29")).toEqual({ isoYear: 2028, week: 9 });
  });
});

describe("iso-week: Navigation und Schlüssel", () => {
  it("shiftIsoWeek überspringt KW 53 nicht und wechselt das Wochenjahr", () => {
    expect(shiftIsoWeek({ isoYear: 2026, week: 52 }, 1)).toEqual({ isoYear: 2026, week: 53 });
    expect(shiftIsoWeek({ isoYear: 2026, week: 53 }, 1)).toEqual({ isoYear: 2027, week: 1 });
    expect(shiftIsoWeek({ isoYear: 2027, week: 1 }, -1)).toEqual({ isoYear: 2026, week: 53 });
    expect(shiftIsoWeek({ isoYear: 2026, week: 1 }, -1)).toEqual({ isoYear: 2025, week: 52 });
    expect(shiftIsoWeek({ isoYear: 2028, week: 1 }, -1)).toEqual({ isoYear: 2027, week: 52 });
    expect(shiftIsoWeek({ isoYear: 2026, week: 40 }, 0)).toEqual({ isoYear: 2026, week: 40 });
    expect(shiftIsoWeek({ isoYear: 2026, week: 1 }, 53)).toEqual({ isoYear: 2027, week: 1 });
  });

  it("ungültige Wochen werfen bzw. liefern null", () => {
    expect(isValidIsoWeek(2026, 53)).toBe(true);
    expect(isValidIsoWeek(2027, 53)).toBe(false);
    expect(isValidIsoWeek(2026, 0)).toBe(false);
    expect(isValidIsoWeek(2026, 1.5)).toBe(false);
    expect(() => isoWeekRange(2027, 53)).toThrow(RangeError);
    expect(() => isoWeekRange(2026, 0)).toThrow(RangeError);
    expect(() => isoWeekOf("2026-02-30")).toThrow(RangeError);
  });

  it("formatIsoWeekKey / parseIsoWeekKey", () => {
    expect(formatIsoWeekKey({ isoYear: 2026, week: 1 })).toBe("2026-W01");
    expect(formatIsoWeekKey({ isoYear: 2026, week: 53 })).toBe("2026-W53");
    expect(parseIsoWeekKey("2026-W53")).toEqual({ isoYear: 2026, week: 53 });
    expect(parseIsoWeekKey("2027-W53")).toBeNull();
    expect(parseIsoWeekKey("2026-W99")).toBeNull();
    expect(parseIsoWeekKey("2026-W00")).toBeNull();
    expect(parseIsoWeekKey("2026W40")).toBeNull();
    expect(parseIsoWeekKey("")).toBeNull();
  });
});

describe("iso-week: Gegenprobe mit date-fns (lokales Datum, 2000–2040)", () => {
  it("jeder Tag: Woche, Wochenjahr, Montag und Wochen pro Jahr identisch", () => {
    const days = eachDateKey({ start: "2000-01-01", end: "2040-12-31" });
    let mismatches = 0;
    for (const key of days) {
      const { year, month, day } = parseDateKey(key);
      const local = new Date(year, month, day, 12);
      const ours = isoWeekOf(key);
      if (
        ours.week !== getISOWeek(local) ||
        ours.isoYear !== getISOWeekYear(local) ||
        isoWeekStart(key) !== isoDate(startOfISOWeek(local))
      ) {
        mismatches++;
      }
    }
    expect(days.length).toBe(14976);
    expect(mismatches).toBe(0);
    for (let y = 2000; y <= 2040; y++) {
      expect(isoWeeksInYear(y), String(y)).toBe(getISOWeeksInYear(new Date(y, 5, 1, 12)));
    }
  });
});
