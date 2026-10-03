import { describe, expect, it } from "vitest";
import { isWithinTimeWindow, previousCalendarDate } from "./notify-time";

describe("notification time helpers", () => {
  it("supports a reminder window crossing midnight", () => {
    expect(isWithinTimeWindow("23:50", "23:30", 90)).toBe(true);
    expect(isWithinTimeWindow("00:20", "23:30", 90)).toBe(true);
    expect(isWithinTimeWindow("01:00", "23:30", 90)).toBe(false);
  });

  it("uses calendar arithmetic for the previous day", () => {
    expect(previousCalendarDate("2026-03-30")).toBe("2026-03-29");
    expect(previousCalendarDate("2026-11-01")).toBe("2026-10-31");
    expect(previousCalendarDate("2026-01-01")).toBe("2025-12-31");
  });
});
