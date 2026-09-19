import { describe, expect, it } from "vitest";

import { generateAbsence, generateFixedMonth, weeklyPlanHours } from "./schedule";
import { EMPTY_WEEK, type Job } from "./types";

describe("generateAbsence", () => {
  it("überspringt Wochenendtage ohne Festplan", () => {
    const flex: Job = {
      id: "j2",
      name: "Flex",
      color: "#111",
      rate: 12,
      mode: "flex",
      startDate: "2026-01-01",
    };
    // Fr–Mo: nur Fr + Mo (local calendar dates; no process.env.TZ mutation)
    const created = generateAbsence(flex, "krank", "2026-03-06", "2026-03-09", "BE");
    expect(created.map((s) => s.date)).toEqual(["2026-03-06", "2026-03-09"]);
  });

  it("überspringt Tage mit bestehendem Eintrag (keine Doppel / kein Overwrite)", () => {
    const flex: Job = {
      id: "j2",
      name: "Flex",
      color: "#111",
      rate: 12,
      mode: "flex",
      startDate: "2026-01-01",
    };
    const existing = [
      {
        id: "ex",
        jobId: "j2",
        kind: "arbeit" as const,
        date: "2026-03-06",
        start: "09:00",
        end: "12:00",
        breakMinutes: 0,
      },
    ];
    const created = generateAbsence(flex, "urlaub", "2026-03-06", "2026-03-09", "BE", existing);
    expect(created.map((s) => s.date)).toEqual(["2026-03-09"]);
  });

  it("markiert alle Plan-Tage im Urlaubszeitraum", () => {
    const fest: Job = {
      id: "j1",
      name: "Fest",
      color: "#000",
      rate: 14,
      mode: "fest",
      startDate: "2026-01-01",
      week: [
        { active: true, start: "09:00", end: "17:00", breakMinutes: 30 },
        { active: true, start: "09:00", end: "17:00", breakMinutes: 30 },
        { active: true, start: "09:00", end: "17:00", breakMinutes: 30 },
        { active: true, start: "09:00", end: "17:00", breakMinutes: 30 },
        { active: true, start: "09:00", end: "17:00", breakMinutes: 30 },
        { active: false, start: "09:00", end: "17:00", breakMinutes: 0 },
        { active: false, start: "09:00", end: "17:00", breakMinutes: 0 },
      ],
    };
    // Mo 2026-07-06 .. Fr 2026-07-10
    const created = generateAbsence(fest, "urlaub", "2026-07-06", "2026-07-10", "BE");
    expect(created.map((s) => s.date)).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
    ]);
    expect(created.every((s) => s.kind === "urlaub")).toBe(true);
  });
});

describe("generateFixedMonth", () => {
  it("skips dates that already have an entry (plan change does not rewrite)", () => {
    const fest: Job = {
      id: "j1",
      name: "Fest",
      color: "#000",
      rate: 14,
      mode: "fest",
      week: EMPTY_WEEK.map((d) => ({ ...d })),
    };
    const existing = [
      {
        id: "ex",
        jobId: "j1",
        kind: "arbeit" as const,
        date: "2026-09-01",
        start: "08:00",
        end: "12:00",
        breakMinutes: 0,
      },
    ];
    const created = generateFixedMonth(fest, 2026, 8, existing, "BE");
    expect(created.every((s) => s.date !== "2026-09-01")).toBe(true);
    // Changing week plan still must not touch existing
    fest.week = fest.week!.map((d, i) =>
      i === 0 ? { ...d, start: "10:00", end: "18:00", breakMinutes: 45 } : d,
    );
    const afterPlanChange = generateFixedMonth(fest, 2026, 8, existing, "BE");
    expect(afterPlanChange.every((s) => s.date !== "2026-09-01")).toBe(true);
    expect(existing[0]!.start).toBe("08:00");
  });

  it("weeklyPlanHours sums active days only", () => {
    const fest: Job = {
      id: "j1",
      name: "Fest",
      color: "#000",
      mode: "fest",
      week: EMPTY_WEEK.map((d) => ({ ...d })),
    };
    expect(weeklyPlanHours(fest)).toBeCloseTo(37.5, 5);
  });
});
