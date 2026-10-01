import { describe, expect, it } from "vitest";
import { shiftHours } from "./calc";
import type { Shift } from "./types";

const shift = (start: string, end: string, breakMinutes = 0): Shift => ({
  id: `${start}-${end}`,
  kind: "arbeit",
  date: "2026-03-28",
  start,
  end,
  breakMinutes,
});

describe("time calculation edge cases", () => {
  it("handles a shift crossing midnight", () => {
    expect(shiftHours(shift("22:00", "06:00"))).toBe(8);
    expect(shiftHours(shift("23:30", "00:30"))).toBe(1);
  });

  it("subtracts breaks after resolving a midnight crossing", () => {
    expect(shiftHours(shift("22:00", "06:00", 30))).toBe(7.5);
  });

  it("documents that DST is not represented by HH:mm-only shifts", () => {
    // A Shift contains a calendar date plus HH:mm, but no IANA timezone or
    // UTC timestamp. Therefore DST transition hours cannot be inferred here.
    expect(shift("22:00", "06:00").date).toBe("2026-03-28");
  });
});
