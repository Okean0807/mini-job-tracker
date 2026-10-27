/**
 * The three income paths behind the dashboard must agree on the same data:
 *  - legalActualIncomeForMonth / legalActualIncomeForYear (legal engine input),
 *  - monthUsage / yearUsage (limit cards),
 *  - assessLegalIncome (rolling 12-month forecast card).
 * assessLegalIncome used a private resolver (no holiday flag, no confirmed sick months), so a
 * holiday shift with a holiday supplement was 56 EUR there and 112 EUR in the other two.
 *
 * Rule pinned here (temporary): the app counts a holiday supplement IN FULL toward the Minijob
 * limit. The tax classification of an SFN supplement (tax-free "SFN-Zulage", base wage up to
 * 25 EUR/h, actual work on the holiday) is NOT implemented and is not inferred from the setting;
 * the data model cannot tell it from simply higher ordinary pay. Open question for the owner.
 */
import { describe, expect, it } from "vitest";

import { isoDate } from "../calc";
import { monthUsage, yearUsage } from "../limits";
import { shiftPayroll } from "../payroll";
import { makeResolver } from "../resolve";
import { withSickConfirmations } from "../sick-confirmation";
import { DEFAULT_SETTINGS, type AppData, type Job, type Settings, type Shift } from "../types";
import {
  assessLegalIncome,
  legalActualIncomeForMonth,
  legalActualIncomeForYear,
} from "./integration";

const RATE = 14;
const REF = "2026-12-31";

function settingsWith(holidayEnabled: boolean, extra: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    defaultRate: RATE,
    bundesland: "BY",
    supplements: {
      ...DEFAULT_SETTINGS.supplements,
      holiday: { enabled: holidayEnabled, mode: "prozent", value: 100 },
    },
    ...extra,
  };
}

const job = (extra: Partial<Job> = {}): Job =>
  ({
    id: "mini",
    name: "Mini",
    color: "#000",
    mode: "flex",
    employmentType: "minijob",
    rate: RATE,
    startDate: "2025-01-01",
    ...extra,
  }) as Job;

const work = (id: string, date: string): Shift => ({
  id,
  jobId: "mini",
  kind: "arbeit",
  date,
  start: "09:00",
  end: "13:00",
  breakMinutes: 0,
});

function dataOf(shifts: Shift[], settings: Settings, jobs: Job[] = [job()]): AppData {
  return {
    shifts,
    jobs,
    customers: [],
    projects: [],
    payments: [],
    goals: [],
    orders: [],
    objects: [],
    settings,
    timer: null,
  };
}

/** Month (December 2026) and year (2026) totals along all three paths. */
function paths(data: AppData) {
  const resolve = makeResolver(data.jobs, data.settings);
  const months = assessLegalIncome(data, "2026-12-01", REF).months;
  return {
    month: {
      legal: legalActualIncomeForMonth(data.shifts, resolve, 2026, 11, REF),
      usage: monthUsage(data.shifts, resolve, data.settings, 2026, 11, REF).earnings,
      assess: months.find((m) => m.date === "2026-12-01")?.actual ?? 0,
    },
    year: {
      legal: legalActualIncomeForYear(data.shifts, resolve, 2026, REF),
      usage: yearUsage(data.shifts, resolve, data.settings, 2026, REF).earnings,
      assess: months
        .filter((m) => m.date.startsWith("2026-"))
        .reduce((sum, m) => sum + m.actual, 0),
    },
  };
}

function expectAllEqual(p: ReturnType<typeof paths>, expected: number) {
  expect(p.month).toEqual({ legal: expected, usage: expected, assess: expected });
  expect(p.year).toEqual({ legal: expected, usage: expected, assess: expected });
}

describe("holiday supplement: all income paths agree", () => {
  // 25.12.2026 is a public holiday in Bayern; 4 h x 14 EUR = 56 EUR base.
  const holidayShift = work("h", "2026-12-25");

  it("supplement enabled: base 56 + supplement 56 = 112 on every path (counted in full)", () => {
    const data = dataOf([holidayShift], settingsWith(true));
    const p = shiftPayroll(holidayShift, {
      ...makeResolver(data.jobs, data.settings)(holidayShift),
    });
    expect(p.base).toBe(56);
    expect(p.bonus).toBe(56);
    expectAllEqual(paths(data), 112);
  });

  it("supplement disabled: 56 on every path", () => {
    expectAllEqual(paths(dataOf([holidayShift], settingsWith(false))), 56);
  });

  it("supplement enabled but no public holiday: 56 on every path", () => {
    const ordinary = work("o", "2026-12-22");
    expectAllEqual(paths(dataOf([ordinary], settingsWith(true))), 56);
  });

  it("a holiday and an ordinary day together: 168 on every path", () => {
    const data = dataOf([holidayShift, work("o", "2026-12-22")], settingsWith(true));
    expectAllEqual(paths(data), 168);
  });
});

describe("confirmed continuous sick months: all income paths agree", () => {
  const EVERY_DAY = Array.from({ length: 7 }, () => ({
    active: true,
    start: "09:00",
    end: "14:00",
    breakMinutes: 0,
  }));
  const sickJob = job({ week: EVERY_DAY } as unknown as Partial<Job>);

  function addDays(iso: string, n: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    return isoDate(new Date(y!, m! - 1, d! + n));
  }
  // 60 consecutive sick days from 2026-11-02: the continuous rule reaches beyond 42 days in
  // December (same fixture family as payroll.v10-sick-limitation.test.ts).
  const sickShifts: Shift[] = Array.from({ length: 60 }, (_, i) => {
    const date = addDays("2026-11-02", i);
    return {
      id: `k-${date}`,
      jobId: "mini",
      kind: "krank",
      date,
      start: "09:00",
      end: "14:00",
      breakMinutes: 0,
      sickRule: "continuous",
    } as Shift;
  });

  it("unconfirmed and confirmed December differ, and each state is identical on all paths", () => {
    const jobs = [sickJob];
    const unconfirmed = dataOf(sickShifts, settingsWith(false), jobs);
    const confirmations = withSickConfirmations([], ["2026-12"], sickShifts, jobs);
    expect(confirmations).toHaveLength(1);
    const confirmed = dataOf(
      sickShifts,
      settingsWith(false, { sickContinuousConfirmations: confirmations }),
      jobs,
    );

    const before = paths(unconfirmed);
    const after = paths(confirmed);

    // The confirmation must change the number at all, otherwise this test proves nothing.
    expect(after.month.usage).toBeLessThan(before.month.usage);

    expect(before.month.assess).toBe(before.month.usage);
    expect(before.month.legal).toBe(before.month.usage);
    expect(after.month.assess).toBe(after.month.usage);
    expect(after.month.legal).toBe(after.month.usage);
    expect(after.year.assess).toBe(after.year.usage);
    expect(after.year.legal).toBe(after.year.usage);
  });
});
