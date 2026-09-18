import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildDayTitle, isHolidayWorkDay, primaryDayKind } from "./MonthCalendar";
import type { Shift } from "@/lib/minijob/types";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "MonthCalendar.tsx"), "utf8");

function shift(partial: Partial<Shift> & { kind: Shift["kind"] }): Shift {
  return {
    id: partial.id ?? "s1",
    date: partial.date ?? "2026-09-01",
    start: "09:00",
    end: "17:00",
    breakMinutes: 30,
    overtime: false,
    ...partial,
  };
}

describe("MonthCalendar kind rendering (CAL-P2)", () => {
  it("exports distinct styles/icons for arbeit/krank/urlaub/feiertag + legend", () => {
    expect(src).toMatch(/KIND_STYLE/);
    expect(src).toMatch(/kind\.arbeit/);
    expect(src).toMatch(/kind\.krank/);
    expect(src).toMatch(/kind\.urlaub/);
    expect(src).toMatch(/kind\.feiertag/);
    expect(src).toMatch(/CalendarKindLegend/);
    expect(src).toMatch(/data-testid="calendar-kind-legend"/);
    expect(src).toMatch(/Briefcase|Thermometer|Palmtree|PartyPopper/);
    expect(src).toMatch(/data-kind=\{kind/);
  });

  it("primaryDayKind prefers arbeit then krank/urlaub/feiertag order", () => {
    expect(primaryDayKind([])).toBeNull();
    expect(primaryDayKind([shift({ kind: "feiertag" })])).toBe("feiertag");
    expect(primaryDayKind([shift({ kind: "krank" }), shift({ kind: "feiertag", id: "s2" })])).toBe(
      "krank",
    );
    expect(
      primaryDayKind([
        shift({ kind: "urlaub" }),
        shift({ kind: "arbeit", id: "s2" }),
      ]),
    ).toBe("arbeit");
  });
});

describe("MonthCalendar holiday + work dual display (Batch B)", () => {
  it("isHolidayWorkDay is true only when holiday name and arbeit coexist", () => {
    expect(isHolidayWorkDay([], "Ostern")).toBe(false);
    expect(isHolidayWorkDay([shift({ kind: "feiertag" })], "Ostern")).toBe(false);
    expect(isHolidayWorkDay([shift({ kind: "arbeit" })], undefined)).toBe(false);
    expect(isHolidayWorkDay([shift({ kind: "arbeit" })], "Ostern")).toBe(true);
  });

  it("buildDayTitle shows holiday, kind, hours and earnings together", () => {
    const title = buildDayTitle({
      holiday: "Ostermontag",
      kind: "arbeit",
      hours: 4,
      earnings: 54,
      kindLabel: (k) => k,
    });
    expect(title).toContain("Ostermontag");
    expect(title).toContain("arbeit");
    expect(title).toMatch(/4/);
    expect(title).toMatch(/54/);
  });

  it("cell markup keeps holiday marker alongside work (not color-only)", () => {
    expect(src).toMatch(/data-holiday-work/);
    expect(src).toMatch(/PartyPopper/);
    expect(src).toMatch(/Briefcase/);
    expect(src).toMatch(/borderLeftColor|borderLeftWidth/);
  });
});
