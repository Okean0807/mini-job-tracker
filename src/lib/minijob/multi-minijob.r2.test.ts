/**
 * QA R1 (#145): P2-145-b inaktive Minijobs, P2-145-c Monat/Jahr je Bereich,
 * P1-145-a Jahresbericht/Statistik/Prognose-Flag, notify.limitStatus.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";

import { buildAnnualReport } from "./annual";
import { effectiveLimitShares, limitAlertLevel } from "./limit-alert";
import {
  limitReliabilityFlags,
  monthPeriod,
  multipleMinijobsWithMainJob,
  rollingPeriod,
} from "./multi-minijob";
import { limitStatus } from "./notify";
import { makeResolver } from "./resolve";
import { withLegalYearLimit } from "./stats-legal";
import { DEMO_SCOPE } from "./storage-scope";
import { activateScope, EMPTY_DATA, loadFromStorage, replaceAll } from "./store";
import { DEFAULT_SETTINGS, type Job, type Shift } from "./types";

const settings = { ...DEFAULT_SETTINGS, limitAuto: true };
const job = (
  id: string,
  rate: number,
  employmentType: NonNullable<Job["employmentType"]>,
  extra: Partial<Job> = {},
): Job => ({ id, name: id, color: "#000", mode: "flex", rate, employmentType, ...extra });
const shift = (id: string, jobId: string, date: string, hours: number): Shift => ({
  id,
  jobId,
  kind: "arbeit",
  date,
  start: "08:00",
  end: `${String(8 + hours).padStart(2, "0")}:00`,
  breakMinutes: 0,
});

const HB = job("hb", 25, "hauptbeschaeftigung");
const MJ_A = job("mj-a", 20, "minijob", { startDate: "2026-01-01" });
const MJ_B = job("mj-b", 25, "minijob", { startDate: "2026-03-01" });
const SEPT = monthPeriod(2026, 8);

describe("P2-145-b: inaktive Minijobs zählen nicht", () => {
  it("HB + MJ-A + nicht archivierter MJ-C ohne Einträge → false (echter Status bleibt)", () => {
    const idle = job("mj-c", 15, "minijob");
    const shifts = [shift("a", "mj-a", "2026-09-10", 10)];
    expect(multipleMinijobsWithMainJob([HB, MJ_A, idle], shifts, SEPT)).toBe(false);
  });

  it("Einträge außerhalb der Beschäftigungsdauer machen einen Minijob nicht aktiv", () => {
    const ended = job("mj-c", 15, "minijob", { endDate: "2026-08-31" });
    const shifts = [shift("a", "mj-a", "2026-09-10", 10), shift("c", "mj-c", "2026-09-11", 2)];
    expect(multipleMinijobsWithMainJob([HB, MJ_A, ended], shifts, SEPT)).toBe(false);
  });

  it("HB ohne Einträge zählt, solange nicht archiviert und zeitlich aktiv", () => {
    const shifts = [shift("a", "mj-a", "2026-09-10", 10), shift("b", "mj-b", "2026-09-11", 4)];
    expect(multipleMinijobsWithMainJob([HB, MJ_A, MJ_B], shifts, SEPT)).toBe(true);
    expect(multipleMinijobsWithMainJob([{ ...HB, archived: true }, MJ_A, MJ_B], shifts, SEPT)).toBe(
      false,
    );
  });
});

describe("P2-145-c: Flags je Bereich (betrachteter Monat vs. Jahr)", () => {
  // MJ-B nur im März aktiv und Ende März beendet → September: 1 MJ (Monat
  // belastbar), Jahr: 2 MJ. (Ohne Ende zählt MJ-B im September weiter – siehe
  // P3-R2-145-a unten.)
  const shifts = [
    shift("a3", "mj-a", "2026-03-10", 10),
    shift("b3", "mj-b", "2026-03-11", 4),
    shift("a9", "mj-a", "2026-09-10", 10),
  ];
  const jobs = [HB, MJ_A, { ...MJ_B, endDate: "2026-03-31" }];

  it("September: month=false, year=true; März: month=true", () => {
    expect(limitReliabilityFlags(jobs, shifts, 2026, 8)).toEqual({
      month: false,
      year: true,
      forecast: true,
    });
    expect(limitReliabilityFlags(jobs, shifts, 2026, 2).month).toBe(true);
  });

  it("Banner: Monat über der Grenze bleibt sichtbar, Jahresanteil wird ignoriert", () => {
    const flags = { month: false, year: true };
    expect(limitAlertLevel(true, 105, 30, flags)).toBe("over");
    expect(limitAlertLevel(true, 50, 120, flags)).toBeNull();
    expect(effectiveLimitShares(50, 120, flags)).toEqual({ month: 50, year: 0 });
    expect(limitAlertLevel(true, 50, 120, { month: true, year: false })).toBe("over");
  });

  it("Rolling-Zeitraum: 12 Monate bis einschließlich betrachtetem Monat", () => {
    expect(rollingPeriod(2026, 8)).toEqual({ from: "2025-10-01", to: "2026-09-30" });
    expect(rollingPeriod(2026, 0)).toEqual({ from: "2025-02-01", to: "2026-01-31" });
  });

  it("Prognose-Flag: zweiter Minijob nur im Vorjahresfenster → forecast=true, year=false", () => {
    const s = [shift("a", "mj-a", "2026-02-10", 10), shift("b", "mj-b", "2025-11-10", 4)];
    const mjB = { ...MJ_B, startDate: "2025-01-01" };
    expect(limitReliabilityFlags([HB, MJ_A, mjB], s, 2026, 1)).toEqual({
      month: false,
      year: false,
      forecast: true,
    });
  });
});

describe("P1-145-a: Jahresbericht trägt den Flag", () => {
  const shifts = [shift("a", "mj-a", "2026-09-10", 10), shift("b", "mj-b", "2026-09-11", 4)];
  it("buildAnnualReport setzt multipleMinijobs", () => {
    const jobs = [HB, MJ_A, MJ_B];
    const r = buildAnnualReport(shifts, jobs, settings, 2026, makeResolver(jobs, settings));
    expect(r.multipleMinijobs).toBe(true);
    const single = buildAnnualReport(
      shifts.slice(0, 1),
      jobs,
      settings,
      2026,
      makeResolver(jobs, settings),
    );
    expect(single.multipleMinijobs).toBe(false);
  });
  it("withLegalYearLimit übernimmt den ungefilterten Flag", () => {
    const jobs = [HB, MJ_A, MJ_B];
    const r = buildAnnualReport(
      shifts.slice(0, 1),
      jobs,
      settings,
      2026,
      makeResolver(jobs, settings),
    );
    const legal = { earningsLimit: 7236, earningsShare: 50 } as never;
    expect(withLegalYearLimit(r, legal, true).multipleMinijobs).toBe(true);
    expect(withLegalYearLimit(r, legal).multipleMinijobs).toBe(false);
  });
});

describe("notify.limitStatus (store-basiert)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 30, 12));
    loadFromStorage();
    act(() => activateScope(DEMO_SCOPE));
  });
  afterEach(() => vi.useRealTimers());

  function seed(jobs: Job[], shifts: Shift[]) {
    act(() =>
      replaceAll({
        ...EMPTY_DATA,
        jobs,
        shifts,
        settings: { ...settings, onboarded: true, localDemoMode: true },
      } as never),
    );
  }

  it("HB + 2 Minijobs im aktuellen Monat → keine Anteile (keine Benachrichtigung)", () => {
    seed(
      [HB, MJ_A, MJ_B],
      [shift("a", "mj-a", "2026-09-10", 20), shift("b", "mj-b", "2026-09-11", 10)],
    );
    expect(limitStatus()).toEqual({ monthShare: 0, monthHoursShare: 0, yearShare: 0 });
  });

  it("einzelner Minijob → Anteile wie bisher", () => {
    seed([HB, MJ_A], [shift("a", "mj-a", "2026-09-10", 20)]);
    const s = limitStatus();
    expect(s.monthShare).toBeGreaterThan(60);
    expect(s.yearShare).toBeGreaterThan(0);
  });
});

describe("P3-R2-145-a: Monat/Jahr-Konsistenz, wenn ein Minijob im Monat ruht", () => {
  // MJ-A (erster Minijob) Jan–Aug aktiv, im September KEINE Einträge, weiter beschäftigt;
  // MJ-B arbeitet im September.
  const shifts = [
    shift("a1", "mj-a", "2026-01-12", 10),
    shift("a8", "mj-a", "2026-08-12", 10),
    shift("b9", "mj-b", "2026-09-11", 10),
  ];

  it("erster Minijob ruht im September → Monat zeigt ebenfalls O4 (wie Jahr/Prognose)", () => {
    expect(limitReliabilityFlags([HB, MJ_A, MJ_B], shifts, 2026, 8)).toEqual({
      month: true,
      year: true,
      forecast: true,
    });
  });

  it("erster Minijob archiviert bzw. vor dem Monat beendet → Monat belastbar (false)", () => {
    expect(
      limitReliabilityFlags([HB, { ...MJ_A, archived: true }, MJ_B], shifts, 2026, 8).month,
    ).toBe(false);
    expect(
      limitReliabilityFlags([HB, { ...MJ_A, endDate: "2026-08-31" }, MJ_B], shifts, 2026, 8).month,
    ).toBe(false);
  });

  it("Minijob, der erst nach dem Monat Einträge hat, zählt im Monat nicht", () => {
    const s = [shift("b2", "mj-b", "2026-03-11", 10), shift("a10", "mj-a", "2026-10-12", 10)];
    expect(limitReliabilityFlags([HB, MJ_A, MJ_B], s, 2026, 2).month).toBe(false);
  });

  it("Minijob ohne Einträge im Jahr zählt weiterhin nicht (P2-145-b bleibt)", () => {
    const idle = job("mj-c", 15, "minijob");
    const s = [shift("b9", "mj-b", "2026-09-11", 10)];
    expect(limitReliabilityFlags([HB, idle, MJ_B], s, 2026, 8).month).toBe(false);
  });

  it("Einträge nur im Vorjahr belegen den Monat nicht (Monat ⊆ Jahr)", () => {
    const mjA = { ...MJ_A, startDate: "2025-01-01" };
    const s = [shift("a", "mj-a", "2025-11-12", 10), shift("b9", "mj-b", "2026-09-11", 10)];
    const flags = limitReliabilityFlags([HB, mjA, MJ_B], s, 2026, 8);
    expect(flags.month).toBe(false);
    expect(flags.year).toBe(false);
  });

  it("Invariante: Monats-Flag ⇒ Jahres-Flag für alle Monate", () => {
    const jobsets = [
      [HB, MJ_A, MJ_B],
      [HB, { ...MJ_A, archived: true }, MJ_B],
      [HB, { ...MJ_A, endDate: "2026-05-31" }, MJ_B],
    ];
    for (const jobs of jobsets) {
      for (let m = 0; m < 12; m++) {
        const f = limitReliabilityFlags(jobs, shifts, 2026, m);
        if (f.month) expect(f.year, `month ${m}`).toBe(true);
      }
    }
  });

  it("Ohne Hauptbeschäftigung bleibt alles false (O4 unverändert)", () => {
    expect(limitReliabilityFlags([MJ_A, MJ_B], shifts, 2026, 8)).toEqual({
      month: false,
      year: false,
      forecast: false,
    });
  });
});
