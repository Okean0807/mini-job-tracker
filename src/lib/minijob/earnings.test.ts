import { beforeEach, describe, expect, it } from "vitest";

import { averageRate, shiftBreakdown, sumEarnings, sumHours } from "./calc";
import { makeResolver } from "./resolve";
import { addShift, monthStats, yearStats } from "./service";
import { replaceAll } from "./store";
import { DEFAULT_SETTINGS, DEFAULT_SUPPLEMENTS, type Job, type Settings, type Shift } from "./types";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultRate: 10,
  bundesland: "NW",
  supplements: {
    ...DEFAULT_SUPPLEMENTS,
    sunday: { enabled: true, mode: "prozent", value: 50 },
    saturday: { enabled: true, mode: "prozent", value: 20 },
  },
};

function shift(patch: Partial<Shift> & { id: string; date: string }): Shift {
  return {
    kind: "arbeit",
    start: "09:00",
    end: "17:00",
    breakMinutes: 0,
    ...patch,
  } as Shift;
}

describe("Durchschnittssatz in den Statistiken", () => {
  beforeEach(() => {
    replaceAll({ shifts: [], jobs: [], settings: { ...settings } });
  });

  it("löst Standard-Satz und Zuschläge auf (Monat und Jahr)", () => {
    // Sonntag 2026-03-08, kein Schicht-/Job-Satz -> Standard 10 EUR + 50 % Sonntag
    addShift({ ...shift({ id: "x", date: "2026-03-08" }), rate: undefined });
    const m = monthStats(2026, 2);
    expect(m.hours).toBe(8);
    expect(m.earnings).toBeCloseTo(120, 10);
    expect(m.avgRate).toBeCloseTo(15, 10);
    const y = yearStats(2026);
    expect(y.earnings).toBeCloseTo(120, 10);
    expect(y.avgRate).toBeCloseTo(15, 10);
  });

  it("averageRate ohne Resolver bleibt reine Basisrechnung", () => {
    const list = [shift({ id: "a", date: "2026-03-04", rate: 10 })];
    expect(averageRate(list)).toBe(10);
  });
});

describe("Konsistenz Anzeige / Summen / Resolver", () => {
  it("Summe einzelner Breakdowns entspricht sumEarnings", () => {
    const jobs: Job[] = [
      { id: "j1", name: "Job", color: "#000", rate: 12, mode: "flex" },
    ];
    const resolve = makeResolver(jobs, settings);
    const list = [
      shift({ id: "a", date: "2026-03-04", jobId: "j1" }), // Mittwoch, Job-Satz 12
      shift({ id: "b", date: "2026-03-07" }), // Samstag, Standard 10 + 20 %
      shift({ id: "c", date: "2026-01-01", start: "22:00", end: "02:00" }), // Feiertag NW
    ];
    const single = list.reduce((acc, s) => acc + shiftBreakdown(s, resolve(s)).total, 0);
    expect(sumEarnings(list, resolve)).toBeCloseTo(single, 10);
    expect(sumHours(list)).toBeCloseTo(8 + 8 + 4, 10);
    // Samstag: 8h * 10 * 1.2 = 96
    expect(shiftBreakdown(list[1]!, resolve(list[1]!)).total).toBeCloseTo(96, 10);
    // Feiertag ohne aktivierten Feiertagszuschlag: 4h * 10 = 40
    expect(shiftBreakdown(list[2]!, resolve(list[2]!)).total).toBeCloseTo(40, 10);
  });
});
