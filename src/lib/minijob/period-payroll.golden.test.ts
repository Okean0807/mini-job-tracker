/**
 * Golden-Tests: Perioden-Aggregation über die BESTEHENDE Payroll (unverändert).
 * Werte = Statistik-Analyse / QA_ACCEPTANCE.md §4 (F1, F2, F3), main 7f025af.
 */
import { describe, expect, it } from "vitest";

import { shiftsInMonth, shiftsInYear } from "./calc";
import { comparisonWindow, monthPeriod, weekPeriod, yearPeriod } from "./period";
import {
  aggregateRange,
  bucketByDay,
  bucketBySubPeriod,
  compareValues,
  countWorkDays,
  groupBy,
} from "./period-aggregate";
import {
  PAYROLL_VALUE_FIELDS,
  evaluateShifts,
  payrollAggregateOptions,
  payrollValues,
} from "./period-payroll";
import { payrollTotals, shiftPayroll } from "./payroll";
import { makeResolver } from "./resolve";
import { DEFAULT_SETTINGS, type Shift } from "./types";
import {
  F1_JOBS,
  F1_OBJECTS,
  F1_SHIFTS,
  F1_TODAY,
  F2_SHIFTS,
  F3_SHIFTS,
} from "./__fixtures__/stats-periods";

const settings = { ...DEFAULT_SETTINGS };
const resolve = makeResolver(F1_JOBS, settings);
const evaluated = evaluateShifts(F1_SHIFTS, resolve, F1_SHIFTS);
const opts = payrollAggregateOptions();
const close = (actual: number, expected: number, digits = 4) =>
  expect(actual).toBeCloseTo(expected, digits);
const byId = (id: string) => evaluated.find((e) => e.shift.id === id)!;

describe("F1: bestehende Payroll-Werte bleiben erhalten (September 2026)", () => {
  it("Sep 2026 = 822,32 € / 49,00 h worked / 8,36 h bezahlte Abwesenheit / 15 Einträge", () => {
    const sep = aggregateRange(monthPeriod(2026, 8), evaluated, opts);
    expect(sep.count).toBe(15);
    close(sep.values.earnings, 822.3214);
    close(sep.values.workEarnings, 703.5);
    close(sep.values.absenceEarnings, 118.8214);
    close(sep.values.workedHours, 49);
    close(sep.values.paidAbsenceHours, 8.3571);
    expect(sep.values.estimatedEntries).toBe(0);
    expect(sep.values.paidAbsenceEntries).toBe(2);
    expect(sep.values.unpaidAbsenceEntries).toBe(1);
    expect(Math.round(sep.values.earnings * 100) / 100).toBe(822.32);
  });

  it("Σ payrollValues = payrollTotals(periodShifts, resolve, allShifts) (gleiche Quelle)", () => {
    for (const [y, m] of [
      [2026, 7],
      [2026, 8],
      [2026, 9],
    ] as const) {
      const list = shiftsInMonth(F1_SHIFTS, y, m);
      const t = payrollTotals(list, resolve, F1_SHIFTS);
      const b = aggregateRange(monthPeriod(y, m), evaluated, opts);
      close(b.values.earnings, t.earnings, 9);
      close(b.values.workEarnings, t.workEarnings, 9);
      close(b.values.absenceEarnings, t.absenceEarnings, 9);
      close(b.values.workedHours, t.workedHours, 9);
      close(b.values.paidAbsenceHours, t.paidAbsenceHours, 9);
      expect(b.values.estimatedEntries > 0).toBe(t.estimated);
    }
  });

  it("Urlaub 15.09: 58,82 € / 4,36 h bezahlt / 0 h worked (13-Wochen-Schnitt)", () => {
    const e = byId("s8");
    expect(e.payroll.kind).toBe("urlaub");
    expect(e.payroll.reason).toBe("vacation-pay");
    expect(e.payroll.basis).toBe("average13");
    expect(e.payroll.estimated).toBe(false);
    close(e.payroll.earnings, 58.8214);
    close(e.payroll.paidAbsenceHours, 4.3571);
    expect(e.payroll.workedHours).toBe(0);
    expect(payrollValues(e.payroll)).toMatchObject({ workEarnings: 0, paidAbsenceEntries: 1 });
  });

  it("Krank 21.09: 60,00 € / 4,00 h bezahlt (Plan)", () => {
    const e = byId("s16");
    expect(e.payroll).toMatchObject({ kind: "krank", reason: "sick-pay", basis: "plan" });
    close(e.payroll.earnings, 60);
    close(e.payroll.paidAbsenceHours, 4);
    expect(e.payroll.workedHours).toBe(0);
  });

  it("Frei 26.09: 0 € / 0 h (unbezahlt)", () => {
    const e = byId("s10");
    expect(e.payroll).toMatchObject({ kind: "frei", reason: "unpaid-absence", paid: false });
    expect(e.payroll.earnings).toBe(0);
    expect(e.payroll.paidAbsenceHours).toBe(0);
    expect(e.payroll.workedHours).toBe(0);
    expect(payrollValues(e.payroll).unpaidAbsenceEntries).toBe(1);
  });

  it("Adapter nutzt die volle Historie (nicht die Periode – vgl. B2: 817,50 €)", () => {
    const sepShifts = shiftsInMonth(F1_SHIFTS, 2026, 8);
    const periodOnly = evaluateShifts(sepShifts, resolve, sepShifts);
    const wrong = aggregateRange(monthPeriod(2026, 8), periodOnly, opts);
    close(wrong.values.earnings, 817.5);
    const right = aggregateRange(monthPeriod(2026, 8), evaluated, opts);
    close(right.values.earnings, 822.3214);
  });

  it("Bewertung identisch zum direkten shiftPayroll-Aufruf mit voller Historie", () => {
    for (const e of evaluated) {
      expect(e.payroll).toEqual(shiftPayroll(e.shift, { ...resolve(e.shift), history: F1_SHIFTS }));
    }
  });
});

describe("F1: ISO-Wochen (nicht an Monatsgrenzen abgeschnitten)", () => {
  it.each([
    [36, 188.25, 13.5, 0],
    [37, 243, 17, 0],
    [38, 211.0714, 10.5, 4.3571],
    [39, 120, 4, 4],
    [40, 201, 14, 0],
  ] as const)("KW %i/2026 = %f € / %f h worked / %f h paidAbsence", (w, eur, h, abs) => {
    const b = aggregateRange(weekPeriod(2026, w), evaluated, opts);
    close(b.values.earnings, eur);
    close(b.values.workedHours, h);
    close(b.values.paidAbsenceHours, abs);
  });

  it("KW 40/2026 = 4 Einträge (28.09.–04.10.), nicht 60 € / 4 h wie bei Monatsschnitt", () => {
    const b = aggregateRange(weekPeriod(2026, 40), evaluated, opts);
    expect(b.count).toBe(4);
  });

  it("Σ auf September gekappter Wochen = September (822,32 € / 49 h)", () => {
    const weeks = bucketBySubPeriod(monthPeriod(2026, 8), "week", evaluated, opts);
    expect(weeks).toHaveLength(5);
    close(weeks[4]!.values.earnings, 60);
    close(weeks[4]!.values.workedHours, 4);
    close(
      weeks.reduce((s, w) => s + w.values.earnings, 0),
      822.3214,
    );
    close(
      weeks.reduce((s, w) => s + w.values.workedHours, 0),
      49,
    );
  });

  it("Tagesreihe Sep auf Payroll-Basis: Σ = 822,32 € / 49 h; 15.09 58,82 € / 0 h; 26.09 0 €", () => {
    const days = bucketByDay(monthPeriod(2026, 8), evaluated, opts);
    expect(days).toHaveLength(30);
    close(
      days.reduce((s, d) => s + d.values.earnings, 0),
      822.3214,
    );
    close(
      days.reduce((s, d) => s + d.values.workedHours, 0),
      49,
    );
    close(days[14]!.values.earnings, 58.8214);
    expect(days[14]!.values.workedHours).toBe(0);
    close(days[20]!.values.earnings, 60);
    expect(days[20]!.values.workedHours).toBe(0);
    expect(days[25]!.values.earnings).toBe(0);
    expect(days[25]!.count).toBe(1);
  });
});

describe("F1: Monate, Jahr, Jobs, Objekte", () => {
  it("Aug 175,50 € / 13 h; Okt gesamt 255 € / 18 h (5, inkl. geplant); Okt bis heute 141 € / 10 h (3)", () => {
    const aug = aggregateRange(monthPeriod(2026, 7), evaluated, opts);
    close(aug.values.earnings, 175.5);
    close(aug.values.workedHours, 13);
    const oct = aggregateRange(monthPeriod(2026, 9), evaluated, payrollAggregateOptions(F1_TODAY));
    expect(oct.count).toBe(5);
    close(oct.values.earnings, 255);
    close(oct.values.workedHours, 18);
    expect(oct.planned!.count).toBe(2);
    close(oct.planned!.values.earnings, 114);
    close(oct.values.earnings - oct.planned!.values.earnings, 141);
    const toDate = aggregateRange({ start: "2026-10-01", end: F1_TODAY }, evaluated, opts);
    expect(toDate.count).toBe(3);
    close(toDate.values.earnings, 141);
    close(toDate.values.workedHours, 10);
  });

  it("Jahr 2026 = 1.252,82 € / 80 h / 8,36 h / 23 Einträge = Σ 12 Monate", () => {
    const year = aggregateRange(yearPeriod(2026), evaluated, opts);
    expect(year.count).toBe(23);
    close(year.values.earnings, 1252.8214);
    close(year.values.workedHours, 80);
    close(year.values.paidAbsenceHours, 8.3571);
    const months = bucketBySubPeriod(yearPeriod(2026), "month", evaluated, opts);
    expect(months).toHaveLength(12);
    close(
      months.reduce((s, m) => s + m.values.earnings, 0),
      year.values.earnings,
      9,
    );
    close(months[8]!.values.earnings, 822.3214);
    close(months[9]!.values.earnings, 255);
    expect(months[6]!.count).toBe(0);
    const t = payrollTotals(shiftsInYear(F1_SHIFTS, 2026), resolve, F1_SHIFTS);
    close(year.values.earnings, t.earnings, 9);
  });

  it("Jobs: Sep J1 342,32 € / 21 h, J2 480 € / 28 h; Jahr J1 652,82 € / 44 h, J2 600 € / 36 h", () => {
    const key = (e: (typeof evaluated)[number]) => e.shift.jobId ?? "none";
    const sep = groupBy(evaluated, key, { ...opts, range: monthPeriod(2026, 8) });
    const sepMap = Object.fromEntries(sep.map((g) => [g.key, g]));
    close(sepMap["J1"]!.values.earnings, 342.3214);
    close(sepMap["J1"]!.values.workedHours, 21);
    expect(sepMap["J1"]!.count).toBe(7);
    close(sepMap["J2"]!.values.earnings, 480);
    close(sepMap["J2"]!.values.workedHours, 28);
    expect(sepMap["J2"]!.count).toBe(8);
    const year = Object.fromEntries(
      groupBy(evaluated, key, { ...opts, range: yearPeriod(2026) }).map((g) => [g.key, g]),
    );
    close(year["J1"]!.values.earnings, 652.8214);
    close(year["J1"]!.values.workedHours, 44);
    close(year["J2"]!.values.earnings, 600);
    close(year["J2"]!.values.workedHours, 36);
  });

  it("Job-Filter: Werte mit voller Historie (342,32 €, nicht 337,50 €)", () => {
    const j1 = evaluated.filter((e) => e.shift.jobId === "J1");
    close(aggregateRange(monthPeriod(2026, 8), j1, opts).values.earnings, 342.3214);
  });

  it("Objekte Sep: O1 155,25 € / 11,5 h / 3; O2 128,25 € / 9,5 h / 2; ohne 538,82 € / 28 h / 10", () => {
    const groups = groupBy(evaluated, (e) => e.shift.objectId ?? "none", {
      ...opts,
      range: monthPeriod(2026, 8),
    });
    const m = Object.fromEntries(groups.map((g) => [g.key, g]));
    expect(Object.keys(m).sort()).toEqual(["O1", "O2", "none"]);
    expect(F1_OBJECTS.map((o) => o.id)).toEqual(["O1", "O2"]);
    close(m["O1"]!.values.earnings, 155.25);
    close(m["O1"]!.values.workedHours, 11.5);
    expect(m["O1"]!.count).toBe(3);
    close(m["O2"]!.values.earnings, 128.25);
    close(m["O2"]!.values.workedHours, 9.5);
    expect(m["O2"]!.count).toBe(2);
    close(m["none"]!.values.earnings, 538.8214);
    close(m["none"]!.values.workedHours, 28);
    expect(m["none"]!.count).toBe(10);
    close(
      groups.reduce((s, g) => s + g.values.earnings, 0),
      822.3214,
    );
  });

  it("Arbeitstage nur kind = arbeit: 2026 = 20 (nicht 23), Sep = 12", () => {
    expect(countWorkDays(F1_SHIFTS, yearPeriod(2026))).toBe(20);
    expect(countWorkDays(F1_SHIFTS, monthPeriod(2026, 8))).toBe(12);
    expect(new Set(F1_SHIFTS.map((s) => s.date)).size).toBe(23);
  });

  it("alle Payroll-Felder sind summierbar (keine NaN)", () => {
    const year = aggregateRange(yearPeriod(2026), evaluated, opts);
    for (const f of PAYROLL_VALUE_FIELDS) expect(Number.isFinite(year.values[f]), f).toBe(true);
    close(year.values.base + year.values.bonus, year.values.earnings, 9);
  });
});

describe("F1: Vergleiche", () => {
  const sum = (start: string, end: string) => aggregateRange({ start, end }, evaluated, opts);

  it("Sep vs Aug +646,82 € (+368,56 %), Stunden +36 h (+276,92 %)", () => {
    const sep = sum("2026-09-01", "2026-09-30").values;
    const aug = sum("2026-08-01", "2026-08-31").values;
    const e = compareValues(sep.earnings, aug.earnings);
    close(e.delta, 646.8214);
    close(e.percent!, 368.5592);
    const h = compareValues(sep.workedHours, aug.workedHours);
    close(h.delta, 36);
    close(h.percent!, 276.9231);
  });

  it("Okt gesamt vs Sep −567,32 € (−68,99 %); KW 40 vs 39 +81 € (+67,5 %); KW 39 vs 38 −91,07 € (−43,15 %)", () => {
    const oct = sum("2026-10-01", "2026-10-31").values.earnings;
    const sep = sum("2026-09-01", "2026-09-30").values.earnings;
    close(compareValues(oct, sep).delta, -567.3214);
    close(compareValues(oct, sep).percent!, -68.9902);
    const w = (n: number) => aggregateRange(weekPeriod(2026, n), evaluated, opts).values.earnings;
    expect(compareValues(w(40), w(39)).percent).toBeCloseTo(67.5, 6);
    close(compareValues(w(39), w(38)).delta, -91.0714);
    close(compareValues(w(39), w(38)).percent!, -43.1472);
  });

  it("laufender Monat (today 04.10.): 01.–04.10. 141 € / 10 h vs 01.–04.09. 114 € / 8 h → +27 € (+23,68 %)", () => {
    const win = comparisonWindow(monthPeriod(2026, 9), F1_TODAY);
    const cur = aggregateRange(win.current!, evaluated, opts).values;
    const prev = aggregateRange(win.previous!, evaluated, opts).values;
    close(cur.earnings, 141);
    close(prev.earnings, 114);
    close(cur.workedHours, 10);
    close(prev.workedHours, 8);
    const c = compareValues(cur.earnings, prev.earnings);
    close(c.delta, 27);
    close(c.percent!, 23.6842);
    close(compareValues(cur.workedHours, prev.workedHours).percent!, 25);
  });

  it("Vorperiode 0: Aug vs Jul +175,50 €, Prozent n/a; Jul vs Jun 0 / n/a", () => {
    const aug = sum("2026-08-01", "2026-08-31").values.earnings;
    const jul = sum("2026-07-01", "2026-07-31").values.earnings;
    const jun = sum("2026-06-01", "2026-06-30").values.earnings;
    expect(compareValues(aug, jul)).toMatchObject({ delta: 175.5, percent: null });
    expect(compareValues(jul, jun)).toEqual({ current: 0, previous: 0, delta: 0, percent: null });
  });
});

describe("F2: Jahreswechsel (J1 13,50 €/h)", () => {
  const ev = evaluateShifts(F2_SHIFTS, resolve, F2_SHIFTS);
  const w = (y: number, n: number) => aggregateRange(weekPeriod(y, n), ev, opts);

  it("KW 53/2026 = 31.12.2026 + 01.01.2027 + 03.01.2027 (Nacht) = 11 h / 148,50 €", () => {
    const b = w(2026, 53);
    expect(b.count).toBe(3);
    close(b.values.workedHours, 11);
    close(b.values.earnings, 148.5);
  });

  it("KW 1/2026 4 h / 54 €; KW 1/2027 2 h / 27 €; KW 52/2027 1 h; KW 1/2028 1 h", () => {
    close(w(2026, 1).values.earnings, 54);
    close(w(2026, 1).values.workedHours, 4);
    close(w(2027, 1).values.earnings, 27);
    close(w(2027, 52).values.earnings, 13.5);
    close(w(2028, 1).values.earnings, 13.5);
  });

  it("Monate nach shift.date: Dez 2026 = 54 €, Jan 2027 = 121,50 € (inkl. Nacht 03.01.)", () => {
    close(aggregateRange(monthPeriod(2026, 11), ev, opts).values.earnings, 54);
    close(aggregateRange(monthPeriod(2027, 0), ev, opts).values.earnings, 121.5);
    // Jahr 2027 enthält KW 53/2026 nur anteilig (01.+03.01.):
    const parts = bucketBySubPeriod(yearPeriod(2027), "week", ev, opts);
    close(parts[0]!.values.earnings, 94.5);
    expect(parts[0]!.partial).toBe(true);
  });
});

describe("F3: Zeitumstellung und Nachtschicht", () => {
  const ev = evaluateShifts(F3_SHIFTS, resolve, F3_SHIFTS);

  it("Schichten in der Umstellungsnacht nach Wanduhr: je 2 h / 27 €", () => {
    for (const id of ["d1", "d2"]) {
      const e = ev.find((x) => x.shift.id === id)!;
      close(e.payroll.workedHours, 2);
      close(e.payroll.earnings, 27);
    }
  });

  it("Nachtschicht So 25.10. 22–06 Uhr: 8 h / 108 € vollständig in KW 43 und Oktober, KW 44 = 0", () => {
    const night = ev.find((x) => x.shift.id === "d3")!;
    close(night.payroll.workedHours, 8);
    close(night.payroll.earnings, 108);
    const kw43 = aggregateRange(weekPeriod(2026, 43), ev, opts);
    expect(kw43.count).toBe(2);
    close(kw43.values.earnings, 135);
    expect(aggregateRange(weekPeriod(2026, 44), ev, opts).count).toBe(0);
    const oct = bucketByDay(monthPeriod(2026, 9), ev, opts);
    expect(oct).toHaveLength(31);
    close(oct[24]!.values.workedHours, 10);
    expect(oct[25]!.count).toBe(0);
  });

  it("Woche KW 13 (29.03.) enthält die Frühjahrs-Schicht", () => {
    const kw13 = aggregateRange(weekPeriod(2026, 13), ev, opts);
    expect(kw13.count).toBe(1);
    close(kw13.values.workedHours, 2);
  });
});

describe("Leere Zeiträume über die Payroll", () => {
  it("Jul 2026 / KW 30 / Jahr 2024: 0 € / 0 h", () => {
    for (const r of [monthPeriod(2026, 6), weekPeriod(2026, 30), yearPeriod(2024)]) {
      const b = aggregateRange(r, evaluated, opts);
      expect(b.count).toBe(0);
      expect(b.values.earnings).toBe(0);
      expect(b.values.workedHours).toBe(0);
    }
    expect(evaluateShifts([], resolve, F1_SHIFTS)).toEqual([]);
  });

  it("nur Abwesenheiten (KW 42/2026: Urlaub 13.10. + Frei 15.10.) → 0 h worked, 4 h bezahlt, 54 €", () => {
    const extra: Shift[] = [
      {
        id: "x1",
        jobId: "J1",
        kind: "urlaub",
        date: "2026-10-13",
        start: "17:00",
        end: "21:00",
        breakMinutes: 0,
      },
      {
        id: "x2",
        jobId: "J1",
        kind: "frei",
        date: "2026-10-15",
        start: "10:00",
        end: "13:00",
        breakMinutes: 0,
      },
    ];
    const all = [...F1_SHIFTS, ...extra];
    const ev = evaluateShifts(extra, resolve, all);
    const b = aggregateRange(weekPeriod(2026, 42), ev, opts);
    expect(b.values.workedHours).toBe(0);
    close(b.values.paidAbsenceHours, 4);
    close(b.values.earnings, 54);
    expect(countWorkDays(extra, weekPeriod(2026, 42))).toBe(0);
  });
});
