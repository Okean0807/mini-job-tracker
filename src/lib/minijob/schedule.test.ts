import { afterEach, describe, expect, it } from "vitest";

import { generateAbsence } from "./schedule";
import type { Job } from "./types";

const prevTz = process.env['TZ'];

afterEach(() => {
  if (prevTz === undefined) delete process.env['TZ'];
  else process.env['TZ'] = prevTz;
});

function festJob(partial: Partial<Job> = {}): Job {
  return {
    id: "j1",
    name: "Büro",
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
    ...partial,
  };
}

describe("generateAbsence", () => {
  it("parst YYYY-MM-DD lokal und verliert keine Tage westlich von UTC", () => {
    process.env['TZ'] = "America/Los_Angeles";
    // Mo 2026-03-02 .. Fr 2026-03-06 (UTC-parsed würde mit Feb 28 starten)
    const created = generateAbsence(festJob(), "urlaub", "2026-03-02", "2026-03-06", "BE");
    expect(created.map((s) => s.date)).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
    ]);
  });

  it("überspringt Wochenendtage ohne Festplan", () => {
    process.env['TZ'] = "Europe/Berlin";
    const flex: Job = {
      id: "j2",
      name: "Flex",
      color: "#111",
      rate: 12,
      mode: "flex",
      startDate: "2026-01-01",
    };
    // Fr–Mo: nur Fr + Mo
    const created = generateAbsence(flex, "krank", "2026-03-06", "2026-03-09", "BE");
    expect(created.map((s) => s.date)).toEqual(["2026-03-06", "2026-03-09"]);
  });
});
