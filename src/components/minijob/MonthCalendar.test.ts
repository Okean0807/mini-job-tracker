import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildDayTitle, isHolidayWorkDay, KIND_STYLE, primaryDayKind } from "./MonthCalendar";
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
    expect(KIND_STYLE.arbeit.labelKey).toBe("kind.arbeit");
    expect(KIND_STYLE.krank.labelKey).toBe("kind.krank");
    expect(KIND_STYLE.urlaub.labelKey).toBe("kind.urlaub");
    expect(KIND_STYLE.feiertag.labelKey).toBe("kind.feiertag");
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

describe("MonthCalendar selected date (daily entry UX)", () => {
  it("highlights the selected calendar day without opening a dialog", () => {
    expect(src).toMatch(/selectedDate\?: string/);
    expect(src).toMatch(/data-date=\{iso\}/);
    expect(src).toMatch(/data-selected=\{iso === selectedDate \? "1" : undefined\}/);
    expect(src).toMatch(/onSelectDay\(iso\)/);
    expect(src).not.toMatch(/openNew|openEdit|ShiftDialog/);
  });
});

describe("MonthCalendar KIND_STYLE dark contrast (pre-release)", () => {
  it("uses brighter saturated tokens aligned with semantic ShiftKind colors", () => {
    expect(KIND_STYLE.arbeit.cell).toMatch(/emerald/);
    expect(KIND_STYLE.arbeit.cell).toMatch(/dark:bg-emerald-400\/35/);
    expect(KIND_STYLE.arbeit.legend).toMatch(/dark:bg-emerald-400/);

    expect(KIND_STYLE.krank.cell).toMatch(/red/);
    expect(KIND_STYLE.krank.cell).toMatch(/dark:bg-red-400\/35/);
    expect(KIND_STYLE.krank.legend).toMatch(/dark:bg-red-400/);

    expect(KIND_STYLE.urlaub.cell).toMatch(/amber/);
    expect(KIND_STYLE.urlaub.cell).toMatch(/dark:bg-amber-400\/35/);
    expect(KIND_STYLE.urlaub.legend).toMatch(/dark:bg-amber-400/);

    expect(KIND_STYLE.feiertag.cell).toMatch(/zinc/);
    expect(KIND_STYLE.feiertag.legend).toMatch(/dark:bg-zinc-400/);

    expect(KIND_STYLE.frei.cell).toMatch(/sky/);
    expect(KIND_STYLE.sonstige.cell).toMatch(/violet/);
  });

  it("keeps distinct hues for mobile distinguishability", () => {
    const cells = [
      KIND_STYLE.arbeit.cell,
      KIND_STYLE.krank.cell,
      KIND_STYLE.urlaub.cell,
      KIND_STYLE.feiertag.cell,
      KIND_STYLE.frei.cell,
      KIND_STYLE.sonstige.cell,
    ];
    expect(new Set(cells).size).toBe(6);
    expect(KIND_STYLE.arbeit.cell).not.toEqual(KIND_STYLE.krank.cell);
  });
});
