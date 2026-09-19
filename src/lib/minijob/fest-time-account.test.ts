import { describe, expect, it } from "vitest";

import {
  dayBalance,
  dayIstHours,
  daySollHours,
  effectiveWeeklyTarget,
  monthTimeAccount,
} from "./fest-time-account";
import { EMPTY_WEEK, type Job, type Shift } from "./types";

function festJob(partial: Partial<Job> = {}): Job {
  return {
    id: "j1",
    name: "Fest",
    color: "#000",
    mode: "fest",
    rate: 15,
    week: EMPTY_WEEK.map((d) => ({ ...d })),
    weeklyTarget: 37.5,
    ...partial,
  };
}

function arbeit(date: string, start = "09:00", end = "17:00", breakMinutes = 30): Shift {
  return {
    id: `a-${date}`,
    jobId: "j1",
    kind: "arbeit",
    date,
    start,
    end,
    breakMinutes,
  };
}

describe("fest-time-account", () => {
  it("daySollHours: active weekday = plan hours, weekend = 0", () => {
    const job = festJob();
    // 2026-09-14 = Monday
    expect(daySollHours(job, "2026-09-14")).toBeCloseTo(7.5, 5);
    // 2026-09-19 = Saturday
    expect(daySollHours(job, "2026-09-19")).toBe(0);
  });

  it("dayIstHours sums arbeit only", () => {
    const job = festJob();
    const shifts: Shift[] = [
      arbeit("2026-09-14", "09:00", "13:00", 0),
      {
        id: "u",
        jobId: "j1",
        kind: "urlaub",
        date: "2026-09-15",
        start: "09:00",
        end: "17:00",
        breakMinutes: 30,
      },
    ];
    expect(dayIstHours(job, "2026-09-14", shifts)).toBe(4);
    expect(dayIstHours(job, "2026-09-15", shifts)).toBe(0);
  });

  it("dayBalance = ist - soll", () => {
    const job = festJob();
    const shifts = [arbeit("2026-09-14", "09:00", "18:00", 30)]; // 8.5h vs 7.5
    expect(dayBalance(job, "2026-09-14", shifts)).toBeCloseTo(1, 5);
  });

  it("monthTimeAccount aggregates soll/ist/plus/minus/vacation/sick", () => {
    const job = festJob();
    // September 2026: Mon 1 .. Tue 30
    const shifts: Shift[] = [
      arbeit("2026-09-01", "09:00", "17:00", 30), // Mon 7.5
      arbeit("2026-09-02", "09:00", "18:00", 30), // Tue 8.5 → +1
      {
        id: "u1",
        jobId: "j1",
        kind: "urlaub",
        date: "2026-09-03",
        start: "09:00",
        end: "17:00",
        breakMinutes: 30,
      },
      {
        id: "k1",
        jobId: "j1",
        kind: "krank",
        date: "2026-09-04",
        start: "09:00",
        end: "17:00",
        breakMinutes: 30,
      },
    ];
    const acc = monthTimeAccount(job, 2026, 8, shifts, "BE");
    expect(acc.vacationDays).toBe(1);
    expect(acc.sickDays).toBe(1);
    expect(acc.ist).toBeCloseTo(16, 5); // 7.5 + 8.5
    expect(acc.soll).toBeGreaterThan(acc.ist); // full month plan > 2 work days
    expect(acc.plus).toBeCloseTo(1, 5);
    expect(acc.saldo).toBeCloseTo(acc.ist - acc.soll, 5);
  });

  it("absence days only count on active weekdays", () => {
    const job = festJob();
    const shifts: Shift[] = [
      {
        id: "u-sat",
        jobId: "j1",
        kind: "urlaub",
        date: "2026-09-19", // Saturday
        start: "09:00",
        end: "17:00",
        breakMinutes: 0,
      },
    ];
    const acc = monthTimeAccount(job, 2026, 8, shifts, "BE");
    expect(acc.vacationDays).toBe(0);
  });

  it("effectiveWeeklyTarget prefers weeklyTarget then plan", () => {
    const withTarget = festJob({ weeklyTarget: 20 });
    expect(effectiveWeeklyTarget(withTarget)).toBe(20);
    const fromPlan = festJob();
    delete (fromPlan as { weeklyTarget?: number }).weeklyTarget;
    expect(effectiveWeeklyTarget(fromPlan)).toBeCloseTo(37.5, 5);
  });
});
