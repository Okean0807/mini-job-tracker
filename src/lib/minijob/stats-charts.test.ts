import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { tl } from "@/lib/i18n";

import { makeResolver } from "./resolve";
import {
  buildDailyMonthSeries,
  buildFestDailyMonthSeries,
  dailyChartTitle,
  dailyXAxisTicks,
  daysInCalendarMonth,
  formatDailyTooltipLine,
} from "./stats-charts";
import { DEFAULT_SETTINGS, EMPTY_WEEK, type Shift } from "./types";

const resolve = makeResolver([], { ...DEFAULT_SETTINGS, defaultRate: 20.25 });

function shift(date: string, start = "09:00", end = "16:30", breakMinutes = 0): Shift {
  return {
    id: `s-${date}-${start}`,
    kind: "arbeit",
    date,
    start,
    end,
    breakMinutes,
    rate: 20.25,
  } as Shift;
}

describe("daysInCalendarMonth", () => {
  it("kennt 28/29/30/31", () => {
    expect(daysInCalendarMonth(2026, 8)).toBe(30); // September
    expect(daysInCalendarMonth(2026, 1)).toBe(28); // Feb 2026
    expect(daysInCalendarMonth(2024, 1)).toBe(29); // leap
    expect(daysInCalendarMonth(2026, 0)).toBe(31); // January
  });
});

describe("buildDailyMonthSeries", () => {
  it("füllt alle Kalendertage inkl. Nullen für Tage ohne Arbeit", () => {
    const list = [shift("2026-09-20", "09:00", "16:30")];
    const series = buildDailyMonthSeries(2026, 8, list, resolve, list);
    expect(series).toHaveLength(30);
    expect(series[0]).toMatchObject({ day: 1, tag: "1", date: "2026-09-01", verdienst: 0, stunden: 0 });
    expect(series[29]).toMatchObject({ day: 30, tag: "30", date: "2026-09-30", verdienst: 0, stunden: 0 });
    const day20 = series[19]!;
    expect(day20.date).toBe("2026-09-20");
    expect(day20.stunden).toBe(7.5);
    expect(day20.verdienst).toBeCloseTo(7.5 * 20.25, 2);
    const zeroDays = series.filter((p) => p.stunden === 0 && p.verdienst === 0);
    expect(zeroDays).toHaveLength(29);
  });

  it("summiert mehrere Schichten am selben Tag", () => {
    const list = [shift("2026-09-05", "08:00", "12:00"), shift("2026-09-05", "14:00", "16:00")];
    const series = buildDailyMonthSeries(2026, 8, list, resolve, list);
    expect(series).toHaveLength(30);
    expect(series[4]!.stunden).toBe(6);
    expect(series[4]!.verdienst).toBeCloseTo(6 * 20.25, 2);
  });

  it("liefert nur Nullen wenn der Monat leer ist", () => {
    const series = buildDailyMonthSeries(2026, 1, [], resolve, []);
    expect(series).toHaveLength(28);
    expect(series.every((p) => p.verdienst === 0 && p.stunden === 0)).toBe(true);
  });
});

describe("dailyChartTitle", () => {
  it("baut Titel mit Monat und Jahr", () => {
    expect(dailyChartTitle("Verdienst pro Tag", "September", 2026)).toBe(
      "Verdienst pro Tag — September 2026",
    );
    expect(dailyChartTitle("Arbeitszeit pro Tag", "September", 2026)).toBe(
      "Arbeitszeit pro Tag — September 2026",
    );
  });
});

describe("formatDailyTooltipLine", () => {
  it("formatiert Datum + Stunden + € (de-DE)", () => {
    const line = formatDailyTooltipLine("2026-09-20", 7.5, 151.875, "de-DE");
    const normalized = line.replace(/\u00a0/g, " ");
    expect(normalized).toBe("20.09.2026 / 7,50 h / 151,88 €");
    expect(line).toContain("20.09.2026");
    expect(line).toContain("7,50 h");
    expect(line).toMatch(/151,88/);
  });
});

describe("dailyXAxisTicks", () => {
  it("zeigt bei kurzen Monaten alle Tage", () => {
    expect(dailyXAxisTicks(10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("verdichtet längere Monate, behält 1 und N", () => {
    const ticks = dailyXAxisTicks(30);
    expect(ticks[0]).toBe(1);
    expect(ticks[ticks.length - 1]).toBe(30);
    expect(ticks.length).toBeGreaterThanOrEqual(8);
    expect(ticks.length).toBeLessThanOrEqual(12);
    expect(new Set(ticks).size).toBe(ticks.length);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!);
    }
  });
});

describe("limit overrun disclaimer copy", () => {
  it("enthält Erklärung + Disclaimer ohne erfundene Steuerbeträge", () => {
    const explain = tl("de", "dash.limitOverExplain");
    const disclaimer = tl("de", "dash.limitDisclaimer");
    expect(explain.length).toBeGreaterThan(20);
    expect(disclaimer.length).toBeGreaterThan(20);
    expect(explain.toLowerCase()).toMatch(/überschreit|relevant|umständ/i);
    expect(disclaimer.toLowerCase()).toMatch(/keine.*steuer|rechtsberatung|keine individuelle/i);

    const banned = [/musst du \d/i, /zahlst du \d/i, /\d+\s*€\s*steuer/i, /steuerbetrag/i, /you must pay/i];
    for (const key of [
      "dash.limitOverExplain",
      "dash.limitDisclaimer",
      "dash.limitMonthOver",
      "limit.overExplain",
      "limit.disclaimer",
    ] as const) {
      for (const lang of ["de", "en", "ru", "tr", "pl"] as const) {
        const text = tl(lang, key);
        expect(text).not.toBe(key);
        for (const re of banned) {
          expect(text).not.toMatch(re);
        }
      }
    }
  });

  it("LimitBanner und LimitCard rendern Disclaimer-Keys", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const indexSrc = readFileSync(join(root, "routes/index.tsx"), "utf8");
    const cardSrc = readFileSync(join(root, "components/minijob/LimitCard.tsx"), "utf8");
    expect(indexSrc).toMatch(/dash\.limitOverExplain/);
    expect(indexSrc).toMatch(/dash\.limitDisclaimer/);
    expect(cardSrc).toMatch(/limit\.overExplain/);
    expect(cardSrc).toMatch(/limit\.disclaimer/);
  });
});


describe("buildFestDailyMonthSeries", () => {
  it("covers every day with soll/ist/diff", () => {
    const job = {
      id: "j1",
      name: "Fest",
      color: "#000",
      mode: "fest" as const,
      week: EMPTY_WEEK.map((d) => ({ ...d })),
    };
    const series = buildFestDailyMonthSeries(
      2026,
      8,
      job,
      [
        {
          id: "a",
          jobId: "j1",
          kind: "arbeit",
          date: "2026-09-01",
          start: "09:00",
          end: "18:00",
          breakMinutes: 30,
        },
      ],
      "BE",
    );
    expect(series).toHaveLength(30);
    expect(series[0]).toMatchObject({ day: 1, soll: 7.5, ist: 8.5, diff: 1 });
    expect(series[4]?.soll).toBe(0); // Saturday 2026-09-05
  });
});
