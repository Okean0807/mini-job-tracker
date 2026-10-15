/**
 * B3-1 / O4 (DECISIONS R2): Hauptbeschäftigung + mehrere Minijobs →
 * Hinweis statt "OK"/"über der Grenze". Keine O1/O3-Logik.
 */
import { describe, expect, it } from "vitest";

import { limitAlertLevel } from "./limit-alert";
import { monthUsage } from "./limits";
import { monthPeriod, multipleMinijobsWithMainJob, yearPeriod } from "./multi-minijob";
import { makeResolver } from "./resolve";
import { DEFAULT_SETTINGS, type Job, type Shift } from "./types";

const settings = { ...DEFAULT_SETTINGS, limitAuto: true };
const SEPT = monthPeriod(2026, 8);

const job = (id: string, rate: number, employmentType: Job["employmentType"], extra: Partial<Job> = {}): Job => ({
  id,
  name: id,
  color: "#000",
  mode: "flex",
  rate,
  employmentType,
  ...extra,
});

const shift = (id: string, jobId: string, date: string, hours: number): Shift => ({
  id,
  jobId,
  kind: "arbeit",
  date,
  start: "08:00",
  end: `${String((8 + hours) % 24).padStart(2, "0")}:00`,
  breakMinutes: 0,
});

/** Beispiel aus DECISIONS R1 §2: HB 2 000 €, MJ-A 400 €, MJ-B 250 € (Summe 650 €). */
const HB = job("hb", 25, "hauptbeschaeftigung");
const MJ_A = job("mj-a", 20, "minijob", { startDate: "2026-01-01" });
const MJ_B = job("mj-b", 25, "minijob", { startDate: "2026-03-01" });
const SHIFTS = [
  shift("h", "hb", "2026-09-10", 8), // HB-Eintrag (zählt nicht zur Grenze)
  shift("a", "mj-a", "2026-09-10", 20), // 400 €
  shift("b", "mj-b", "2026-09-11", 10), // 250 €
];

describe("Perioden", () => {
  it("Monat und Jahr inklusive Grenzen", () => {
    expect(monthPeriod(2026, 1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(SEPT).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(yearPeriod(2026)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("multipleMinijobsWithMainJob", () => {
  it("einzelner Minijob neben HB → false (Karte unverändert)", () => {
    expect(multipleMinijobsWithMainJob([HB, MJ_A], SHIFTS.slice(0, 2), SEPT)).toBe(false);
  });

  it("HB + 2 Minijobs → true (Monat und Jahr)", () => {
    expect(multipleMinijobsWithMainJob([HB, MJ_A, MJ_B], SHIFTS, SEPT)).toBe(true);
    expect(multipleMinijobsWithMainJob([HB, MJ_A, MJ_B], SHIFTS, yearPeriod(2026))).toBe(true);
  });

  it("2 Minijobs ohne HB → false: Summe gegen eine Grenze bleibt (SGB IV § 8 Abs. 2 S. 1)", () => {
    expect(multipleMinijobsWithMainJob([MJ_A, MJ_B], SHIFTS.slice(1), SEPT)).toBe(false);
  });

  it("zweiter Minijob erst nach dem Zeitraum begonnen und ohne Einträge → false", () => {
    const later = job("mj-c", 15, "minijob", { startDate: "2026-10-01" });
    expect(multipleMinijobsWithMainJob([HB, MJ_A, later], SHIFTS.slice(0, 2), SEPT)).toBe(false);
  });

  it("vor dem Zeitraum beendeter Minijob ohne Einträge zählt nicht", () => {
    const ended = job("mj-c", 15, "minijob", { startDate: "2026-01-01", endDate: "2026-08-31" });
    expect(multipleMinijobsWithMainJob([HB, MJ_A, ended], SHIFTS.slice(0, 2), SEPT)).toBe(false);
  });

  it("archivierter Minijob zählt nur mit Einträgen im Zeitraum", () => {
    const archived = { ...MJ_B, archived: true };
    expect(multipleMinijobsWithMainJob([HB, MJ_A, archived], SHIFTS.slice(0, 2), SEPT)).toBe(false);
    expect(multipleMinijobsWithMainJob([HB, MJ_A, archived], SHIFTS, SEPT)).toBe(true);
  });

  it("kurzfristig / selbstständig / ungeklärt zählen weder als HB noch als Minijob", () => {
    const kurz = job("k", 15, "kurzfristig");
    expect(multipleMinijobsWithMainJob([kurz, MJ_A, MJ_B], SHIFTS.slice(1), SEPT)).toBe(false);
    const legacyFest: Job = { id: "f", name: "f", color: "#000", mode: "fest" };
    expect(multipleMinijobsWithMainJob([legacyFest, MJ_A, MJ_B], SHIFTS.slice(1), SEPT)).toBe(false);
  });
});

describe("kein 'OK'/'über der Grenze' bei HB + 2 Minijobs", () => {
  it("650 € (wäre bisher 'über'): Alert = null", () => {
    const usage = monthUsage(SHIFTS, makeResolver([HB, MJ_A, MJ_B], settings), settings, 2026, 8, "2026-09-30");
    expect(usage.earnings).toBe(650); // Summe bleibt informativ
    expect(limitAlertLevel(true, usage.share, 0)).toBe("over"); // Altverhalten ohne Flag
    expect(limitAlertLevel(true, usage.share, 0, true)).toBeNull();
  });

  it("550 € (wäre bisher 'OK'): weiterhin kein Status, sondern Hinweis", () => {
    const shifts = [SHIFTS[0]!, SHIFTS[1]!, shift("b", "mj-b", "2026-09-11", 6)]; // 150 €
    const jobs = [HB, MJ_A, MJ_B];
    const usage = monthUsage(shifts, makeResolver(jobs, settings), settings, 2026, 8, "2026-09-30");
    expect(usage.earnings).toBe(550);
    expect(multipleMinijobsWithMainJob(jobs, shifts, SEPT)).toBe(true);
  });

  it("einzelner Minijob: Status unverändert", () => {
    const jobs = [HB, MJ_A];
    const shifts = [SHIFTS[0]!, shift("a", "mj-a", "2026-09-10", 20), shift("a2", "mj-a", "2026-09-12", 11)]; // 620 €
    const usage = monthUsage(shifts, makeResolver(jobs, settings), settings, 2026, 8, "2026-09-30");
    expect(usage.earnings).toBe(620);
    const unreliable = multipleMinijobsWithMainJob(jobs, shifts, SEPT);
    expect(unreliable).toBe(false);
    expect(limitAlertLevel(true, usage.share, 0, unreliable)).toBe("over");
  });

  it("2 Minijobs ohne HB: Summe 650 € → weiterhin 'over' (dokumentiertes Verhalten)", () => {
    const jobs = [MJ_A, MJ_B];
    const shifts = SHIFTS.slice(1);
    const usage = monthUsage(shifts, makeResolver(jobs, settings), settings, 2026, 8, "2026-09-30");
    expect(usage.earnings).toBe(650);
    const unreliable = multipleMinijobsWithMainJob(jobs, shifts, SEPT);
    expect(limitAlertLevel(true, usage.share, 0, unreliable)).toBe("over");
  });
});
