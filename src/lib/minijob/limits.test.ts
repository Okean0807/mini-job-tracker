import { describe, expect, it } from "vitest";

import { makeResolver } from "./resolve";
import { DEFAULT_SETTINGS, type Job, type Shift } from "./types";
import { monthUsage, yearlyLimitOf, yearUsage } from "./limits";

const settings = { ...DEFAULT_SETTINGS, limitAuto: true };

const job = (id: string, mode: Job["mode"], rate?: number, employmentType?: Job["employmentType"]): Job => ({
  id,
  name: id,
  color: "#000",
  mode,
  ...(rate !== undefined ? { rate } : {}),
  ...(employmentType !== undefined ? { employmentType } : {}),
});

const shift = (id: string, jobId: string, date: string, hours: number, rate?: number): Shift => ({
  id,
  jobId,
  kind: "arbeit",
  date,
  start: "08:00",
  end: `${String((8 + hours) % 24).padStart(2, "0")}:00`,
  breakMinutes: 0,
  ...(rate !== undefined ? { rate } : {}),
});

describe("Minijob-Grenze filtert nach Beschäftigungsart", () => {
  it("zählt Minijob und ignoriert Hauptbeschäftigung", () => {
    const jobs = [
      job("mini", "flex", 15),
      job("main", "fest", 25, "hauptbeschaeftigung"),
    ];
    const shifts = [
      shift("s1", "mini", "2026-09-10", 20),
      shift("s2", "main", "2026-09-10", 20),
    ];
    const resolve = makeResolver(jobs, settings);
    const usage = monthUsage(shifts, resolve, settings, 2026, 8);

    expect(usage.earnings).toBe(300);
    expect(usage.hours).toBe(20);
    expect(usage.earningsLimit).toBe(603);
    expect(usage.expectedAdditional).toBe(0);
  });

  it("aggregiert mehrere Minijobs gegen eine gemeinsame Einkommensgrenze", () => {
    const jobs = [
      job("mini-a", "flex", 15),
      job("mini-b", "flex", 20),
    ];
    const shifts = [
      shift("a", "mini-a", "2026-09-10", 20),
      shift("b", "mini-b", "2026-09-11", 20),
    ];
    const resolve = makeResolver(jobs, settings);
    const usage = monthUsage(shifts, resolve, settings, 2026, 8);

    expect(usage.earnings).toBe(700);
    expect(usage.earningsLimit).toBe(603);
    // Unterschiedliche Sätze => keine erfundene gemeinsame Stundenobergrenze.
    expect(usage.hoursLimit).toBe(0);
    expect(usage.hoursShare).toBe(0);
  });

  it("respektiert einen expliziten manuellen Stundenwert", () => {
    const manual = { ...settings, hoursLimitAuto: false, hoursLimitMonthly: 30 };
    const jobs = [job("mini", "flex", 15)];
    const shifts = [shift("s1", "mini", "2026-09-10", 20)];
    const resolve = makeResolver(jobs, manual);
    expect(monthUsage(shifts, resolve, manual, 2026, 8).hoursLimit).toBe(30);
  });

  it("ignoriert einen beendeten Job nach endDate", () => {
    const jobs = [job("mini", "flex", 15)];
    jobs[0]!.startDate = "2026-01-01";
    jobs[0]!.endDate = "2026-08-31";
    const shifts = [shift("s1", "mini", "2026-09-10", 20)];
    const resolve = makeResolver(jobs, settings);
    expect(monthUsage(shifts, resolve, settings, 2026, 8).earnings).toBe(0);
  });

  it("berechnet den Jahreswert nur aus eligible Minijob-Schichten", () => {
    const jobs = [job("mini", "flex", 15), job("main", "fest", 30, "hauptbeschaeftigung")];
    const shifts = [
      shift("s1", "mini", "2026-01-10", 20),
      shift("s2", "main", "2026-01-10", 20),
    ];
    const resolve = makeResolver(jobs, settings);
    expect(yearUsage(shifts, resolve, settings, 2026).earnings).toBe(300);
    expect(yearUsage(shifts, resolve, settings, 2026).earningsLimit).toBe(7236);
  });
  it("zählt zukünftige Schichten nicht als tatsächliches Limit-Einkommen", () => {
    const jobs = [job("mini", "flex", 15)];
    const shifts = [
      shift("past", "mini", "2026-09-10", 20),
      shift("future", "mini", "2026-09-30", 20),
    ];
    const resolve = makeResolver(jobs, settings);
    const usage = monthUsage(shifts, resolve, settings, 2026, 8, "2026-09-29");

    expect(usage.earnings).toBe(300);
    expect(usage.expectedAdditional).toBe(300);
    expect(usage.projectedEarnings).toBe(600);
    expect(usage.hours).toBe(20);
    expect(usage.referenceDate).toBe("2026-09-29");
  });

});

describe("Planungsmodus (fest/flex) ist unabhängig von der Beschäftigungsart", () => {
  const month = (jobs: Job[], shifts: Shift[]) =>
    monthUsage(shifts, makeResolver(jobs, settings), settings, 2026, 8, "2026-09-30");

  it("A: fest + Minijob → zählt zur Minijob-Grenze", () => {
    const jobs = [job("a", "fest", 15, "minijob")];
    expect(month(jobs, [shift("s", "a", "2026-09-10", 10)]).earnings).toBe(150);
  });

  it("A (Altbestand): flex ohne employmentType → Minijob, zählt zur Grenze", () => {
    const jobs = [job("a", "flex", 15)];
    expect(month(jobs, [shift("s", "a", "2026-09-10", 10)]).earnings).toBe(150);
  });

  it("B (Altbestand): fest ohne employmentType → ungeklärt, nicht in Monats-/Jahresgrenze", () => {
    const jobs = [job("legacy", "fest", 20)];
    // 50 h × 20 € = 1000 € – wäre als Minijob klar „über der Monatsgrenze“.
    const shifts = [
      shift("s1", "legacy", "2026-09-10", 10),
      shift("s2", "legacy", "2026-09-11", 10),
      shift("s3", "legacy", "2026-09-12", 10),
      shift("s4", "legacy", "2026-09-14", 10),
      shift("s5", "legacy", "2026-09-15", 10),
    ];
    const usage = month(jobs, shifts);
    expect(usage.earnings).toBe(0);
    expect(usage.hours).toBe(0);
    expect(usage.share).toBe(0);
    const year = yearUsage(shifts, makeResolver(jobs, settings), settings, 2026, "2026-09-30");
    expect(year.earnings).toBe(0);
    expect(year.share).toBe(0);
  });

  it("B: ungeklärter Altbestand fest + echter Minijob → nur der Minijob zählt", () => {
    const jobs = [job("legacy", "fest", 20), job("mini", "flex", 15)];
    const shifts = [shift("l", "legacy", "2026-09-10", 10), shift("m", "mini", "2026-09-11", 10)];
    expect(month(jobs, shifts).earnings).toBe(150);
  });

  it("I: nur den Planungsmodus ändern ändert die Minijob-Summe nicht (explizite Art)", () => {
    for (const employmentType of ["minijob", "hauptbeschaeftigung", "kurzfristig"] as const) {
      const shifts = [shift("s", "x", "2026-09-10", 10)];
      const flex = month([job("x", "flex", 15, employmentType)], shifts);
      const fest = month([job("x", "fest", 15, employmentType)], shifts);
      expect(fest.earnings).toBe(flex.earnings);
      expect(fest.share).toBe(flex.share);
    }
  });

  it("B: flex + Minijob → zählt zur Minijob-Grenze", () => {
    const jobs = [job("b", "flex", 15, "minijob")];
    expect(month(jobs, [shift("s", "b", "2026-09-10", 10)]).earnings).toBe(150);
  });

  it("C: fest + Hauptbeschäftigung → kein Minijob", () => {
    const jobs = [job("c", "fest", 25, "hauptbeschaeftigung")];
    const usage = month(jobs, [shift("s", "c", "2026-09-10", 10)]);
    expect(usage.earnings).toBe(0);
    expect(usage.hours).toBe(0);
  });

  it("D: flex + Hauptbeschäftigung → kein Minijob", () => {
    const jobs = [job("d", "flex", 25, "hauptbeschaeftigung")];
    const usage = month(jobs, [shift("s", "d", "2026-09-10", 10)]);
    expect(usage.earnings).toBe(0);
    expect(usage.hours).toBe(0);
  });

  it("E: Hauptbeschäftigung + ein Minijob → Minijob wird separat bewertet", () => {
    for (const [mainMode, miniMode] of [
      ["fest", "flex"],
      ["flex", "fest"],
    ] as const) {
      const jobs = [
        job("main", mainMode, 25, "hauptbeschaeftigung"),
        job("mini", miniMode, 15, "minijob"),
      ];
      const shifts = [shift("m", "main", "2026-09-10", 10), shift("j", "mini", "2026-09-11", 10)];
      const usage = month(jobs, shifts);
      expect(usage.earnings).toBe(150);
      expect(usage.hours).toBe(10);
      expect(usage.earningsLimit).toBe(603);
      const year = yearUsage(shifts, makeResolver(jobs, settings), settings, 2026, "2026-09-30");
      expect(year.earnings).toBe(150);
    }
  });
});

describe("Kalenderjahres-Grenze = Summe der Monatsgrenzen des Jahres", () => {
  it("2025: 12 × 556 = 6672; 2026: 12 × 603 = 7236", () => {
    expect(yearlyLimitOf(settings, 2025)).toBe(6672);
    expect(yearlyLimitOf(settings, 2026)).toBe(7236);
  });

  it("yearUsage verwendet die Grenze des abgefragten Kalenderjahres", () => {
    const jobs = [job("mini", "flex", 15)];
    const resolve = makeResolver(jobs, settings);
    expect(yearUsage([], resolve, settings, 2025, "2025-12-31").earningsLimit).toBe(6672);
    expect(yearUsage([], resolve, settings, 2026, "2026-12-31").earningsLimit).toBe(7236);
  });
});
