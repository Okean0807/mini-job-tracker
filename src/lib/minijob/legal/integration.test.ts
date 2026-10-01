import { describe, expect, it } from "vitest";
import { assessLegalIncome, buildMonthlyIncomeFromShifts, legalActualIncomeForMonth, legalActualIncomeForYear } from "./integration";
import type { AppData, Job, Settings, Shift } from "../types";
import { makeResolver } from "../resolve";

const settings = {
  defaultRate: 15,
  monthlyLimit: 603,
  limitAuto: true,
  yearlyLimit: 7236,
  hoursLimitMonthly: 0,
  hoursLimitAuto: false,
  supplements: {
    saturday: { enabled: false, mode: "prozent", value: 0 },
    sunday: { enabled: false, mode: "prozent", value: 0 },
    holiday: { enabled: false, mode: "prozent", value: 0 },
    night: { enabled: false, mode: "prozent", value: 0 },
    overtime: { enabled: false, mode: "prozent", value: 0 },
    nightStart: "23:00",
    nightEnd: "06:00",
  },
  bundesland: "NI",
} as Settings;

const job: Job = {
  id: "mini",
  name: "Mini",
  color: "#000",
  mode: "flex",
  employmentType: "minijob",
  rate: 15,
};

function resolve(shifts: Shift[]) {
  return makeResolver([job], settings);
}

function shift(id: string, date: string, hours = 4): Shift {
  return {
    id,
    jobId: "mini",
    kind: "arbeit",
    date,
    start: "09:00",
    end: `${String(9 + hours).padStart(2, "0")}:00`,
    breakMinutes: 0,
  };
}

describe("legal income integration", () => {
  it("separates past earned income from future expected income", () => {
    const shifts = [
      shift("a", "2026-09-10", 4),
      shift("b", "2026-09-30", 4),
    ];
    const result = buildMonthlyIncomeFromShifts(
      shifts,
      resolve(shifts),
      "2026-09-29",
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.actual).toBe(60);
    expect(result[0]?.expectedAdditional).toBe(60);
    expect(result[0]?.actualEntries).toBe(1);
    expect(result[0]?.expectedEntries).toBe(1);
  });

  it("excludes non-minijob employment from the legal income stream", () => {
    const main: Job = {
      ...job,
      id: "main",
      mode: "fest",
      employmentType: "hauptbeschaeftigung",
    };
    const shifts = [
      shift("mini", "2026-09-10", 4),
      { ...shift("main", "2026-09-11", 8), jobId: "main" },
    ];
    const resolver = makeResolver([job, main], settings);
    const result = buildMonthlyIncomeFromShifts(shifts, resolver, "2026-09-29");
    expect(result[0]?.actual).toBe(60);
  });

  it("feeds actual and expected values into the rolling forecast without mutating actuals", () => {
    const data = {
      shifts: [
        shift("a", "2026-09-10", 20),
        shift("b", "2026-09-30", 20),
      ],
      jobs: [job],
      customers: [],
      projects: [],
      payments: [],
      goals: [],
      orders: [],
      objects: [],
      settings,
    } as AppData;

    const result = assessLegalIncome(data, "2026-09-01", "2026-09-29");
    const september = result.months.find((m) => m.date === "2026-09-01");
    expect(september?.actual).toBe(300);
    expect(september?.expectedAdditional).toBe(300);
    expect(result.rolling.months.find((m) => m.date === "2026-09-01")?.projected).toBe(600);
  });
  it("provides canonical legal earnings for month and calendar year", () => {
    const main: Job = {
      ...job,
      id: "main",
      mode: "fest",
      employmentType: "hauptbeschaeftigung",
    };
    const shifts = [
      shift("mini-a", "2026-08-10", 4),
      { ...shift("main", "2026-08-11", 8), jobId: "main" },
      shift("mini-b", "2026-09-10", 4),
    ];
    const resolver = makeResolver([job, main], settings);
    expect(legalActualIncomeForMonth(shifts, resolver, 2026, 7, "2026-08-31")).toBe(60);
    expect(legalActualIncomeForYear(shifts, resolver, 2026, "2026-08-31")).toBe(60);
    expect(legalActualIncomeForYear(shifts, resolver, 2026, "2026-09-29")).toBe(120);
  });

});
