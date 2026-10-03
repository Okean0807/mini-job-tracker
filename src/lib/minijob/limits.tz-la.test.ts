import { afterEach, describe, expect, it, vi } from "vitest";

import { monthUsage, yearUsage } from "./limits";
import { makeResolver } from "./resolve";
import { DEFAULT_SETTINGS } from "./types";

// Runs with TZ=America/Los_Angeles (vitest project "tz-la").
// 2026-09-30 20:00 local (PDT) = 2026-10-01 03:00 UTC: the default reference
// date must be the LOCAL calendar day, not the UTC one.
describe("limits default referenceDate is the local day", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("monthUsage / yearUsage default to isoDate(new Date()), not toISOString()", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T03:00:00Z"));
    expect(new Date().getDate()).toBe(30); // sanity: TZ really is behind UTC
    const settings = { ...DEFAULT_SETTINGS, limitAuto: true };
    const resolve = makeResolver([], settings);
    expect(monthUsage([], resolve, settings, 2026, 8).referenceDate).toBe("2026-09-30");
    expect(yearUsage([], resolve, settings, 2026).referenceDate).toBe("2026-09-30");
  });
});
