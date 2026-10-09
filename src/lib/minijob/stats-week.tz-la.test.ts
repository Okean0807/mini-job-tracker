import { describe, expect, it } from "vitest";

import { assertWeekGoldens } from "./__fixtures__/stats-week-goldens";

// Runs with TZ=America/Los_Angeles (vitest project "tz-la", also in CI).
describe("stats-week in America/Los_Angeles", () => {
  it("TZ ist wirklich hinter UTC", () => {
    expect(new Date(2026, 9, 25, 12).getTimezoneOffset()).toBe(420);
  });

  it("alle S5-Goldens identisch", () => {
    assertWeekGoldens();
  });
});
