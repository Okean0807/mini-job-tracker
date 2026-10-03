import { describe, expect, it } from "vitest";

import { jobsPlannedOn } from "./schedule";
import { EMPTY_WEEK, type FixedDay, type Job, type Shift } from "./types";

const WED = "2026-09-30";
const SUN = "2026-09-27";

const onlyDay = (index: number): FixedDay[] =>
  EMPTY_WEEK.map((d, i) => ({ ...d, active: i === index }));

const job = (overrides: Partial<Job>): Job => ({
  id: "j",
  name: "Job",
  color: "#000",
  mode: "fest",
  week: EMPTY_WEEK,
  ...overrides,
});

const recorded = (jobId: string, date: string): Shift => ({
  id: `s-${jobId}`,
  jobId,
  kind: "arbeit",
  date,
  start: "09:00",
  end: "12:00",
  breakMinutes: 0,
});

describe("jobsPlannedOn (TodayImportantCard „heute geplant“ = Kalender-Regel)", () => {
  it("B1: flex job with the default EMPTY_WEEK (Mo–Fr active) is never planned", () => {
    expect(jobsPlannedOn([job({ mode: "flex" })], [], WED)).toEqual([]);
    expect(jobsPlannedOn([job({ mode: "selbststaendig" })], [], WED)).toEqual([]);
  });

  it("fest job with an active weekday and no entry is planned", () => {
    expect(jobsPlannedOn([job({})], [], WED).map((j) => j.id)).toEqual(["j"]);
  });

  it("an entry for that job on that day removes the plan", () => {
    expect(jobsPlannedOn([job({})], [recorded("j", WED)], WED)).toEqual([]);
    // entry of another job / another day does not count
    expect(jobsPlannedOn([job({})], [recorded("other", WED)], WED)).toHaveLength(1);
    expect(jobsPlannedOn([job({})], [recorded("j", SUN)], WED)).toHaveLength(1);
  });

  it("archived fest jobs and inactive weekdays are not planned", () => {
    expect(jobsPlannedOn([job({ archived: true })], [], WED)).toEqual([]);
    expect(jobsPlannedOn([job({ week: onlyDay(0) })], [], WED)).toEqual([]);
    const { week: _week, ...noWeek } = job({});
    expect(jobsPlannedOn([noWeek], [], WED)).toEqual([]);
  });

  it("weekday index is Monday-based (Sunday = 6)", () => {
    expect(jobsPlannedOn([job({ week: onlyDay(6) })], [], SUN)).toHaveLength(1);
    expect(jobsPlannedOn([job({ week: onlyDay(0) })], [], SUN)).toEqual([]);
    expect(jobsPlannedOn([job({ week: onlyDay(2) })], [], WED)).toHaveLength(1);
  });
});
