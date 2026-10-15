import { describe, expect, it } from "vitest";

import { buildAssistantContext } from "./ai-context";
import { DEFAULT_SETTINGS, type AppData, type Job, type Shift } from "./types";

function makeShift(partial: Partial<Shift> & { date: string }): Shift {
  return {
    id: partial.id ?? `s-${partial.date}`,
    kind: "arbeit",
    start: "09:00",
    end: "15:30",
    breakMinutes: 0,
    jobId: "j1",
    ...partial,
  };
}

function makeData(overrides: Partial<AppData> = {}): AppData {
  const job: Job = {
    id: "j1",
    name: "Café",
    color: "#0d9488",
    mode: "flex",
    rate: 17.1,
  };
  return {
    shifts: [],
    jobs: [job],
    customers: [],
    projects: [],
    payments: [],
    goals: [],
    orders: [],
    objects: [],
    settings: { ...DEFAULT_SETTINGS, defaultRate: 17.1 },
    timer: null,
    ...overrides,
  };
}

describe("buildAssistantContext", () => {
  it("includes hourlyRate, current month, and settings limits", () => {
    const now = new Date(2026, 8, 15); // Sep 15, 2026
    const data = makeData({
      shifts: [
        makeShift({ date: "2026-09-01", start: "09:00", end: "12:00" }), // 3h
        makeShift({ date: "2026-09-02", start: "09:00", end: "12:30" }), // 3.5h
      ],
    });

    const parsed = JSON.parse(buildAssistantContext(data, now));

    expect(parsed.settings.hourlyRate).toBe(17.1);
    expect(parsed.settings.workMode).toBe("flex");
    expect(parsed.settings.minijobLimitApplies).toBe(true);
    expect(parsed.settings.legalMonthlyLimit).toBeGreaterThan(0);
    expect(parsed.settings.automaticMonthlyHours).toBeGreaterThan(0);
    expect(parsed.settings.annualLimit).toBeGreaterThan(0);
    expect(parsed.jobs[0].mode).toBe("flex");
    expect(parsed.jobs[0].minijobLimitApplies).toBe(true);
    expect(parsed.currentDate).toBe("2026-09-15");
    expect(parsed.currentMonth).toMatchObject({
      year: 2026,
      month: 8,
      hours: 6.5,
      earnings: Number((6.5 * 17.1).toFixed(2)),
      entriesCount: 2,
    });
    expect(parsed.year.hours).toBe(6.5);
    expect(parsed.jobs[0]).toMatchObject({ name: "Café", hourlyRate: 17.1, hours: 6.5 });
  });

  it("rebuild after mutating shifts shows new totals", () => {
    const now = new Date(2026, 8, 15);
    const data = makeData({
      shifts: [makeShift({ date: "2026-09-01", start: "09:00", end: "12:00" })],
    });
    const before = JSON.parse(buildAssistantContext(data, now));
    expect(before.currentMonth.hours).toBe(3);

    data.shifts.push(makeShift({ id: "s2", date: "2026-09-03", start: "10:00", end: "14:00" }));
    const after = JSON.parse(buildAssistantContext(data, now));
    expect(after.currentMonth.hours).toBe(7);
    expect(after.currentMonth.entriesCount).toBe(2);
    expect(after.currentMonth.earnings).toBe(Number((7 * 17.1).toFixed(2)));
  });

  it("reflects settings rate changes", () => {
    const now = new Date(2026, 8, 15);
    const data = makeData({
      shifts: [makeShift({ date: "2026-09-01", start: "09:00", end: "11:00" })],
      settings: { ...DEFAULT_SETTINGS, defaultRate: 20 },
      jobs: [{ id: "j1", name: "Café", color: "#0d9488", mode: "flex" }],
    });
    // No job rate → uses defaultRate 20
    const parsed = JSON.parse(buildAssistantContext(data, now));
    expect(parsed.settings.hourlyRate).toBe(20);
    expect(parsed.currentMonth.earnings).toBe(40);
    expect(parsed.settings.automaticMonthlyHours).toBe(
      Number((parsed.settings.legalMonthlyLimit / 20).toFixed(2)),
    );

    data.settings.defaultRate = 10;
    const again = JSON.parse(buildAssistantContext(data, now));
    expect(again.settings.hourlyRate).toBe(10);
    expect(again.currentMonth.earnings).toBe(20);
  });

  it("does not include documents or unrelated blobs", () => {
    const parsed = JSON.parse(buildAssistantContext(makeData(), new Date(2026, 8, 15)));
    expect(parsed).not.toHaveProperty("documents");
    expect(Object.keys(parsed).sort()).toEqual([
      "currentDate",
      "currentMonth",
      "historicalYears",
      "jobs",
      "months",
      "settings",
      "year",
    ]);
  });

  it("keeps currentMonth distinct from historical months", () => {
    const now = new Date(2026, 8, 15);
    const data = makeData({
      shifts: [
        makeShift({ date: "2026-01-10", start: "09:00", end: "17:00", breakMinutes: 30 }), // 7.5h Jan
        makeShift({ date: "2026-09-01", start: "09:00", end: "12:00" }), // 3h Sep
      ],
    });
    const parsed = JSON.parse(buildAssistantContext(data, now));
    expect(parsed.currentMonth.month).toBe(8);
    expect(parsed.currentMonth.hours).toBe(3);
    expect(parsed.months).toHaveLength(2);
    expect(parsed.months.find((m: { month: number }) => m.month === 0)?.hours).toBe(7.5);
  });

  it("self-employed must not imply employee Minijob Grenze", () => {
    const now = new Date(2026, 8, 15);
    const data = makeData({
      jobs: [{ id: "j1", name: "Freelance", color: "#0d9488", mode: "selbststaendig", rate: 40 }],
      shifts: [makeShift({ date: "2026-09-01", start: "09:00", end: "17:00", breakMinutes: 0 })],
    });
    const parsed = JSON.parse(buildAssistantContext(data, now));
    expect(parsed.settings.workMode).toBe("selbststaendig");
    expect(parsed.settings.minijobLimitApplies).toBe(false);
    expect(parsed.settings.legalMonthlyLimit).toBeNull();
    expect(parsed.settings.automaticMonthlyHours).toBeNull();
    expect(parsed.settings.annualLimit).toBeNull();
    expect(parsed.jobs[0].minijobLimitApplies).toBe(false);
  });

  it("fixed weekly plan does not imply Hauptbeschäftigung; explicit employmentType decides", () => {
    const now = new Date(2026, 8, 15);
    const data = makeData({
      jobs: [
        {
          id: "fest-mini",
          name: "Plan-Minijob",
          color: "#0d9488",
          mode: "fest",
          rate: 15,
          employmentType: "minijob",
        },
        {
          id: "main",
          name: "Hauptjob",
          color: "#111",
          mode: "fest",
          rate: 25,
          employmentType: "hauptbeschaeftigung",
        },
      ],
    });
    const parsed = JSON.parse(buildAssistantContext(data, now));
    expect(parsed.settings.minijobLimitApplies).toBe(true);
    expect(parsed.jobs.find((j: { id: string }) => j.id === "fest-mini").minijobLimitApplies).toBe(
      true,
    );
    expect(parsed.jobs.find((j: { id: string }) => j.id === "main").minijobLimitApplies).toBe(
      false,
    );
  });

  it("B: legacy fest job without employmentType → unknown, no minijob limit in AI context", () => {
    const now = new Date(2026, 8, 15);
    const data = makeData({
      jobs: [{ id: "legacy", name: "Alt-Fest", color: "#0d9488", mode: "fest", rate: 15 }],
    });
    const parsed = JSON.parse(buildAssistantContext(data, now));
    const legacy = parsed.jobs.find((j: { id: string }) => j.id === "legacy");
    expect(legacy.employmentType).toBe("unknown");
    expect(legacy.minijobLimitApplies).toBe(false);
    expect(parsed.settings.minijobLimitApplies).toBe(false);
  });

  it("A: legacy flex job without employmentType → minijob in AI context", () => {
    const now = new Date(2026, 8, 15);
    const data = makeData({
      jobs: [{ id: "legacy", name: "Alt-Flex", color: "#0d9488", mode: "flex", rate: 15 }],
    });
    const parsed = JSON.parse(buildAssistantContext(data, now));
    const legacy = parsed.jobs.find((j: { id: string }) => j.id === "legacy");
    expect(legacy.employmentType).toBe("minijob");
    expect(legacy.minijobLimitApplies).toBe(true);
    expect(parsed.settings.minijobLimitApplies).toBe(true);
  });
});

describe("historical AI context", () => {
  it("includes the current year and two prior years", () => {
    const data = makeData();
    const parsed = JSON.parse(buildAssistantContext(data, new Date(2026, 8, 15)));
    expect(parsed.historicalYears.map((x: { year: number }) => x.year)).toEqual([2024, 2025, 2026]);
  });

  it("B4-1: limit comparison uses Minijob-only earnings, not Hauptbeschäftigung", () => {
    const mj: Job = {
      id: "j1",
      name: "A",
      color: "#000",
      mode: "flex",
      employmentType: "minijob",
      rate: 14,
      startDate: "2025-01-01",
    };
    const hb: Job = {
      id: "h1",
      name: "HB",
      color: "#111",
      mode: "fest",
      employmentType: "hauptbeschaeftigung",
      rate: 20,
    };
    const shifts = [
      makeShift({ id: "m1", date: "2026-10-05", start: "08:00", end: "12:00", jobId: "j1" }),
      makeShift({ id: "m2", date: "2026-10-06", start: "08:00", end: "12:00", jobId: "h1" }),
    ];
    const ctx = JSON.parse(
      buildAssistantContext(makeData({ jobs: [mj, hb], shifts }), new Date("2026-10-10T12:00:00")),
    );
    expect(ctx.currentMonth.earnings).toBe(136);
    expect(ctx.currentMonth.minijobEarnings).toBe(56);
    expect(ctx.currentMonth.minijobHours).toBe(4);
    expect(ctx.year.minijobEarnings).toBe(56);
    expect(ctx.settings.legalMonthlyLimit).toBe(603);
  });

  it("B4-1: no Minijob limit → minijobEarnings null", () => {
    const hb: Job = {
      id: "h1",
      name: "HB",
      color: "#111",
      mode: "fest",
      employmentType: "hauptbeschaeftigung",
      rate: 20,
    };
    const ctx = JSON.parse(
      buildAssistantContext(
        makeData({ jobs: [hb], shifts: [makeShift({ date: "2026-10-06", jobId: "h1" })] }),
        new Date("2026-10-10T12:00:00"),
      ),
    );
    expect(ctx.currentMonth.minijobEarnings).toBeNull();
    expect(ctx.year.minijobEarnings).toBeNull();
  });
  it("N1 (documents current behaviour): earnings include future shifts of the month, minijobEarnings only up to today", () => {
    const mj: Job = {
      id: "j1",
      name: "A",
      color: "#000",
      mode: "flex",
      employmentType: "minijob",
      rate: 14,
      startDate: "2025-01-01",
    };
    const shifts = [
      makeShift({ id: "past", date: "2026-10-05", start: "08:00", end: "12:00", jobId: "j1" }),
      makeShift({ id: "future", date: "2026-10-20", start: "08:00", end: "12:00", jobId: "j1" }),
    ];
    const ctx = JSON.parse(
      buildAssistantContext(makeData({ jobs: [mj], shifts }), new Date("2026-10-10T12:00:00")),
    );
    // All-jobs totals of the month: past + planned future shift (2 × 4 h × 14 €).
    expect(ctx.currentMonth.earnings).toBe(112);
    expect(ctx.currentMonth.hours).toBe(8);
    expect(ctx.currentMonth.entriesCount).toBe(2);
    // Limit-relevant Minijob values: only up to currentDate (same as the UI limit card).
    expect(ctx.currentDate).toBe("2026-10-10");
    expect(ctx.currentMonth.minijobEarnings).toBe(56);
    expect(ctx.currentMonth.minijobHours).toBe(4);
    expect(ctx.year.earnings).toBe(112);
    expect(ctx.year.minijobEarnings).toBe(56);
    // N2 (owner decision): months[] stays the all-jobs sum incl. future shifts.
    const october = ctx.months.find((m: { month: number }) => m.month === 9);
    expect(october.earnings).toBe(112);
  });
});
