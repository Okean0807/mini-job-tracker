/**
 * S3 / B4: Rechtliche Minijob-Jahresgrenze in der Statistik ist unabhängig vom
 * Job-Filter (immer alle geeigneten Minijobs, Klassifikation nur über
 * employmentType). Darstellungswerte bleiben gefiltert.
 */
import { describe, expect, it } from "vitest";

import { buildAnnualReport } from "./annual";
import { yearlyLimitOf, yearUsage } from "./limits";
import { payrollTotals } from "./payroll";
import { makeResolver } from "./resolve";
import { statsLegalYearUsage, withLegalYearLimit } from "./stats-legal";
import { EMPTY_WEEK, type Job, type Shift } from "./types";
import {
  B4_JOBS,
  B4_LEGAL_EARNINGS,
  B4_SETTINGS as settings,
  B4_SHIFTS,
  B4_TODAY,
  HB,
  KF,
  LEGACY,
  MJ_A,
  MJ_B,
  SE,
  SHIFTS_A,
  SHIFTS_B,
  SHIFTS_HB,
  work,
} from "./__fixtures__/stats-legal-limit";

const YEAR = 2026;
const LIMIT = yearlyLimitOf(settings, YEAR);
const resolver = (jobs: Job[]) => makeResolver(jobs, settings);
const resolve = resolver(B4_JOBS);
/** Wie die Statistik-Seite filtert (Darstellung). */
const filterBy = (shifts: Shift[], jobFilter: string) =>
  jobFilter === "alle" ? shifts : shifts.filter((s) => s.jobId === jobFilter);
const legal = (shifts = B4_SHIFTS, res = resolve) =>
  statsLegalYearUsage(shifts, res, settings, YEAR, B4_TODAY);
const legalKpi = (u: ReturnType<typeof legal>) => ({
  earnings: Number(u.earnings.toFixed(2)),
  earningsLimit: u.earningsLimit,
  earningsShare: Number(u.earningsShare.toFixed(4)),
  rounded: Math.round(u.earningsShare),
});

describe("B4 statsLegalYearUsage = yearUsage(alle Einträge)", () => {
  it("delegiert unverändert an yearUsage (keine eigene Berechnung)", () => {
    expect(legal()).toEqual(yearUsage(B4_SHIFTS, resolve, settings, YEAR, B4_TODAY));
  });

  it("ohne Stichtag = yearUsage-Standard (heute)", () => {
    const a = statsLegalYearUsage(B4_SHIFTS, resolve, settings, YEAR);
    const b = yearUsage(B4_SHIFTS, resolve, settings, YEAR);
    expect({ ...a, referenceDate: "" }).toEqual({ ...b, referenceDate: "" });
  });
});

describe("A) zwei Minijobs: Kennzahl identisch ohne Filter / Job A / Job B", () => {
  it("Nutzung = A + B (1.020 €), Grenze = gesetzliche Jahresgrenze, Prozent dieselbe Population", () => {
    const u = legal();
    expect(u.earnings).toBeCloseTo(B4_LEGAL_EARNINGS, 2);
    expect(u.earningsLimit).toBe(LIMIT);
    expect(LIMIT).toBe(7236);
    expect(u.earningsShare).toBeCloseTo((B4_LEGAL_EARNINGS / LIMIT) * 100, 6);
    expect(Math.round(u.earningsShare)).toBe(14);
  });

  it.each(["alle", "MA", "MB", "HB"])(
    "Filter %s: rechtliche Kennzahl unverändert (Seite übergibt immer alle Einträge)",
    (jobFilter) => {
      // Darstellung ist gefiltert …
      const shown = filterBy(B4_SHIFTS, jobFilter);
      expect(shown.length).toBeLessThanOrEqual(B4_SHIFTS.length);
      // … die rechtliche Kennzahl nicht.
      expect(legalKpi(legal(B4_SHIFTS))).toEqual(legalKpi(legal()));
      const report = withLegalYearLimit(
        buildAnnualReport(shown, B4_JOBS, settings, YEAR, resolve),
        legal(),
      );
      expect(report.limit).toBe(LIMIT);
      expect(report.limitShare).toBeCloseTo(legal().earningsShare, 10);
    },
  );

  it("Gegenprobe (alter Fehler): gefilterte Eingabe verkleinert die Kennzahl", () => {
    const onlyA = legal(filterBy(B4_SHIFTS, "MA"));
    const onlyB = legal(filterBy(B4_SHIFTS, "MB"));
    expect(onlyA.earnings).toBeCloseTo(540, 2);
    expect(onlyB.earnings).toBeCloseTo(480, 2);
    expect(onlyA.earningsShare).toBeLessThan(legal().earningsShare);
    expect(Math.round(onlyA.earningsShare)).toBe(7);
  });
});

describe("B) Minijob + Hauptbeschäftigung", () => {
  it("Hauptbeschäftigung zählt nicht zur Grenze; HB-Filter lässt Minijob-Nutzung stehen (nicht 0)", () => {
    const withoutHb = legal([...SHIFTS_A, ...SHIFTS_B]);
    expect(legal().earnings).toBeCloseTo(withoutHb.earnings, 6);
    // Alter Fehler: Filter HB → 0 %.
    expect(legal(filterBy(B4_SHIFTS, "HB")).earnings).toBe(0);
    // Neu: Seite übergibt alle Einträge → Minijob-Nutzung bleibt.
    expect(legal().earnings).toBeGreaterThan(0);
  });

  it("kurzfristig / selbstständig zählen ebenfalls nicht", () => {
    const jobs = [...B4_JOBS, KF, SE];
    const extra = [
      work("KF", "2026-07-01", "08:00", "16:00"),
      work("SE", "2026-07-02", "08:00", "16:00"),
    ];
    expect(legal([...B4_SHIFTS, ...extra], resolver(jobs)).earnings).toBeCloseTo(
      B4_LEGAL_EARNINGS,
      2,
    );
  });
});

describe("C) Darstellungswerte bleiben gefiltert", () => {
  it("Jahresverdienst/Stunden/Jahresbericht ändern sich mit dem Filter, nur limit/limitShare nicht", () => {
    const totals = (jf: string) =>
      payrollTotals(
        filterBy(B4_SHIFTS, jf).filter((s) => s.date.startsWith("2026-")),
        resolve,
        B4_SHIFTS,
      );
    expect(totals("alle").earnings).toBeCloseTo(540 + 54 + 480 + 1600, 2);
    expect(totals("MA").earnings).toBeCloseTo(594, 2);
    expect(totals("MB").earnings).toBeCloseTo(480, 2);
    expect(totals("HB").earnings).toBeCloseTo(1600, 2);

    const reports = ["alle", "MA", "MB", "HB"].map((jf) =>
      withLegalYearLimit(
        buildAnnualReport(filterBy(B4_SHIFTS, jf), B4_JOBS, settings, YEAR, resolve),
        legal(),
      ),
    );
    const earnings = reports.map((r) => Number(r.earnings.toFixed(2)));
    expect(new Set(earnings).size).toBe(4);
    expect(new Set(reports.map((r) => r.hours)).size).toBe(4);
    expect(new Set(reports.map((r) => r.limitShare)).size).toBe(1);
    expect(new Set(reports.map((r) => r.limit)).size).toBe(1);
  });

  it("withLegalYearLimit überschreibt nur limit/limitShare", () => {
    const base = buildAnnualReport(filterBy(B4_SHIFTS, "MA"), B4_JOBS, settings, YEAR, resolve);
    const merged = withLegalYearLimit(base, legal());
    expect({ ...merged, limit: 0, limitShare: 0 }).toEqual({ ...base, limit: 0, limitShare: 0 });
    expect(base.limitShare).toBeLessThan(merged.limitShare); // alter Bericht-Wert war gefiltert
  });
});

describe("D) employmentType ist der einzige Klassifikator (workMode nicht)", () => {
  it("Minijob B im Modus fest/flex: gleiche Eignung und Nutzung", () => {
    const asFlex = resolver([MJ_A, { ...MJ_B, mode: "flex" }, HB]);
    const asFest = resolver([MJ_A, { ...MJ_B, mode: "fest" }, HB]);
    expect(legal(B4_SHIFTS, asFlex).earnings).toBeCloseTo(legal(B4_SHIFTS, asFest).earnings, 6);
    expect(legal(B4_SHIFTS, asFest).earnings).toBeCloseTo(B4_LEGAL_EARNINGS, 2);
  });

  it("Hauptbeschäftigung im Modus fest bleibt ausgeschlossen", () => {
    const res = resolver([MJ_A, MJ_B, { ...HB, mode: "fest", week: EMPTY_WEEK }]);
    expect(legal(B4_SHIFTS, res).earnings).toBeCloseTo(B4_LEGAL_EARNINGS, 2);
  });

  it("employmentType-Wechsel ändert die Eignung", () => {
    const hbAsMinijob = resolver([MJ_A, MJ_B, { ...HB, employmentType: "minijob" }]);
    expect(legal(B4_SHIFTS, hbAsMinijob).earnings).toBeCloseTo(B4_LEGAL_EARNINGS + 1600, 2);
    const bAsHb = resolver([MJ_A, { ...MJ_B, employmentType: "hauptbeschaeftigung" }, HB]);
    expect(legal(B4_SHIFTS, bAsHb).earnings).toBeCloseTo(540, 2);
  });
});

describe("E) kein geeigneter Minijob: bestehendes Verhalten", () => {
  it("nur Hauptbeschäftigung/kurzfristig/selbstständig/Altbestand → 0 €, 0 %, Grenze unverändert", () => {
    const jobs = [HB, KF, SE, LEGACY];
    const res = resolver(jobs);
    const shifts = [
      ...SHIFTS_HB,
      work("KF", "2026-07-01", "08:00", "16:00"),
      work("SE", "2026-07-02", "08:00", "16:00"),
      work("LG", "2026-07-03", "08:00", "16:00"),
    ];
    const u = legal(shifts, res);
    expect(u).toEqual(yearUsage(shifts, res, settings, YEAR, B4_TODAY));
    expect(u.earnings).toBe(0);
    expect(u.earningsShare).toBe(0);
    expect(u.earningsLimit).toBe(LIMIT);
  });

  it("ungeklärter Altbestand (fest ohne employmentType) bleibt wie bisher ausgeschlossen", () => {
    const res = resolver([...B4_JOBS, LEGACY]);
    const shifts = [...B4_SHIFTS, work("LG", "2026-07-03", "08:00", "16:00")];
    expect(legal(shifts, res).earnings).toBeCloseTo(B4_LEGAL_EARNINGS, 2);
  });

  it("keine Einträge → 0 %, wie yearUsage", () => {
    expect(legal([])).toEqual(yearUsage([], resolve, settings, YEAR, B4_TODAY));
  });
});
