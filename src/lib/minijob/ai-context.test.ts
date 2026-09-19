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
});
