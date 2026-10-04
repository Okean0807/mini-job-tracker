import { describe, expect, it } from "vitest";

import { assertCalendarGoldens } from "./__fixtures__/period-calendar-goldens";

// Runs with TZ=America/Los_Angeles (vitest project "tz-la", also in CI).
describe("period helpers in America/Los_Angeles", () => {
  it("TZ ist wirklich hinter UTC", () => {
    expect(new Date(2026, 9, 25, 12).getTimezoneOffset()).toBe(420); // PDT
    expect(new Date(2026, 11, 1, 12).getTimezoneOffset()).toBe(480); // PST
  });

  it("alle Kalender- und F1-Golden-Werte identisch", () => {
    assertCalendarGoldens();
  });
});
