/**
 * AUD-09A/09C – limit warning semantics.
 *
 * Kept apart:
 * 1. Statistical actuals: the calendar-year total and the month's earnings against a
 *    REFERENCE (`yearAbove`, `monthAbove`) – numbers, not a legal status.
 * 2. The rolling 12-month earnings indicator ("Verdienste der letzten 12 Monate",
 *    `rollingAbove`): recorded earnings (plus shifts entered with a future date) of the 12
 *    calendar months ending at the displayed month against the sum of those months' limits.
 *    An INFORMATIONAL approximation – not the statutory forward-looking assessment of the
 *    regular earnings over the employment period (§ 8 SGB IV), so neither "above" is a legal
 *    violation nor "within" a proof of compliance.
 * 3. Informative hints (`highVariation`, `near`).
 *
 * Employment-period proration is NOT implemented and is covered by a documented-limitation
 * test.
 */
import { describe, expect, it } from "vitest";

import { tl } from "@/lib/i18n";

import { assessLegalIncome, evaluateRollingWarning, type LegalWarningStatus } from "./legal";
import { hasMonthAboveDoubleReference, isAboveRollingFrame } from "./legal/warnings";
import { limitAlertLevel, type LimitAlertLevel } from "./limit-alert";
import { monthUsage, yearUsage } from "./limits";
import { makeResolver } from "./resolve";
import { DEFAULT_SETTINGS, type AppData, type Job, type Settings, type Shift } from "./types";

const settings: Settings = { ...DEFAULT_SETTINGS, limitAuto: true };
const baseJob: Job = {
  id: "a",
  name: "A",
  color: "#000",
  mode: "flex",
  employmentType: "minijob",
  rate: 13.9,
};

let n = 0;
/** One-hour weekday shift whose earnings equal `amount` (rate = amount, no supplements). */
const shift = (date: string, amount: number): Shift => ({
  id: `s${n++}`,
  jobId: baseJob.id,
  kind: "arbeit",
  date,
  start: "08:00",
  end: "09:00",
  breakMinutes: 0,
  rate: amount,
});
const ym = (year: number, month: number, day = 3) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
/** One shift per listed month (1-based) with the given amount. */
const months = (year: number, amounts: Array<[number, number]>) =>
  amounts.map(([m, amount]) => shift(ym(year, m), amount));
const series = (year: number, amounts: number[]) =>
  amounts.map((amount, i) => shift(ym(year, i + 1), amount));

interface Outcome {
  monthEarnings: number;
  monthLimit: number;
  yearEarnings: number;
  yearShare: number;
  rolling: LegalWarningStatus;
  rollingActual: number;
  rollingPlanned: number;
  rollingTotal: number;
  highVariation: boolean;
  frame: number;
  level: LimitAlertLevel;
}

/** What the dashboard shows for `year`/`month` (0-based) at `referenceDate`. */
function surface(
  shifts: Shift[],
  year: number,
  month: number,
  referenceDate: string,
  job: Job = baseJob,
): Outcome {
  const resolve = makeResolver([job], settings);
  const mu = monthUsage(shifts, resolve, settings, year, month, referenceDate);
  const yu = yearUsage(shifts, resolve, settings, year, referenceDate);
  const data = { jobs: [job], shifts, settings } as AppData;
  const anchor = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const rolling = assessLegalIncome(data, anchor, referenceDate).rolling;
  const status = evaluateRollingWarning(rolling).status;
  const highVariation = hasMonthAboveDoubleReference(rolling);
  return {
    monthEarnings: mu.earnings,
    monthLimit: mu.earningsLimit,
    yearEarnings: yu.earnings,
    yearShare: yu.earningsShare,
    rolling: status,
    rollingActual: rolling.months.reduce((sum, m) => sum + m.actual, 0),
    rollingPlanned: rolling.months.reduce((sum, m) => sum + m.expectedAdditional, 0),
    rollingTotal: rolling.projectedEarnings,
    highVariation,
    frame: rolling.regularLimit,
    level: limitAlertLevel(true, mu.share, yu.share, status, highVariation),
  };
}

describe("2026: monthly reference 603 EUR (exact boundaries)", () => {
  const run = (amount: number) => surface([shift("2026-06-03", amount)], 2026, 5, "2026-06-30");

  it("602.99 EUR – not above", () => {
    const o = run(602.99);
    expect(o.monthLimit).toBe(603);
    expect(o.monthEarnings).toBe(602.99);
    expect(o.level).toBe("near");
  });

  it("603.00 EUR – not above (an amount equal to the limit is within it)", () => {
    const o = run(603.0);
    expect(o.monthEarnings).toBe(603);
    expect(o.level).toBe("near");
    expect(isAboveRollingFrame(o.rolling)).toBe(false);
  });

  it("603.01 EUR – statistical month-above hint, nothing more", () => {
    const o = run(603.01);
    expect(o.monthEarnings).toBe(603.01);
    expect(o.level).toBe("monthAbove");
    expect(isAboveRollingFrame(o.rolling)).toBe(false);
    expect(o.highVariation).toBe(false);
  });
});

describe("2027: monthly reference 633 EUR (exact boundaries)", () => {
  const run = (amount: number) => surface([shift("2027-02-03", amount)], 2027, 1, "2027-02-28");

  it("632.99 and 633.00 EUR – not above", () => {
    expect(run(632.99).monthLimit).toBe(633);
    expect(run(632.99).level).toBe("near");
    expect(run(633).level).toBe("near");
    expect(isAboveRollingFrame(run(633).rolling)).toBe(false);
  });

  it("633.01 EUR – statistical month-above hint, nothing more", () => {
    expect(run(633.01).level).toBe("monthAbove");
    expect(isAboveRollingFrame(run(633.01).rolling)).toBe(false);
  });
});

describe("the rolling 12-month indicator at the reference-range boundary", () => {
  const yearOf = (year: number, last: number) => {
    const shifts = months(
      year,
      Array.from({ length: 11 }, (_, i) => [i + 1, 600] as [number, number]),
    );
    shifts.push(shift(`${year}-12-02`, last));
    return surface(shifts, year, 11, `${year}-12-31`);
  };

  it("2026: 7,235.99 and 7,236.00 EUR are within the range, 7,236.01 EUR is above it", () => {
    expect(isAboveRollingFrame(yearOf(2026, 635.99).rolling)).toBe(false);
    expect(isAboveRollingFrame(yearOf(2026, 636).rolling)).toBe(false);
    const above = yearOf(2026, 636.01);
    expect(isAboveRollingFrame(above.rolling)).toBe(true);
    expect(above.level).toBe("rollingAbove");
  });

  it("2027: 7,596.00 EUR is within the range, 7,596.01 EUR is above it", () => {
    expect(isAboveRollingFrame(yearOf(2027, 996).rolling)).toBe(false);
    expect(isAboveRollingFrame(yearOf(2027, 996.01).rolling)).toBe(true);
    expect(yearOf(2027, 996.01).level).toBe("rollingAbove");
  });
});

describe("rolling earnings above / below the reference range – and what that does not prove", () => {
  it("above the range: the indicator says so, and nothing in the level is a legal violation", () => {
    const o = surface(series(2026, Array(12).fill(700)), 2026, 11, "2026-12-31");
    expect(o.rollingTotal).toBe(8400);
    expect(o.frame).toBe(7236);
    expect(o.level).toBe("rollingAbove");
    // wording: an orientation statement with an explicit "no legal determination" hint
    expect(tl("de", "rolling.statusAbove")).toBe(
      "Erfasste Verdienste über dem Orientierungsrahmen",
    );
    expect(tl("de", "rolling.aboveHint")).toMatch(/keine rechtliche Feststellung/);
  });

  it("below the range: the indicator says so, and the disclaimer says it proves no compliance", () => {
    const o = surface(series(2026, Array(12).fill(500)), 2026, 11, "2026-12-31");
    expect(o.rollingTotal).toBe(6000);
    expect(isAboveRollingFrame(o.rolling)).toBe(false);
    expect(tl("de", "rolling.statusWithin")).toBe(
      "Erfasste Verdienste innerhalb des Orientierungsrahmens",
    );
    expect(tl("de", "rolling.disclaimer")).toMatch(
      /nicht bestätigt, dass die Beschäftigung ein Minijob bleibt/,
    );
  });
});

describe("recorded earnings vs. shifts entered with a future date", () => {
  // today = 2026-06-15: 500 EUR recorded on 10 June, 700 EUR entered for 25 June
  const shifts = [shift("2026-06-10", 500), shift("2026-06-25", 700)];
  const o = () => surface(shifts, 2026, 5, "2026-06-15");

  it("keeps the two apart in the rolling figures and in the month's recorded earnings", () => {
    expect(o().rollingActual).toBe(500);
    expect(o().rollingPlanned).toBe(700);
    expect(o().rollingTotal).toBe(1200);
    expect(o().monthEarnings).toBe(500); // the month card counts recorded earnings only
  });

  it("explains that future-dated entries are planning, not a statutory forecast", () => {
    expect(tl("de", "rolling.plannedNote")).toMatch(/keine gesetzliche Prognose/);
    expect(tl("de", "rolling.planned")).toBe("Für später eingetragen");
  });
});

describe("calendar-year statistics and the rolling 12 months stay distinct", () => {
  // 12 x 700 EUR entered for 2026; today = 31 December. A March view sees Jan-Mar only.
  const shifts = series(2026, Array(12).fill(700));

  it("same data, two different figures on two different time bases", () => {
    const march = surface(shifts, 2026, 2, "2026-12-31");
    expect(march.yearEarnings).toBe(8400); // calendar-year statistic (whole year recorded)
    expect(march.rollingTotal).toBe(2100); // rolling 12 months ending in March (Jan-Mar)
    expect(march.rollingTotal).not.toBe(march.yearEarnings);
    expect(isAboveRollingFrame(march.rolling)).toBe(false);
    expect(march.level).toBe("yearAbove"); // the statistic, informational
    const december = surface(shifts, 2026, 11, "2026-12-31");
    expect(december.rollingTotal).toBe(8400);
    expect(december.level).toBe("rollingAbove");
  });

  it("a year-to-date pace above the range shows in the rolling indicator while the year runs", () => {
    const o = surface(series(2026, Array(9).fill(1000)), 2026, 8, "2026-09-30");
    expect(isAboveRollingFrame(o.rolling)).toBe(true);
    expect(o.level).toBe("rollingAbove");
  });
});

describe("employment starting partway through a year / fixed for fewer than 12 months", () => {
  it("a high recorded pace from the first months shows above the range", () => {
    const job = { ...baseJob, startDate: "2026-07-01" };
    const o = surface(
      months(2026, [
        [7, 1300],
        [8, 1300],
        [9, 1300],
        [10, 1300],
        [11, 1300],
        [12, 1300],
      ]),
      2026,
      11,
      "2026-12-31",
      job,
    );
    expect(o.yearEarnings).toBe(7800);
    expect(o.level).toBe("rollingAbove");
  });

  it("DOCUMENTED LIMITATION (proration is a separate task): the range always uses 12 full months, and the card says so", () => {
    const job = { ...baseJob, startDate: "2026-11-01", endDate: "2026-12-31" };
    const o = surface(
      [shift("2026-11-03", 1000), shift("2026-12-02", 1000)],
      2026,
      11,
      "2026-12-31",
      job,
    );
    expect(o.frame).toBe(7236);
    expect(o.level).not.toBe("rollingAbove");
    for (const lang of ["de", "en", "ru", "tr", "pl"] as const) {
      expect(tl(lang, "rolling.windowNote")).toMatch(/12/);
    }
    expect(tl("de", "rolling.windowNote")).toMatch(/anteilig/);
    expect(tl("de", "rolling.windowNote")).toMatch(/nicht berechnet/);
  });
});

describe("a single high month, and extreme fluctuation", () => {
  it("one month at 1,000 EUR: a month hint, no rolling finding", () => {
    const o = surface([shift("2026-03-03", 1000)], 2026, 2, "2026-12-31");
    expect(o.level).toBe("monthAbove");
    expect(o.rolling).toBe("OK");
    expect(o.highVariation).toBe(false);
    expect(o.yearShare).toBeCloseTo((1000 / 7236) * 100, 6);
  });

  it("the actual monthly earnings stay visible and are not capped or hidden", () => {
    const o = surface([shift("2026-03-03", 1000)], 2026, 2, "2026-12-31");
    expect(o.monthEarnings).toBe(1000);
    expect(o.monthLimit).toBe(603);
  });

  it("the doubled monthly reference (1,206 EUR) is only the line of an informational signal", () => {
    expect(surface([shift("2026-03-03", 1206)], 2026, 2, "2026-12-31").highVariation).toBe(false);
    const above = surface([shift("2026-03-03", 1206.01)], 2026, 2, "2026-12-31");
    expect(above.highVariation).toBe(true);
    expect(above.level).toBe("highVariation");
  });

  it("the signal is explicitly not the statutory exception and does not decide admissibility", () => {
    const de = tl("de", "rolling.signal");
    expect(de).toMatch(/Hinweis \(Orientierung\)/);
    expect(de).toMatch(
      /entscheidet nicht darüber, ob die gesetzliche Ausnahme für unvorhersehbares Überschreiten greift/,
    );
    expect(de).toMatch(/nichts über die Zulässigkeit schwankender Verdienste/);
    expect(de).toMatch(
      /Auch ohne dieses Signal sind starke Schwankungen nicht automatisch unbedenklich/,
    );
  });

  it("extreme fluctuation inside a total within the range is NOT silently fine (Minijob-Zentrale example)", () => {
    const o = surface(
      series(2026, [1800, 1800, 1800, 204, 204, 204, 204, 204, 204, 204, 204, 204]),
      2026,
      11,
      "2026-12-31",
    );
    expect(o.yearEarnings).toBeCloseTo(7236, 6);
    expect(isAboveRollingFrame(o.rolling)).toBe(false);
    expect(o.highVariation).toBe(true);
    expect(o.level).toBe("highVariation");
  });

  it("the signal's absence implies nothing: 6 x 1,150 EUR raises no signal and no acceptance statement", () => {
    const o = surface(
      series(2026, [1150, 1150, 1150, 1150, 1150, 1150, 0, 0, 0, 0, 0, 0]),
      2026,
      11,
      "2026-12-31",
    );
    expect(o.highVariation).toBe(false);
    expect(o.level).not.toBe("highVariation");
    expect(tl("de", "rolling.signal")).toMatch(/Auch ohne dieses Signal/);
  });
});
