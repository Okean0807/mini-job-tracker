/**
 * S2 / B1: Tagesdiagramme der Statistik (Monat) = bestehende Payroll.
 *
 * Datenfluss: `shiftPayroll` (über `evaluateShifts`, volle Historie) →
 * `bucketByDay` (S1) → Diagrammpunkt. Keine zweite Lohnformel.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { shiftEarnings, shiftHours } from "./calc";
import { payrollTotals, shiftPayroll } from "./payroll";
import { aggregateRange } from "./period-aggregate";
import { monthPeriod, weekPeriod } from "./period";
import { evaluateShifts, payrollAggregateOptions } from "./period-payroll";
import { makeResolver } from "./resolve";
import { buildDailyMonthSeries, daysInCalendarMonth, type DailyChartPoint } from "./stats-charts";
import { DEFAULT_SETTINGS, DEFAULT_SUPPLEMENTS, type Job, type Shift } from "./types";
import { F1_JOBS, F1_SHIFTS, F1_TODAY } from "./__fixtures__/stats-periods";
import {
  assertChartGoldens,
  f1Resolve as resolve,
  pointAt,
  sumSeries,
} from "./__fixtures__/stats-chart-goldens";

const pad = (n: number) => String(n).padStart(2, "0");
const inMonth = (list: readonly Shift[], year: number, month0: number) =>
  list.filter((s) => s.date.startsWith(`${year}-${pad(month0 + 1)}-`));
const round2 = (n: number) => Number(n.toFixed(2));

/** Erwartung je Tag direkt aus `shiftPayroll` (volle Historie) – ohne S1-Helfer. */
function expectedFromPayroll(
  list: readonly Shift[],
  date: string,
  history: Shift[],
  res = resolve,
) {
  let earnings = 0;
  let worked = 0;
  for (const s of list.filter((x) => x.date === date)) {
    const p = shiftPayroll(s, { ...res(s), history });
    earnings += p.earnings;
    worked += p.workedHours;
  }
  return { verdienst: round2(earnings), stunden: round2(worked) };
}

/** Prüft die Golden-Werte gegen eine beliebige Reihe (für Mutationstests). */
function goldenFailures(series: readonly DailyChartPoint[]): string[] {
  const fails: string[] = [];
  const sum = sumSeries(series);
  if (sum.verdienst !== 822.32) fails.push(`Σ € ${sum.verdienst}`);
  if (sum.stunden !== 49) fails.push(`Σ h ${sum.stunden}`);
  const u = pointAt(series, "2026-09-15");
  if (u.verdienst !== 58.82 || u.stunden !== 0) fails.push(`Urlaub ${u.verdienst}/${u.stunden}`);
  const k = pointAt(series, "2026-09-21");
  if (k.verdienst !== 60 || k.stunden !== 0) fails.push(`Krank ${k.verdienst}/${k.stunden}`);
  const f = pointAt(series, "2026-09-26");
  if (f.verdienst !== 0 || f.stunden !== 0) fails.push(`Frei ${f.verdienst}/${f.stunden}`);
  return fails;
}

/** Hilfsreihe für Mutanten: gleiches Raster, Werte je Schicht frei wählbar. */
function seriesWith(
  list: readonly Shift[],
  value: (s: Shift) => { verdienst: number; stunden: number },
): DailyChartPoint[] {
  const base = buildDailyMonthSeries(2026, 8, [], resolve, []);
  return base.map((p) => {
    let verdienst = 0;
    let stunden = 0;
    for (const s of list.filter((x) => x.date === p.date)) {
      const v = value(s);
      verdienst += v.verdienst;
      stunden += v.stunden;
    }
    return { ...p, verdienst: round2(verdienst), stunden: round2(stunden) };
  });
}

const SEP = inMonth(F1_SHIFTS, 2026, 8);
const sepSeries = () => buildDailyMonthSeries(2026, 8, SEP, resolve, F1_SHIFTS);

describe("B1 Golden F1 September 2026 (QA AC-C-07)", () => {
  it("Σ Diagramm = Payroll 822,32 € / 49 h (vorher 858 € / 60 h)", () => {
    const sum = sumSeries(sepSeries());
    expect(sum).toEqual({ verdienst: 822.32, stunden: 49 });
    const totals = payrollTotals(SEP, resolve, F1_SHIFTS);
    expect(sum.verdienst).toBeCloseTo(totals.earnings, 2);
    expect(sum.stunden).toBeCloseTo(totals.workedHours, 2);
  });

  it("Urlaub 15.09.: 58,82 € (13-Wochen-Schnitt), 0 h gearbeitet (4,36 h bezahlte Abwesenheit)", () => {
    const p = pointAt(sepSeries(), "2026-09-15");
    expect(p).toMatchObject({ day: 15, tag: "15", verdienst: 58.82, stunden: 0 });
    const urlaub = SEP.find((s) => s.date === "2026-09-15")!;
    const pay = shiftPayroll(urlaub, { ...resolve(urlaub), history: F1_SHIFTS });
    expect(urlaub.kind).toBe("urlaub");
    expect(round2(pay.paidAbsenceHours)).toBe(4.36);
    expect(round2(pay.earnings)).toBe(58.82);
  });

  it("Krank 21.09.: 60,00 €, 0 h gearbeitet", () => {
    expect(pointAt(sepSeries(), "2026-09-21")).toMatchObject({ verdienst: 60, stunden: 0 });
  });

  it("Frei 26.09. (unbezahlt): 0 € / 0 h", () => {
    const frei = SEP.find((s) => s.date === "2026-09-26")!;
    expect(frei.kind).toBe("frei");
    expect(pointAt(sepSeries(), "2026-09-26")).toMatchObject({ verdienst: 0, stunden: 0 });
  });

  it("normale Arbeit: 01.09. 4 h × 13,50 € = 54 €, 19.09. 3,5 h = 47,25 €", () => {
    const s = sepSeries();
    expect(pointAt(s, "2026-09-01")).toMatchObject({ verdienst: 54, stunden: 4 });
    expect(pointAt(s, "2026-09-19")).toMatchObject({ verdienst: 47.25, stunden: 3.5 });
  });

  it("jeder Tag = Σ shiftPayroll dieses Tages (volle Historie); leere Tage = 0", () => {
    const s = sepSeries();
    expect(s).toHaveLength(30);
    for (const p of s) {
      expect({ verdienst: p.verdienst, stunden: p.stunden }).toEqual(
        expectedFromPayroll(SEP, p.date, F1_SHIFTS),
      );
    }
    const withEntries = new Set(SEP.map((x) => x.date));
    const empty = s.filter((p) => !withEntries.has(p.date));
    expect(empty).toHaveLength(30 - withEntries.size);
    expect(empty.every((p) => p.verdienst === 0 && p.stunden === 0)).toBe(true);
  });

  it("Monat ganz in der Zukunft/ohne Daten: nur Nullen, Feb 2026 = 28 Punkte", () => {
    const feb = buildDailyMonthSeries(2026, 1, F1_SHIFTS, resolve, F1_SHIFTS);
    expect(feb).toHaveLength(28);
    expect(feb.every((p) => p.verdienst === 0 && p.stunden === 0)).toBe(true);
  });

  it("ignoriert Einträge außerhalb des Monats (alle Schichten übergeben = nur Sep)", () => {
    expect(buildDailyMonthSeries(2026, 8, F1_SHIFTS, resolve, F1_SHIFTS)).toEqual(sepSeries());
  });
});

describe("B1 Job-Filter: Formel und Historie unverändert", () => {
  const J1 = SEP.filter((s) => s.jobId === "J1");
  const J2 = SEP.filter((s) => s.jobId === "J2");

  it("Café Nord (J1): Σ = payrollTotals(J1, volle Historie) = 342,32 € / 21 h (vorher 378 € / 28 h)", () => {
    const series = buildDailyMonthSeries(2026, 8, J1, resolve, F1_SHIFTS);
    const totals = payrollTotals(J1, resolve, F1_SHIFTS);
    expect(sumSeries(series)).toEqual({ verdienst: 342.32, stunden: 21 });
    expect(sumSeries(series).verdienst).toBeCloseTo(totals.earnings, 2);
    expect(pointAt(series, "2026-09-15").verdienst).toBe(58.82); // Urlaub J1, 13 Wochen über alle Daten
    expect(pointAt(series, "2026-09-21").verdienst).toBe(0); // Krank J2 ausgefiltert
  });

  it("J1 + J2 = alle Jobs, je Tag", () => {
    const all = sepSeries();
    const a = buildDailyMonthSeries(2026, 8, J1, resolve, F1_SHIFTS);
    const b = buildDailyMonthSeries(2026, 8, J2, resolve, F1_SHIFTS);
    all.forEach((p, i) => {
      expect(round2(a[i]!.verdienst + b[i]!.verdienst)).toBeCloseTo(p.verdienst, 2);
      expect(round2(a[i]!.stunden + b[i]!.stunden)).toBeCloseTo(p.stunden, 2);
    });
  });

  it("Büro Plan (J2): Krank 21.09. nach Plan 60 € auch gefiltert", () => {
    const series = buildDailyMonthSeries(2026, 8, J2, resolve, F1_SHIFTS);
    expect(sumSeries(series)).toEqual({ verdienst: 480, stunden: 28 });
    expect(pointAt(series, "2026-09-21")).toMatchObject({ verdienst: 60, stunden: 0 });
  });
});

describe("B1 mehrere Jobs / mehrere Einträge / Zuschläge / geplant", () => {
  it("mehrere Jobs am selben Tag werden summiert (02.09. J2 60 € + J1 54 €)", () => {
    const extra: Shift = {
      id: "x-j1-0209",
      jobId: "J1",
      kind: "arbeit",
      date: "2026-09-02",
      start: "17:00",
      end: "21:00",
      breakMinutes: 0,
    } as Shift;
    const all = [...F1_SHIFTS, extra];
    const series = buildDailyMonthSeries(2026, 8, inMonth(all, 2026, 8), resolve, all);
    expect(pointAt(series, "2026-09-02")).toMatchObject({ verdienst: 114, stunden: 8 });
    expect(sumSeries(series).verdienst).toBeCloseTo(
      payrollTotals(inMonth(all, 2026, 8), resolve, all).earnings,
      2,
    );
  });

  it("Zuschläge bleiben enthalten (Sonntag +50 %, Nacht +25 %) = shiftPayroll.earnings", () => {
    const job: Job = {
      id: "JZ",
      name: "Zuschlag",
      color: "#000000",
      mode: "flex",
      rate: 20,
      employmentType: "minijob",
      startDate: "2026-01-01",
      supplements: {
        ...DEFAULT_SUPPLEMENTS,
        sunday: { enabled: true, mode: "prozent", value: 50 },
        night: { enabled: true, mode: "prozent", value: 25 },
      },
    } as Job;
    const res = makeResolver([job], { ...DEFAULT_SETTINGS });
    const list: Shift[] = [
      // Sonntag 20.09.2026, 10–14 Uhr: 4 h × 20 € + 50 % = 120 €
      {
        id: "z1",
        jobId: "JZ",
        kind: "arbeit",
        date: "2026-09-20",
        start: "10:00",
        end: "14:00",
        breakMinutes: 0,
      },
      // Dienstag 22.09.2026, 22–02 Uhr: 3 h Nacht (23–02) × 25 %
      {
        id: "z2",
        jobId: "JZ",
        kind: "arbeit",
        date: "2026-09-22",
        start: "22:00",
        end: "02:00",
        breakMinutes: 0,
      },
    ] as Shift[];
    const series = buildDailyMonthSeries(2026, 8, list, res, list);
    for (const s of list) {
      const pay = shiftPayroll(s, { ...res(s), history: list });
      expect(pay.bonus).toBeGreaterThan(0);
      const p = pointAt(series, s.date);
      expect(p.verdienst).toBe(round2(pay.earnings));
      expect(p.verdienst).toBeGreaterThan(round2(shiftHours(s) * 20)); // > Dauer × Satz
      expect(p.stunden).toBe(round2(pay.workedHours));
    }
    expect(pointAt(series, "2026-09-20")).toMatchObject({ verdienst: 120, stunden: 4 });
    expect(sumSeries(series).verdienst).toBeCloseTo(payrollTotals(list, res, list).earnings, 2);
  });

  it("geplante Einträge zählen mit (laufender Monat Okt 2026, today = 04.10.: 06./07.10. enthalten)", () => {
    expect(F1_TODAY).toBe("2026-10-04");
    const oct = inMonth(F1_SHIFTS, 2026, 9);
    const series = buildDailyMonthSeries(2026, 9, oct, resolve, F1_SHIFTS);
    expect(series).toHaveLength(31);
    expect(pointAt(series, "2026-10-06")).toMatchObject({ verdienst: 54, stunden: 4 });
    expect(pointAt(series, "2026-10-07")).toMatchObject({ verdienst: 60, stunden: 4 });
    expect(sumSeries(series)).toEqual({ verdienst: 255, stunden: 18 });
    // = Monatskarte (payrollTotals inkl. geplant), = S1-Monatsaggregat ohne today
    expect(sumSeries(series).verdienst).toBeCloseTo(
      payrollTotals(oct, resolve, F1_SHIFTS).earnings,
      2,
    );
  });

  it("mehrere Tage einer Periode: Σ Tage KW 38 (14.–20.09.) = S1-Wochenaggregat", () => {
    const series = sepSeries();
    const week = weekPeriod(2026, 38);
    const days = series.filter((p) => p.date >= week.start && p.date <= week.end);
    expect(days).toHaveLength(7);
    const agg = aggregateRange(
      week,
      evaluateShifts(F1_SHIFTS, resolve, F1_SHIFTS),
      payrollAggregateOptions(),
    );
    expect(sumSeries(days).verdienst).toBeCloseTo(agg.values.earnings, 2);
    expect(sumSeries(days).stunden).toBeCloseTo(agg.values.workedHours, 2);
  });
});

describe("B1 Monats-/Jahresaggregation konsistent mit Jahr-Tab (payrollTotals)", () => {
  it("Σ Tage je Monat = Monatswert des Jahr-Diagramms; Σ Monate = Jahr 1.252,82 € / 80 h", () => {
    let yearEarnings = 0;
    let yearHours = 0;
    for (let m = 0; m < 12; m++) {
      const list = inMonth(F1_SHIFTS, 2026, m);
      const series = buildDailyMonthSeries(2026, m, list, resolve, F1_SHIFTS);
      expect(series).toHaveLength(daysInCalendarMonth(2026, m));
      expect(series[0]!.date).toBe(monthPeriod(2026, m).start);
      expect(series.at(-1)!.date).toBe(monthPeriod(2026, m).end);
      const totals = payrollTotals(list, resolve, F1_SHIFTS);
      const sum = sumSeries(series);
      expect(sum.verdienst).toBeCloseTo(Number(totals.earnings.toFixed(2)), 2);
      expect(sum.stunden).toBeCloseTo(Number(totals.workedHours.toFixed(2)), 2);
      yearEarnings += sum.verdienst;
      yearHours += sum.stunden;
    }
    expect(round2(yearEarnings)).toBe(1252.82);
    expect(round2(yearHours)).toBe(80);
    const year = payrollTotals(
      F1_SHIFTS.filter((s) => s.date.startsWith("2026-")),
      resolve,
      F1_SHIFTS,
    );
    expect(round2(yearEarnings)).toBeCloseTo(year.earnings, 2);
  });
});

describe("B1 Mutations-/Negativtests: Golden-Prüfung erkennt falsche Berechnungen", () => {
  it("echte Reihe besteht alle Golden-Prüfungen", () => {
    expect(goldenFailures(sepSeries())).toEqual([]);
  });

  it("Mutant direkt Dauer × Satz (alter Code) → 858 € / 60 h, schlägt fehl", () => {
    const mutant = seriesWith(SEP, (s) => ({
      verdienst: shiftEarnings(s, resolve(s)),
      stunden: shiftHours(s),
    }));
    expect(sumSeries(mutant)).toEqual({ verdienst: 858, stunden: 60 });
    expect(goldenFailures(mutant).length).toBeGreaterThan(0);
  });

  it("Mutant unvollständige Historie (nur Monat) → 817,50 €, schlägt fehl", () => {
    const mutant = buildDailyMonthSeries(2026, 8, SEP, resolve, SEP);
    expect(sumSeries(mutant).verdienst).toBe(817.5);
    expect(goldenFailures(mutant)).toContain("Σ € 817.5");
  });

  it("Mutant gefilterte Historie (Job-Filter als Historie) → J1-Urlaub weicht ab", () => {
    const J1 = SEP.filter((s) => s.jobId === "J1");
    const good = buildDailyMonthSeries(2026, 8, J1, resolve, F1_SHIFTS);
    const bad = buildDailyMonthSeries(2026, 8, J1, resolve, J1);
    expect(pointAt(good, "2026-09-15").verdienst).toBe(58.82);
    expect(pointAt(bad, "2026-09-15").verdienst).not.toBe(58.82);
  });

  it("Mutant ohne bezahlte Abwesenheit (nur Arbeit) → 703,50 €, schlägt fehl", () => {
    const mutant = seriesWith(SEP, (s) => {
      const p = shiftPayroll(s, { ...resolve(s), history: F1_SHIFTS });
      return { verdienst: s.kind === "arbeit" ? p.earnings : 0, stunden: p.workedHours };
    });
    expect(sumSeries(mutant).verdienst).toBe(703.5);
    expect(goldenFailures(mutant)).toEqual(
      expect.arrayContaining(["Σ € 703.5", "Urlaub 0/0", "Krank 0/0"]),
    );
  });

  it("Mutant Stunden inkl. Abwesenheit (bezahlte Ausfallstunden als Arbeitszeit) schlägt fehl", () => {
    const mutant = seriesWith(SEP, (s) => {
      const p = shiftPayroll(s, { ...resolve(s), history: F1_SHIFTS });
      return { verdienst: p.earnings, stunden: p.workedHours + p.paidAbsenceHours };
    });
    expect(goldenFailures(mutant).length).toBeGreaterThan(0);
  });

  it("Mutant ohne Zuschläge (nur base) weicht bei Zuschlagsjob ab", () => {
    const job = {
      id: "JZ",
      name: "Z",
      color: "#000",
      mode: "flex",
      rate: 20,
      employmentType: "minijob",
      supplements: {
        ...DEFAULT_SUPPLEMENTS,
        sunday: { enabled: true, mode: "prozent", value: 50 },
      },
    } as Job;
    const res = makeResolver([job], { ...DEFAULT_SETTINGS });
    const list = [
      {
        id: "z",
        jobId: "JZ",
        kind: "arbeit",
        date: "2026-09-20",
        start: "10:00",
        end: "14:00",
        breakMinutes: 0,
      },
    ] as Shift[];
    const real = pointAt(buildDailyMonthSeries(2026, 8, list, res, list), "2026-09-20");
    const p = shiftPayroll(list[0]!, { ...res(list[0]!), history: list });
    expect(real.verdienst).toBe(120);
    expect(round2(p.base)).toBe(80);
    expect(real.verdienst).not.toBe(round2(p.base));
  });
});

describe("B1 Quelltext-Wächter", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "stats-charts.ts"), "utf8");
  const start = src.indexOf("export function buildDailyMonthSeries");
  const body = src.slice(start, src.indexOf("\n}\n", start));

  it("buildDailyMonthSeries nutzt Payroll + S1-Helfer, keine eigene Lohnformel", () => {
    expect(start).toBeGreaterThan(0);
    expect(body).toContain("evaluateShifts(");
    expect(body).toContain("bucketByDay(");
    expect(body).toContain("payrollAggregateOptions()");
    expect(body).not.toMatch(/shiftEarnings|shiftHours|shiftBreakdown|\.rate\b|effectiveShiftRate/);
  });

  it("kein new Date('YYYY-MM-DD'), keine +24h-Iteration", () => {
    expect(body).not.toMatch(/new Date\(/);
    expect(src).not.toMatch(/new Date\(\s*["'`]\d{4}-/);
    expect(src).not.toMatch(/86_?400_?000|24 \* 60 \* 60/);
  });

  it("Statistik-Seite übergibt die volle Historie (shifts), nicht den Filter", () => {
    const page = readFileSync(join(here, "../../routes/statistik.tsx"), "utf8");
    expect(page).toMatch(/buildDailyMonthSeries\(year, month, monthShifts, resolve, shifts\)/);
  });
});

describe("B1 Zeitzonen-Matrix (im Prozess)", () => {
  const ORIGINAL_TZ = process.env["TZ"];
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env["TZ"];
    else process.env["TZ"] = ORIGINAL_TZ;
  });

  it.each([
    ["Europe/Berlin", -120, -60],
    ["America/Los_Angeles", 420, 420],
    ["Pacific/Kiritimati", -840, -840],
    ["UTC", 0, 0],
  ] as const)("%s: Golden-Werte + DST 25.10./29.03. identisch", (zone, before, after) => {
    process.env["TZ"] = zone;
    expect(new Date(2026, 9, 25, 0, 30).getTimezoneOffset()).toBe(before);
    expect(new Date(2026, 9, 26, 12).getTimezoneOffset()).toBe(after);
    assertChartGoldens();
  });
});
