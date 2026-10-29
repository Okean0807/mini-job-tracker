/**
 * QA P0: Abwesenheiten (und Plan-Vorschläge) wurden nach einem Planwechsel mit dem AKTUELLEN
 * Wochenplan erzeugt, die Payroll bewertet aber den am Datum gültigen Plan (weekForDate).
 * Rückwirkende Zeiträume bekamen dadurch die falschen Tage.
 */
import { describe, expect, it } from "vitest";

import { payrollTotals } from "./payroll";
import { absenceDayTimes, generateAbsence, generateFixedMonth, jobsPlannedOn } from "./schedule";
import { makeResolver } from "./resolve";
import { absencePlanDay, weekForDate } from "./week-plan";
import { DEFAULT_SETTINGS, type FixedDay, type Job, type Shift } from "./types";

const day = (active: boolean, start = "08:00", end = "13:00"): FixedDay => ({
  active,
  start,
  end,
  breakMinutes: 0,
});
const MON_FRI = [day(true), day(true), day(true), day(true), day(true), day(false), day(false)];
const MON_ONLY = [
  day(true),
  day(false),
  day(false),
  day(false),
  day(false),
  day(false),
  day(false),
];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6].map(() => day(true));

const base = {
  id: "J",
  name: "Fest",
  color: "#123456",
  rate: 15,
  mode: "fest",
  employmentType: "minijob",
  startDate: "2026-01-01",
} as const;

/** Plan Mo–Fr bis 19.10.2026, ab 20.10.2026 nur noch Montag. */
const reduced: Job = {
  ...base,
  week: MON_ONLY,
  weekHistory: [{ effectiveFrom: "2026-10-20", week: MON_FRI }],
} as Job;
/** Plan Mo–Fr bis 19.10.2026, ab 20.10.2026 alle sieben Tage. */
const extended: Job = {
  ...base,
  week: ALL_DAYS,
  weekHistory: [{ effectiveFrom: "2026-10-20", week: MON_FRI }],
} as Job;

const dates = (list: Shift[]) => list.map((s) => s.date);

describe("Abwesenheiten nutzen den am Datum gültigen Wochenplan", () => {
  it("Planreduktion (Mo–Fr → Mo): rückwirkende Woche bekommt weiter Mo–Fr", () => {
    const created = generateAbsence(reduced, "urlaub", "2026-09-07", "2026-09-13", "BE");
    expect(dates(created)).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
    ]);
  });

  it("nach dem Planwechsel gilt der neue Plan (nur Montag)", () => {
    const created = generateAbsence(reduced, "urlaub", "2026-10-26", "2026-11-01", "BE");
    expect(dates(created)).toEqual(["2026-10-26"]);
  });

  it("Zeitraum über den Planwechsel hinweg: vor dem 20.10. Mo–Fr, danach nur Montag", () => {
    const created = generateAbsence(reduced, "urlaub", "2026-10-12", "2026-10-26", "BE");
    expect(dates(created)).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-19",
      "2026-10-26",
    ]);
  });

  it("Planerweiterung (Mo–Fr → alle Tage): rückwirkend KEIN Sa/So", () => {
    const created = generateAbsence(extended, "urlaub", "2026-09-07", "2026-09-13", "BE");
    expect(dates(created)).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
    ]);
  });

  it("Zeiten kommen aus dem Plan am Datum, nicht aus dem aktuellen", () => {
    const job: Job = {
      ...base,
      week: [day(true, "10:00", "14:00"), ...MON_ONLY.slice(1)],
      weekHistory: [
        {
          effectiveFrom: "2026-10-20",
          week: MON_FRI.map((d) => ({ ...d, start: "07:00", end: "12:00" })),
        },
      ],
    } as Job;
    expect(absenceDayTimes(job, "2026-09-08")).toEqual({
      start: "07:00",
      end: "12:00",
      breakMinutes: 0,
    });
    expect(absenceDayTimes(job, "2026-10-26")).toEqual({
      start: "10:00",
      end: "14:00",
      breakMinutes: 0,
    });
    const created = generateAbsence(job, "krank", "2026-09-07", "2026-09-08", "BE");
    expect(created.every((s) => s.start === "07:00" && s.end === "12:00")).toBe(true);
  });

  it("unbekannter historischer Plan: nichts anlegen, nicht auf den aktuellen Plan raten", () => {
    const broken = {
      ...base,
      week: ALL_DAYS,
      weekHistory: [{ effectiveFrom: "2026-10-20" }],
    } as unknown as Job;
    expect(absencePlanDay(broken, "2026-09-08")).toEqual({ status: "unknown" });
    expect(generateAbsence(broken, "urlaub", "2026-09-07", "2026-09-13", "BE")).toEqual([]);
    // Nach dem Planwechsel ist der aktuelle Plan bekannt und gilt.
    expect(generateAbsence(broken, "urlaub", "2026-10-26", "2026-10-26", "BE")).toHaveLength(1);
  });

  it("Job ganz ohne Wochenplan behält die bisherige Regel (Mo–Fr, 09–17)", () => {
    const flex = { id: "F", name: "Flex", color: "#111", rate: 12, mode: "flex" } as Job;
    const created = generateAbsence(flex, "krank", "2026-09-04", "2026-09-07", "BE");
    expect(dates(created)).toEqual(["2026-09-04", "2026-09-07"]);
    expect(created[0]).toMatchObject({ start: "09:00", end: "17:00", breakMinutes: 0 });
  });

  it("bestehende Einträge werden weiterhin übersprungen", () => {
    const existing = [
      {
        id: "x",
        jobId: "J",
        kind: "arbeit",
        date: "2026-09-09",
        start: "09:00",
        end: "10:00",
        breakMinutes: 0,
      },
    ] as Shift[];
    const created = generateAbsence(reduced, "urlaub", "2026-09-07", "2026-09-11", "BE", existing);
    expect(dates(created)).not.toContain("2026-09-09");
    expect(created).toHaveLength(4);
  });
});

describe("Plan-Vorschläge für vergangene Monate nutzen den damaligen Plan", () => {
  it("generateFixedMonth(September) nach Planreduktion: alle 22 Werktage, nicht nur 4 Montage", () => {
    const created = generateFixedMonth(reduced, 2026, 8, [], "BE");
    expect(created).toHaveLength(22);
    expect(new Set(created.map((s) => new Date(s.date).getDay())).size).toBeGreaterThan(1);
  });

  it("jobsPlannedOn für einen vergangenen Mittwoch sieht den damaligen Plan", () => {
    expect(jobsPlannedOn([reduced], [], "2026-09-09")).toHaveLength(1);
    expect(jobsPlannedOn([reduced], [], "2026-10-28")).toHaveLength(0);
  });
});

describe("Planwechsel ändert gespeicherte Vergangenheit nicht", () => {
  it("Beträge einer bestehenden Urlaubswoche sind vor und nach dem Planwechsel gleich", () => {
    const beforeChange: Job = { ...base, week: MON_FRI } as Job;
    const created = generateAbsence(beforeChange, "urlaub", "2026-09-07", "2026-09-13", "BE");
    const settings = { ...DEFAULT_SETTINGS, bundesland: "BE" };
    const total = (job: Job) => payrollTotals(created, makeResolver([job], settings), created);

    const original = total(beforeChange);
    expect(original.absenceEarnings).toBe(375);
    expect(total(reduced).absenceEarnings).toBe(375);
    expect(total(extended).absenceEarnings).toBe(375);
    expect(total(reduced)).toEqual(original);
  });

  it("weekForDate: Datum vor dem Wechsel → alter Plan, ab dem Wechsel → neuer Plan", () => {
    expect(weekForDate(reduced, "2026-10-19")).toBe(MON_FRI);
    expect(weekForDate(reduced, "2026-10-20")).toBe(MON_ONLY);
  });

  it("zwei Planwechsel am selben Tag: davor gilt der ursprüngliche Plan", () => {
    const twice: Job = {
      ...base,
      week: ALL_DAYS,
      weekHistory: [
        { effectiveFrom: "2026-10-20", week: MON_FRI },
        { effectiveFrom: "2026-10-20", week: MON_ONLY },
      ],
    } as Job;
    expect(weekForDate(twice, "2026-09-09")).toBe(MON_FRI);
  });
});
