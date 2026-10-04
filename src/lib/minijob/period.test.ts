import { describe, expect, it } from "vitest";

import { isoWeekday } from "./date-key";
import {
  comparisonWindow,
  daysInPeriod,
  elapsedDays,
  elapsedRange,
  isSamePeriod,
  monthPeriod,
  nextPeriod,
  parsePeriodKey,
  periodContaining,
  periodContains,
  periodKey,
  periodLength,
  periodStatus,
  prevPeriod,
  shiftPeriod,
  subPeriods,
  weekPeriod,
  yearPeriod,
  type Period,
} from "./period";

const label = (p: Period) => `${p.type}:${periodKey(p)} ${p.start}..${p.end}`;

describe("period: Konstruktoren", () => {
  it("weekPeriod / monthPeriod / yearPeriod", () => {
    expect(weekPeriod(2026, 53)).toEqual({
      type: "week",
      start: "2026-12-28",
      end: "2027-01-03",
      isoYear: 2026,
      isoWeek: 53,
    });
    expect(monthPeriod(2026, 8)).toEqual({
      type: "month",
      start: "2026-09-01",
      end: "2026-09-30",
      year: 2026,
      month: 8,
    });
    expect(yearPeriod(2026)).toEqual({
      type: "year",
      start: "2026-01-01",
      end: "2026-12-31",
      year: 2026,
    });
    expect(() => weekPeriod(2027, 53)).toThrow(RangeError);
    expect(() => monthPeriod(2026, 12)).toThrow(RangeError);
  });

  it("periodContaining nach ISO-Woche / Monat / Jahr", () => {
    expect(label(periodContaining("week", "2026-10-04"))).toBe(
      "week:2026-W40 2026-09-28..2026-10-04",
    );
    expect(label(periodContaining("week", "2027-01-01"))).toBe(
      "week:2026-W53 2026-12-28..2027-01-03",
    );
    expect(label(periodContaining("week", "2025-12-29"))).toBe(
      "week:2026-W01 2025-12-29..2026-01-04",
    );
    expect(label(periodContaining("month", "2027-01-01"))).toBe(
      "month:2027-01 2027-01-01..2027-01-31",
    );
    expect(label(periodContaining("month", "2028-02-29"))).toBe(
      "month:2028-02 2028-02-01..2028-02-29",
    );
    // Kalenderjahr, nicht ISO-Wochenjahr:
    expect(label(periodContaining("year", "2027-01-01"))).toBe("year:2027 2027-01-01..2027-12-31");
  });
});

describe("period: Länge und Tage (kalendarisch, DST-sicher)", () => {
  it.each([
    [monthPeriod(2026, 1), 28],
    [monthPeriod(2027, 1), 28],
    [monthPeriod(2028, 1), 29],
    [monthPeriod(2026, 3), 30],
    [monthPeriod(2026, 8), 30],
    [monthPeriod(2026, 9), 31],
    [monthPeriod(2026, 2), 31],
    [monthPeriod(2026, 11), 31],
    [yearPeriod(2026), 365],
    [yearPeriod(2028), 366],
    [weekPeriod(2026, 43), 7],
    [weekPeriod(2026, 13), 7],
    [weekPeriod(2026, 53), 7],
  ] as const)("%# %o → %i Tage", (p, n) => {
    const days = daysInPeriod(p);
    expect(periodLength(p)).toBe(n);
    expect(days).toHaveLength(n);
    expect(new Set(days).size).toBe(n);
    expect(days[0]).toBe(p.start);
    expect(days[n - 1]).toBe(p.end);
  });

  it("Oktober 2026 (Zeitumstellung 25.10.) enthält 25. und 26.10. je genau einmal", () => {
    const days = daysInPeriod(monthPeriod(2026, 9));
    expect(days.slice(23, 27)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  });

  it("Woche über die Zeitumstellung: Mo–So ohne Lücke/Dopplung", () => {
    const days = daysInPeriod(periodContaining("week", "2026-10-25"));
    expect(days).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    expect(days.map(isoWeekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("periodContains inklusive Grenzen", () => {
    const w = weekPeriod(2026, 53);
    expect(periodContains(w, "2026-12-28")).toBe(true);
    expect(periodContains(w, "2027-01-03")).toBe(true);
    expect(periodContains(w, "2027-01-04")).toBe(false);
    expect(periodContains(w, "2026-12-27")).toBe(false);
    expect(periodContains(yearPeriod(2026), "2027-01-01")).toBe(false);
    expect(periodContains(yearPeriod(2027), "2027-01-01")).toBe(true);
  });
});

describe("period: vor / zurück", () => {
  it("Woche: KW 52/2026 → KW 53/2026 → KW 1/2027 (KW 53 nicht übersprungen)", () => {
    const w52 = weekPeriod(2026, 52);
    const w53 = nextPeriod(w52);
    expect(periodKey(w53)).toBe("2026-W53");
    expect(periodKey(nextPeriod(w53))).toBe("2027-W01");
    expect(periodKey(prevPeriod(weekPeriod(2027, 1)))).toBe("2026-W53");
    expect(periodKey(prevPeriod(weekPeriod(2026, 1)))).toBe("2025-W52");
    expect(periodKey(prevPeriod(weekPeriod(2028, 1)))).toBe("2027-W52");
  });

  it("Monat: Dez 2026 → Jan 2027, Jan 2027 → Dez 2026, Mär 2026 → Feb 2026", () => {
    expect(periodKey(nextPeriod(monthPeriod(2026, 11)))).toBe("2027-01");
    expect(periodKey(prevPeriod(monthPeriod(2027, 0)))).toBe("2026-12");
    expect(periodKey(prevPeriod(monthPeriod(2026, 2)))).toBe("2026-02");
    expect(periodKey(shiftPeriod(monthPeriod(2026, 8), -21))).toBe("2024-12");
    expect(periodKey(shiftPeriod(monthPeriod(2026, 8), 16))).toBe("2028-01");
  });

  it("Jahr: 2026 → 2025 / 2027", () => {
    expect(periodKey(prevPeriod(yearPeriod(2026)))).toBe("2025");
    expect(periodKey(nextPeriod(yearPeriod(2026)))).toBe("2027");
  });

  it("20× vor und 20× zurück ergibt wieder denselben Zeitraum", () => {
    for (const start of [
      weekPeriod(2026, 40),
      monthPeriod(2026, 9),
      yearPeriod(2026),
    ] as Period[]) {
      let p: Period = start;
      for (let i = 0; i < 20; i++) p = nextPeriod(p);
      for (let i = 0; i < 20; i++) p = prevPeriod(p);
      expect(isSamePeriod(p, start)).toBe(true);
      expect(p).toEqual(start);
    }
  });

  it("aufeinanderfolgende Wochen über 2025–2029 sind lückenlos", () => {
    let p: Period = weekPeriod(2025, 1);
    let count = 0;
    while (periodKey(p) !== "2030-W01") {
      const next: Period = nextPeriod(p);
      expect(next.start > p.end).toBe(true);
      expect(daysInPeriod(p)).toHaveLength(7);
      expect(isoWeekday(p.start)).toBe(1);
      p = next;
      count++;
    }
    // 2025: 52, 2026: 53, 2027: 52, 2028: 52, 2029: 52 → 261 Wochen
    expect(count).toBe(261);
  });

  it("shiftPeriod verlangt ganzzahlige Schritte", () => {
    expect(() => shiftPeriod(monthPeriod(2026, 0), 0.5)).toThrow(RangeError);
  });
});

describe("period: Schlüssel", () => {
  it("periodKey / parsePeriodKey Round-Trip", () => {
    for (const p of [
      weekPeriod(2026, 53),
      weekPeriod(2027, 1),
      monthPeriod(2026, 0),
      monthPeriod(2028, 1),
      yearPeriod(2026),
    ] as Period[]) {
      expect(parsePeriodKey(periodKey(p))).toEqual(p);
    }
  });

  it("ungültige Schlüssel → null", () => {
    for (const bad of ["2026-W99", "2027-W53", "2026-13", "2026-00", "26", "", "abc", "2026-9"]) {
      expect(parsePeriodKey(bad), bad).toBeNull();
    }
  });
});

describe("period: laufender Zeitraum und Vergleich (gleiche Anzahl vergangener Tage)", () => {
  const TODAY = "2026-10-04";

  it("elapsedDays / elapsedRange / periodStatus", () => {
    expect(elapsedDays(monthPeriod(2026, 9), TODAY)).toBe(4);
    expect(elapsedRange(monthPeriod(2026, 9), TODAY)).toEqual({
      start: "2026-10-01",
      end: "2026-10-04",
    });
    expect(elapsedDays(monthPeriod(2026, 8), TODAY)).toBe(30);
    expect(elapsedDays(monthPeriod(2026, 10), TODAY)).toBe(0);
    expect(elapsedRange(monthPeriod(2026, 10), TODAY)).toBeNull();
    expect(elapsedDays(weekPeriod(2026, 40), TODAY)).toBe(7);
    expect(elapsedDays(yearPeriod(2026), TODAY)).toBe(277);
    expect(periodStatus(monthPeriod(2026, 9), TODAY)).toBe("running");
    expect(periodStatus(monthPeriod(2026, 8), TODAY)).toBe("past");
    expect(periodStatus(monthPeriod(2026, 10), TODAY)).toBe("future");
    expect(periodStatus(weekPeriod(2026, 40), TODAY)).toBe("running");
    expect(periodStatus(weekPeriod(2026, 40), "2026-09-28")).toBe("running");
  });

  it("Okt 2026 (laufend, 04.10.) → 01.–04.10. vs. 01.–04.09.", () => {
    const w = comparisonWindow(monthPeriod(2026, 9), TODAY);
    expect(w).toMatchObject({
      status: "running",
      current: { start: "2026-10-01", end: "2026-10-04" },
      previous: { start: "2026-09-01", end: "2026-09-04" },
      days: 4,
      previousDays: 4,
      clamped: false,
    });
    expect(periodKey(w.previousPeriod)).toBe("2026-09");
  });

  it("KW 40/2026 am Sonntag 04.10.: volle 7 Tage vs. KW 39", () => {
    const w = comparisonWindow(weekPeriod(2026, 40), TODAY);
    expect(w.current).toEqual({ start: "2026-09-28", end: "2026-10-04" });
    expect(w.previous).toEqual({ start: "2026-09-21", end: "2026-09-27" });
    expect(w.days).toBe(7);
  });

  it("KW 1/2027 am Mittwoch → Mo–Mi vs. Mo–Mi KW 53/2026", () => {
    const w = comparisonWindow(weekPeriod(2027, 1), "2027-01-06");
    expect(w.current).toEqual({ start: "2027-01-04", end: "2027-01-06" });
    expect(w.previous).toEqual({ start: "2026-12-28", end: "2026-12-30" });
    expect(periodKey(w.previousPeriod)).toBe("2026-W53");
  });

  it("Jahr 2026 am 04.10. → 277 Tage vs. 01.01.–04.10.2025", () => {
    const w = comparisonWindow(yearPeriod(2026), TODAY);
    expect(w.current).toEqual({ start: "2026-01-01", end: "2026-10-04" });
    expect(w.previous).toEqual({ start: "2025-01-01", end: "2025-10-04" });
    expect(w.days).toBe(277);
  });

  it("Kappung: 31.03. vs. Februar (28 Tage), 30.03.2028 vs. Feb 2028 (29), 31.12.2028 vs. 2027", () => {
    const mar = comparisonWindow(monthPeriod(2026, 2), "2026-03-31");
    expect(mar.status).toBe("running");
    expect(mar.previous).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(mar).toMatchObject({ days: 31, previousDays: 28, clamped: true });
    const mar28 = comparisonWindow(monthPeriod(2028, 2), "2028-03-30");
    expect(mar28.previous).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(mar28.clamped).toBe(true);
    const y = comparisonWindow(yearPeriod(2028), "2028-12-31");
    expect(y).toMatchObject({ days: 366, previousDays: 365, clamped: true });
    expect(y.previous).toEqual({ start: "2027-01-01", end: "2027-12-31" });
    const mar15 = comparisonWindow(monthPeriod(2026, 2), "2026-03-15");
    expect(mar15.previous).toEqual({ start: "2026-02-01", end: "2026-02-15" });
    expect(mar15.clamped).toBe(false);
  });

  it("abgeschlossener Zeitraum: kompletter Vergleich; zukünftiger: kein Vergleich", () => {
    const past = comparisonWindow(monthPeriod(2026, 8), TODAY);
    expect(past).toMatchObject({
      status: "past",
      current: { start: "2026-09-01", end: "2026-09-30" },
      previous: { start: "2026-08-01", end: "2026-08-31" },
      days: 30,
      previousDays: 31,
      clamped: false,
    });
    const future = comparisonWindow(monthPeriod(2026, 10), TODAY);
    expect(future).toMatchObject({
      status: "future",
      current: null,
      previous: null,
      days: 0,
      previousDays: 0,
    });
    expect(periodKey(future.previousPeriod)).toBe("2026-10");
  });

  it("erster Tag eines laufenden Zeitraums → 1 Tag vs. 1 Tag", () => {
    const w = comparisonWindow(monthPeriod(2027, 0), "2027-01-01");
    expect(w.current).toEqual({ start: "2027-01-01", end: "2027-01-01" });
    expect(w.previous).toEqual({ start: "2026-12-01", end: "2026-12-01" });
  });
});

describe("period: Teil-Zeiträume", () => {
  it("September 2026 → ISO-Wochen KW 36–40, auf den Monat gekappt", () => {
    const parts = subPeriods(monthPeriod(2026, 8), "week");
    expect(parts.map((p) => periodKey(p.period))).toEqual([
      "2026-W36",
      "2026-W37",
      "2026-W38",
      "2026-W39",
      "2026-W40",
    ]);
    expect(parts[0]).toMatchObject({
      clipped: { start: "2026-09-01", end: "2026-09-06" },
      partial: true,
    });
    expect(parts[0]!.period.start).toBe("2026-08-31");
    expect(parts[4]).toMatchObject({
      clipped: { start: "2026-09-28", end: "2026-09-30" },
      partial: true,
    });
    expect(parts[1]!.partial).toBe(false);
    const total = parts.reduce((a, p) => a + daysInPeriod({ ...p.period, ...p.clipped }).length, 0);
    expect(total).toBe(30);
  });

  it("Jahr 2026 → 12 Monate bzw. 53 Wochen (KW 1 und KW 53 gekappt)", () => {
    const months = subPeriods(yearPeriod(2026), "month");
    expect(months).toHaveLength(12);
    expect(months.every((m) => !m.partial)).toBe(true);
    const weeks = subPeriods(yearPeriod(2026), "week");
    expect(weeks).toHaveLength(53);
    expect(weeks[0]).toMatchObject({ clipped: { start: "2026-01-01", end: "2026-01-04" } });
    expect(weeks[52]).toMatchObject({ clipped: { start: "2026-12-28", end: "2026-12-31" } });
  });

  it("Jahr 2027 → beginnt mit KW 53/2026 (gekappt)", () => {
    const weeks = subPeriods(yearPeriod(2027), "week");
    expect(periodKey(weeks[0]!.period)).toBe("2026-W53");
    expect(weeks[0]!.clipped).toEqual({ start: "2027-01-01", end: "2027-01-03" });
    expect(periodKey(weeks.at(-1)!.period)).toBe("2027-W52");
  });

  it("KW 53/2026 → Monate Dez 2026 + Jan 2027", () => {
    const parts = subPeriods(weekPeriod(2026, 53), "month");
    expect(parts.map((p) => [periodKey(p.period), p.clipped.start, p.clipped.end])).toEqual([
      ["2026-12", "2026-12-28", "2026-12-31"],
      ["2027-01", "2027-01-01", "2027-01-03"],
    ]);
  });

  it("leerer Bereich → keine Teile", () => {
    expect(subPeriods({ start: "2026-10-05", end: "2026-10-04" }, "week")).toEqual([]);
  });
});
