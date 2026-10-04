import { describe, expect, it } from "vitest";

import { monthPeriod, weekPeriod, yearPeriod } from "./period";
import {
  aggregateRange,
  bucketByDay,
  bucketBySubPeriod,
  compareValues,
  countWorkDays,
  emptyValues,
  groupBy,
  sumValues,
} from "./period-aggregate";
import type { ShiftKind } from "./types";

interface Item {
  date: string;
  group?: string;
  kind?: ShiftKind;
  a: number;
  b?: number;
}

const FIELDS = ["a", "b"] as const;
const opts = {
  getDateKey: (i: Item) => i.date,
  getValues: (i: Item) => ({ a: i.a, ...(i.b !== undefined ? { b: i.b } : {}) }),
  fields: FIELDS,
};

describe("period-aggregate: leere Mengen", () => {
  it("liefert Nullwerte statt NaN / undefined", () => {
    expect(emptyValues(FIELDS)).toEqual({ a: 0, b: 0 });
    expect(sumValues([], opts)).toEqual({ count: 0, values: { a: 0, b: 0 } });
    expect(aggregateRange(monthPeriod(2026, 6), [], opts)).toEqual({
      count: 0,
      values: { a: 0, b: 0 },
    });
    const days = bucketByDay(weekPeriod(2026, 30), [], opts);
    expect(days).toHaveLength(7);
    expect(days.every((d) => d.count === 0 && d.values.a === 0 && d.values.b === 0)).toBe(true);
    expect(groupBy([], (i: Item) => i.group ?? "none", opts)).toEqual([]);
    expect(countWorkDays([])).toBe(0);
  });

  it("Einträge außerhalb des Bereichs werden ignoriert", () => {
    const items: Item[] = [
      { date: "2026-08-31", a: 1 },
      { date: "2026-10-01", a: 2 },
    ];
    expect(aggregateRange(monthPeriod(2026, 8), items, opts).count).toBe(0);
  });
});

describe("period-aggregate: einzelne / mehrere Einträge", () => {
  it("ein Eintrag", () => {
    const items: Item[] = [{ date: "2026-09-15", a: 58.8214, b: 4.3571 }];
    const r = aggregateRange(monthPeriod(2026, 8), items, opts);
    expect(r).toEqual({ count: 1, values: { a: 58.8214, b: 4.3571 } });
    const d = bucketByDay(monthPeriod(2026, 8), items, opts);
    expect(d).toHaveLength(30);
    expect(d[14]).toEqual({ date: "2026-09-15", count: 1, values: { a: 58.8214, b: 4.3571 } });
    expect(d.filter((x) => x.count > 0)).toHaveLength(1);
  });

  it("summiert mehrere Einträge am selben Tag, fehlende Felder = 0, nicht-endliche ignoriert", () => {
    const items: Item[] = [
      { date: "2026-10-25", a: 2 },
      { date: "2026-10-25", a: 8, b: 1 },
      { date: "2026-10-25", a: Number.NaN, b: Number.POSITIVE_INFINITY },
    ];
    const [day] = bucketByDay({ start: "2026-10-25", end: "2026-10-25" }, items, opts);
    expect(day).toEqual({ date: "2026-10-25", count: 3, values: { a: 10, b: 1 } });
  });

  it("summiert ungerundet (Rundung erst bei der Anzeige)", () => {
    const items: Item[] = [
      { date: "2026-09-01", a: 0.1 },
      { date: "2026-09-02", a: 0.2 },
    ];
    expect(aggregateRange(monthPeriod(2026, 8), items, opts).values.a).toBe(0.1 + 0.2);
  });
});

describe("period-aggregate: geplante Einträge bleiben erhalten", () => {
  const items: Item[] = [
    { date: "2026-10-01", a: 60 },
    { date: "2026-10-04", a: 27 },
    { date: "2026-10-06", a: 54 },
    { date: "2026-10-07", a: 60 },
  ];

  it("ohne today: alle Einträge zählen (nichts wird verworfen)", () => {
    const r = aggregateRange(monthPeriod(2026, 9), items, opts);
    expect(r.count).toBe(4);
    expect(r.values.a).toBe(201);
    expect(r.planned).toBeUndefined();
  });

  it("mit today: geplant (> today) zusätzlich ausgewiesen, Gesamtsumme unverändert", () => {
    const withToday = { ...opts, today: "2026-10-04" };
    const r = aggregateRange(monthPeriod(2026, 9), items, withToday);
    expect(r.count).toBe(4);
    expect(r.values.a).toBe(201);
    expect(r.planned).toEqual({ count: 2, values: { a: 114, b: 0 } });
    const days = bucketByDay(monthPeriod(2026, 9), items, withToday);
    expect(days[3]!.planned).toEqual({ count: 0, values: { a: 0, b: 0 } });
    expect(days[5]!.planned).toEqual({ count: 1, values: { a: 54, b: 0 } });
    const weeks = bucketBySubPeriod(monthPeriod(2026, 9), "week", items, withToday);
    expect(weeks.reduce((s, w) => s + (w.planned?.values.a ?? 0), 0)).toBe(114);
    const groups = groupBy(items, () => "all", withToday);
    expect(groups[0]!.planned!.count).toBe(2);
    expect(sumValues(items, withToday).planned!.values.a).toBe(114);
  });
});

describe("period-aggregate: Teil-Zeiträume", () => {
  const items: Item[] = [
    { date: "2026-08-31", a: 1 }, // KW 36, aber August
    { date: "2026-09-01", a: 10 },
    { date: "2026-09-27", a: 20 },
    { date: "2026-09-28", a: 30 },
    { date: "2026-09-30", a: 40 },
    { date: "2026-10-01", a: 50 }, // KW 40, aber Oktober
  ];

  it("Monat → gekappte ISO-Wochen; Σ Wochen = Monat", () => {
    const sep = monthPeriod(2026, 8);
    const weeks = bucketBySubPeriod(sep, "week", items, opts);
    expect(weeks.map((w) => [w.range.start, w.range.end, w.values.a, w.partial])).toEqual([
      ["2026-09-01", "2026-09-06", 10, true],
      ["2026-09-07", "2026-09-13", 0, false],
      ["2026-09-14", "2026-09-20", 0, false],
      ["2026-09-21", "2026-09-27", 20, false],
      ["2026-09-28", "2026-09-30", 70, true],
    ]);
    const sum = weeks.reduce((s, w) => s + w.values.a, 0);
    expect(sum).toBe(aggregateRange(sep, items, opts).values.a);
    // Ungeschnittene Woche über die Monatsgrenze:
    expect(aggregateRange(weekPeriod(2026, 40), items, opts).values.a).toBe(120);
    expect(aggregateRange(weekPeriod(2026, 36), items, opts).values.a).toBe(11);
  });

  it("Jahr → 12 Monate (lückenlos, auch leere Monate)", () => {
    const months = bucketBySubPeriod(yearPeriod(2026), "month", items, opts);
    expect(months).toHaveLength(12);
    expect(months.map((m) => m.values.a)).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 100, 50, 0, 0]);
  });
});

describe("period-aggregate: Gruppen", () => {
  it("Σ Gruppen = Gesamt; Reihenfolge = erstes Auftreten; optional nur im Bereich", () => {
    const items: Item[] = [
      { date: "2026-09-01", group: "O1", a: 1 },
      { date: "2026-09-02", a: 2 },
      { date: "2026-09-03", group: "O2", a: 3 },
      { date: "2026-09-04", group: "O1", a: 4 },
      { date: "2026-10-01", group: "O3", a: 100 },
    ];
    const key = (i: Item) => i.group ?? "none";
    const all = groupBy(items, key, opts);
    expect(all.map((g) => [g.key, g.count, g.values.a])).toEqual([
      ["O1", 2, 5],
      ["none", 1, 2],
      ["O2", 1, 3],
      ["O3", 1, 100],
    ]);
    const sep = groupBy(items, key, { ...opts, range: monthPeriod(2026, 8) });
    expect(sep.map((g) => g.key)).toEqual(["O1", "none", "O2"]);
    expect(sep.reduce((s, g) => s + g.values.a, 0)).toBe(
      aggregateRange(monthPeriod(2026, 8), items, opts).values.a,
    );
  });
});

describe("period-aggregate: Arbeitstage (nur kind = arbeit)", () => {
  const shifts = [
    { date: "2026-09-01", kind: "arbeit" as const },
    { date: "2026-09-01", kind: "arbeit" as const },
    { date: "2026-09-02", kind: "arbeit" as const },
    { date: "2026-09-15", kind: "urlaub" as const },
    { date: "2026-09-21", kind: "krank" as const },
    { date: "2026-09-26", kind: "frei" as const },
    { date: "2026-09-27", kind: "feiertag" as const },
    { date: "2026-09-28", kind: "sonstige" as const },
    { date: "2026-09-29", kind: "urlaub" as const },
    { date: "2026-09-29", kind: "arbeit" as const },
    { date: "2026-10-06", kind: "arbeit" as const },
  ];

  it("zählt eindeutige Tage mit Arbeit; Abwesenheiten sind keine Arbeitstage", () => {
    expect(countWorkDays(shifts)).toBe(4);
    expect(countWorkDays(shifts, monthPeriod(2026, 8))).toBe(3);
    expect(countWorkDays(shifts, { start: "2026-09-02", end: "2026-09-28" })).toBe(1);
    expect(countWorkDays(shifts.filter((s) => s.kind !== "arbeit"))).toBe(0);
  });
});

describe("period-aggregate: Vergleich", () => {
  it("Delta und Prozent; Vorperiode 0 → percent null (kein Infinity/NaN)", () => {
    expect(compareValues(141, 114)).toEqual({
      current: 141,
      previous: 114,
      delta: 27,
      percent: (27 / 114) * 100,
    });
    expect(compareValues(141, 114).percent).toBeCloseTo(23.6842, 4);
    expect(compareValues(175.5, 0)).toEqual({
      current: 175.5,
      previous: 0,
      delta: 175.5,
      percent: null,
    });
    expect(compareValues(0, 0)).toEqual({ current: 0, previous: 0, delta: 0, percent: null });
    expect(compareValues(0, 50).percent).toBe(-100);
    expect(compareValues(10, -20).percent).toBe(150);
  });
});
