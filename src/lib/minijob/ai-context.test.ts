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
      "forecast",
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
});

describe("buildAssistantContext — forecast separates facts, plans, projections and examples", () => {
  const now = new Date(2026, 9, 15); // Thu Oct 15, 2026
  const forecastOf = (data: AppData) => JSON.parse(buildAssistantContext(data, now));
  const rate15 = {
    settings: { ...DEFAULT_SETTINGS, defaultRate: 15 },
    jobs: [{ id: "j1", name: "Laden", color: "#0d9488", mode: "flex" as const, rate: 15 }],
  };

  it("no recorded or planned shifts: no personal forecast, no invented hours or earnings", () => {
    const parsed = forecastOf(makeData());
    const f = parsed.forecast;

    expect(f.dataBasedForecastPossible).toBe(false);
    expect(f.recordedToDate).toEqual({ entriesCount: 0, hours: 0, earnings: 0 });
    expect(f.plannedAfterToday).toEqual({ entriesCount: 0, hours: 0, earnings: 0 });
    expect(f.enteredTotal).toEqual({ hours: 0, earnings: 0 });
    expect(f.paceProjection).toBeNull();
    // No field carries an assumed schedule, hours per day or expected income.
    expect(Object.keys(f).sort()).toEqual([
      "calendarWeekdaysRemaining",
      "dataBasedForecastPossible",
      "daysElapsed",
      "daysInMonth",
      "enteredTotal",
      "paceProjection",
      "paceProjectionMethod",
      "paceProjectionUnavailableReason",
      "plannedAfterToday",
      "recordedToDate",
      "remainingLimitAmount",
      "rules",
      "workScheduleKnown",
    ]);
    expect(f.paceProjectionUnavailableReason).toBe("no_recorded_entries");
    expect(f.paceProjectionMethod).toBeNull();
    // The configured limit is only a ceiling.
    expect(f.remainingLimitAmount).toBe(parsed.settings.legalMonthlyLimit);

    const rules = f.rules.join(" ");
    expect(rules).toMatch(/keine persönliche Prognose berechnen/);
    expect(rules).toMatch(/Wähle keine angenommenen Stunden oder Tage selbst/);
    expect(rules).toMatch(/Frage stattdessen, wie viele Stunden/);
    expect(rules).toMatch(/nur mit Stunden, die der Nutzer selbst genannt hat/);
    expect(rules).toMatch(/'Beispiel – keine Prognose'/);
    expect(rules).toMatch(/nur die Obergrenze/);
    expect(rules).not.toMatch(/'Annahme'/);
  });

  it("calendar weekdays are calendar-only, never confirmed workdays", () => {
    const f = forecastOf(makeData()).forecast;
    expect(f.calendarWeekdaysRemaining).toBe(11); // Oct 16–31, 2026: Mon–Fri only
    expect(f.workScheduleKnown).toBe(false);
    expect(f).not.toHaveProperty("remainingWeekdays");
    const rules = f.rules.join(" ");
    expect(rules).toMatch(/nur verbleibende Kalender-Werktage, nicht die Arbeitstage/);
    expect(rules).toMatch(/kennt keinen Dienstplan/);
    expect(rules).toMatch(/rechne nicht mit ihnen/);
  });

  it("one recorded shift, nothing planned: no monthly projection, recorded and headroom unchanged", () => {
    // Preview case: Oct 25, one 4 h shift at the configured rate, no planned shifts.
    const parsed = JSON.parse(
      buildAssistantContext(
        makeData({
          settings: { ...DEFAULT_SETTINGS, defaultRate: 13.9 },
          jobs: [{ id: "j1", name: "Laden", color: "#0d9488", mode: "flex", rate: 13.9 }],
          shifts: [makeShift({ date: "2026-10-03", start: "09:00", end: "13:00" })], // 4h
        }),
        new Date(2026, 9, 25),
      ),
    );
    const f = parsed.forecast;

    expect(f.dataBasedForecastPossible).toBe(true);
    expect(f.recordedToDate).toEqual({ entriesCount: 1, hours: 4, earnings: 55.6 });
    expect(f.enteredTotal).toEqual({ hours: 4, earnings: 55.6 });
    expect(f.remainingLimitAmount).toBe(
      Number((parsed.settings.legalMonthlyLimit - 55.6).toFixed(2)),
    );
    // Previously 4 h / 25 d × 31 d = 4.96 h, €68.94 — no longer produced.
    expect(f.paceProjection).toBeNull();
    expect(f.paceProjectionMethod).toBeNull();
    expect(f.paceProjectionUnavailableReason).toBe("too_few_recorded_days");
    expect(JSON.stringify(f)).not.toMatch(/4\.96|68\.94/);
    const rules = f.rules.join(" ");
    expect(f.rules[0]).toMatch(/verlässliche Monatsprognose noch nicht möglich/);
    expect(rules).toMatch(/nenne keine hochgerechneten Monatswerte/);
    expect(rules).toMatch(/Ist paceProjection null, nenne keine Monatshochrechnung/);
  });

  it("several shifts on the same day still count as one recorded day (no projection)", () => {
    const f = forecastOf(
      makeData({
        ...rate15,
        shifts: [
          makeShift({ id: "a", date: "2026-10-05", start: "08:00", end: "10:00" }),
          makeShift({ id: "b", date: "2026-10-05", start: "14:00", end: "16:00" }),
        ],
      }),
    ).forecast;
    expect(f.recordedToDate.entriesCount).toBe(2);
    expect(f.paceProjection).toBeNull();
    expect(f.paceProjectionUnavailableReason).toBe("too_few_recorded_days");
  });

  it("recorded shifts only: recorded facts plus a pace projection from that data", () => {
    const parsed = forecastOf(
      makeData({
        ...rate15,
        shifts: [
          makeShift({ date: "2026-10-01", start: "09:00", end: "12:00" }), // 3h
          makeShift({ date: "2026-10-15", start: "09:00", end: "11:00" }), // 2h, today
        ],
      }),
    );
    const f = parsed.forecast;

    expect(parsed.settings.hourlyRate).toBe(15);
    expect(f.dataBasedForecastPossible).toBe(true);
    expect(f.recordedToDate).toEqual({ entriesCount: 2, hours: 5, earnings: 75 });
    expect(f.plannedAfterToday).toEqual({ entriesCount: 0, hours: 0, earnings: 0 });
    expect(f.enteredTotal).toEqual({ hours: 5, earnings: 75 });
    expect(f.paceProjection).toEqual({ hours: 10.33, earnings: 155 }); // 5h/15d × 31d
    expect(f.paceProjectionUnavailableReason).toBeNull();
    expect(f.paceProjectionMethod).toMatch(/÷ bisher vergangene Kalendertage .* × Tage im Monat/);
    expect(f.paceProjectionMethod).toMatch(/keine Zusage/);
    expect(f.rules.join(" ")).not.toMatch(/verlässliche Monatsprognose noch nicht möglich/);
    expect(f.remainingLimitAmount).toBe(
      Number((parsed.settings.legalMonthlyLimit - 75).toFixed(2)),
    );
    expect(f.rules.join(" ")).toMatch(/'Erfasst'.*'Geplant'.*'Erfasst \+ geplant'.*'Hochrechnung'/);
  });

  it("planned future shifts: reported as planned, summed with recorded, no extra extrapolation", () => {
    const parsed = forecastOf(
      makeData({
        ...rate15,
        shifts: [
          makeShift({ date: "2026-10-01", start: "09:00", end: "12:00" }), // 3h recorded
          makeShift({ date: "2026-10-20", start: "09:00", end: "13:00" }), // 4h planned
          makeShift({ date: "2026-10-27", start: "10:00", end: "12:00" }), // 2h planned
        ],
      }),
    );
    const f = parsed.forecast;

    expect(f.dataBasedForecastPossible).toBe(true);
    expect(f.recordedToDate).toEqual({ entriesCount: 1, hours: 3, earnings: 45 });
    expect(f.plannedAfterToday).toEqual({ entriesCount: 2, hours: 6, earnings: 90 });
    expect(f.enteredTotal).toEqual({ hours: 9, earnings: 135 });
    expect(f.paceProjection).toBeNull();
    expect(f.paceProjectionUnavailableReason).toBe("planned_entries_present");
    expect(parsed.currentMonth.earnings).toBe(135);
    expect(f.remainingLimitAmount).toBe(
      Number((parsed.settings.legalMonthlyLimit - 135).toFixed(2)),
    );
  });

  it("planned shifts without recorded work still count as data (no pace projection)", () => {
    const f = forecastOf(
      makeData({
        ...rate15,
        shifts: [makeShift({ date: "2026-10-22", start: "09:00", end: "12:00" })],
      }),
    ).forecast;
    expect(f.dataBasedForecastPossible).toBe(true);
    expect(f.recordedToDate.entriesCount).toBe(0);
    expect(f.plannedAfterToday).toEqual({ entriesCount: 1, hours: 3, earnings: 45 });
    expect(f.paceProjection).toBeNull();
  });

  it("uses configured rate and limit, never hardcoded personal values", () => {
    const custom = forecastOf(
      makeData({
        settings: { ...DEFAULT_SETTINGS, defaultRate: 21.5 },
        jobs: [{ id: "j1", name: "Büro", color: "#0d9488", mode: "flex", rate: 21.5 }],
        shifts: [makeShift({ date: "2026-10-02", start: "09:00", end: "11:00" })], // 2h
      }),
    );
    expect(custom.settings.hourlyRate).toBe(21.5);
    expect(custom.forecast.recordedToDate.earnings).toBe(43);
    expect(custom.forecast.remainingLimitAmount).toBe(
      Number((custom.settings.legalMonthlyLimit - 43).toFixed(2)),
    );
    expect(JSON.stringify(custom.forecast.rules)).not.toMatch(/13[,.]90|603|208/);
  });
});
