import { describe, expect, it } from "vitest";

import { buildAnnualReport } from "./annual";
import { autoSaved } from "./goals";
import type { ResolveOptions } from "./resolve";
import type { Goal, Job, Settings, Shift } from "./types";

const RATE = 15;

const job = {
  id: "j1",
  name: "Reinigung",
  rate: RATE,
  color: "#000",
  week: [
    { active: true, start: "09:00", end: "14:00", breakMinutes: 0 }, // Mo
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
  ],
  startDate: "2026-01-01",
} as unknown as Job;

function shift(date: string, kind: Shift["kind"] = "arbeit"): Shift {
  return {
    id: date + kind,
    date,
    start: "09:00",
    end: "14:00",
    breakMinutes: 0,
    kind,
    jobId: "j1",
  } as Shift;
}

const resolve = (): ResolveOptions => ({ job, defaultRate: RATE });

const settings = { defaultRate: RATE, bundesland: "BY" } as unknown as Settings;

// Montag = Arbeitstag laut Plan, Mittwoch = arbeitsfrei.
const shifts = [
  shift("2026-03-02"), // Arbeit, Montag
  shift("2026-03-09", "urlaub"), // Montag
  shift("2026-03-11", "feiertag"), // Mittwoch -> unbezahlt
];

describe("Jahresbericht mit Payroll-Semantik", () => {
  const report = buildAnnualReport(shifts, [job], settings, 2026, resolve);

  it("zählt bezahlte Abwesenheit nicht als Arbeitsstunden", () => {
    expect(report.hours).toBeCloseTo(5);
    expect(report.absenceHours).toBeCloseTo(5);
  });

  it("weist Entgeltfortzahlung getrennt aus", () => {
    expect(report.workEarnings).toBeCloseTo(75);
    expect(report.absenceEarnings).toBeCloseTo(75);
    expect(report.earnings).toBeCloseTo(150);
  });

  it("berechnet den Durchschnittssatz nur aus geleisteter Arbeit", () => {
    expect(report.avgRate).toBeCloseTo(RATE);
  });

  it("zahlt Feiertage an arbeitsfreien Tagen nicht", () => {
    const march = report.months[2]!;
    expect(march.earnings).toBeCloseTo(150);
    expect(march.hours).toBeCloseTo(5);
  });
});

describe("Sparziele mit Payroll-Semantik", () => {
  it("rechnet Entgeltfortzahlung ein, aber keine unbezahlten Tage", () => {
    const goal = { id: "g1", name: "Ziel", target: 1000, kind: "auto", share: 100 } as Goal;
    expect(autoSaved(goal, shifts, resolve)).toBeCloseTo(150);
  });
});
