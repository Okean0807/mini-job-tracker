import { describe, expect, it } from "vitest";

import { generateAbsence } from "./schedule";
import type { Job } from "./types";

/**
 * Vitest project `tz-la` sets TZ=America/Los_Angeles at worker start
 * (see vitest.config.ts). Do not mutate process.env.TZ mid-file.
 */
function festJob(): Job {
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
  };
}

describe("generateAbsence (TZ=America/Los_Angeles)", () => {
  it("parst YYYY-MM-DD lokal und verliert keine Tage westlich von UTC", () => {
    // Prove project env applied to the Date subsystem (PST before 2026-03-08 DST).
    expect(process.env["TZ"]).toBe("America/Los_Angeles");
    expect(new Date(2026, 2, 2).getTimezoneOffset()).toBe(480);
    expect(new Date("2026-03-02").getDate()).toBe(1);

    // Mo 2026-03-02 .. Fr 2026-03-06 (UTC date-only parse would start on Mar 1 locally)
    const created = generateAbsence(festJob(), "urlaub", "2026-03-02", "2026-03-06", "BE");
    expect(created.map((s) => s.date)).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
    ]);
  });
});
