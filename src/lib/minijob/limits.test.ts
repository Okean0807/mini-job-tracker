import { describe, expect, it } from "vitest";

import { makeResolver } from "./resolve";
import { DEFAULT_SETTINGS, type Job, type Shift } from "./types";
import { monthUsage, yearUsage } from "./limits";

const settings = { ...DEFAULT_SETTINGS, limitAuto: true };

const job = (id: string, mode: Job["mode"], rate?: number, employmentType?: Job["employmentType"]): Job => ({
  id,
  name: id,
  color: "#000",
  mode,
  rate,
  employmentType,
});

const shift = (id: string, jobId: string, date: string, hours: number, rate?: number): Shift => ({
  id,
  jobId,
  kind: "arbeit",
  date,
  start: "08:00",
  end: `${String((8 + hours) % 24).padStart(2, "0")}:00`,
  breakMinutes: 0,
  rate,
});

describe("Minijob-Grenze filtert nach Beschäftigungsart", () => {
  it("zählt Minijob und ignoriert Hauptbeschäftigung", () => {
    const jobs = [
      job("mini", "flex", 15),
      job("main", "fest", 25),
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
    const jobs = [job("mini", "flex", 15), job("main", "fest", 30)];
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
