import { afterAll, describe, expect, it } from "vitest";

import { assertWeekGoldens } from "./__fixtures__/stats-week-goldens";

/** S5-Goldens unter Berlin / Los Angeles / Kiritimati / UTC im selben Prozess. */
const ORIGINAL_TZ = process.env["TZ"];

const ZONES = [
  ["Europe/Berlin", -120, -60],
  ["America/Los_Angeles", 420, 420],
  ["Pacific/Kiritimati", -840, -840],
  ["UTC", 0, 0],
] as const;

describe("stats-week: Zeitzonen-Matrix", () => {
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env["TZ"];
    else process.env["TZ"] = ORIGINAL_TZ;
  });

  it.each(ZONES)("%s: TZ aktiv und alle S5-Goldens identisch", (zone, before, after) => {
    process.env["TZ"] = zone;
    expect(new Date(2026, 9, 25, 0, 30).getTimezoneOffset()).toBe(before);
    expect(new Date(2026, 9, 26, 12).getTimezoneOffset()).toBe(after);
    assertWeekGoldens();
  });
});
