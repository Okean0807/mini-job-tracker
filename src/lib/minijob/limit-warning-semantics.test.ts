/**
 * AUD-09A – limit warning semantics.
 *
 * Three concepts are kept apart:
 * 1. Actual calendar-year / monthly earnings: statistical figures. Above the
 *    reference they are NOT a legal status (`yearAbove`, `monthAbove`).
 * 2. The regular remuneration over the applicable employment period (at most
 *    12 months): the basis of the legal assessment. The app's legal assessment is
 *    the rolling 12-month forecast (`forecastOver`).
 * 3. Informative hints: an extreme month (`highVariation`) and the 85 % threshold.
 *
 * Basis: § 8 SGB IV and the Minijob-Zentrale explanation of fluctuating earnings
 * (annual figure decides; 1,800 EUR for three months plus 204 EUR for nine months
 * adds up to 7,236 EUR but is not a Minijob; unpredictable exceedance in at most
 * two months, up to twice the monthly limit). Employment-period proration is NOT
 * implemented here and is covered by a documented-limitation test.
 */
import { describe, expect, it } from "vitest";

import { tl } from "@/lib/i18n";

import { assessLegalIncome, evaluateRollingWarning, type LegalWarningStatus } from "./legal";
import { hasMonthAboveDoubleReference, isLegalExceedanceStatus } from "./legal/warnings";
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

interface Outcome {
  monthEarnings: number;
  monthLimit: number;
  yearEarnings: number;
  yearShare: number;
  forecast: LegalWarningStatus;
  highVariation: boolean;
  regularLimit: number;
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
  const forecast = evaluateRollingWarning(rolling).status;
  const highVariation = hasMonthAboveDoubleReference(rolling);
  return {
    monthEarnings: mu.earnings,
    monthLimit: mu.earningsLimit,
    yearEarnings: yu.earnings,
    yearShare: yu.earningsShare,
    forecast,
    highVariation,
    regularLimit: rolling.regularLimit,
    level: limitAlertLevel(true, mu.share, yu.share, forecast, highVariation),
  };
}

describe("2026: monthly reference 603 EUR", () => {
  const run = (amount: number) => surface([shift("2026-06-03", amount)], 2026, 5, "2026-06-30");

  it("602.99 EUR – not exceeded", () => {
    const o = run(602.99);
    expect(o.monthLimit).toBe(603);
    expect(o.monthEarnings).toBe(602.99);
    expect(o.level).toBe("near");
  });

  it("603.00 EUR – not exceeded (an amount equal to the limit is within it)", () => {
    const o = run(603.0);
    expect(o.monthEarnings).toBe(603);
    expect(o.level).toBe("near");
    expect(isLegalExceedanceStatus(o.forecast)).toBe(false);
  });

  it("603.01 EUR – statistical month-above hint, not a legal violation", () => {
    const o = run(603.01);
    expect(o.monthEarnings).toBe(603.01);
    expect(o.level).toBe("monthAbove");
    expect(isLegalExceedanceStatus(o.forecast)).toBe(false);
    expect(o.highVariation).toBe(false);
  });
});

describe("2027: monthly reference 633 EUR", () => {
  const run = (amount: number) => surface([shift("2027-02-03", amount)], 2027, 1, "2027-02-28");

  it("632.99 and 633.00 EUR – not exceeded", () => {
    expect(run(632.99).monthLimit).toBe(633);
    expect(run(632.99).level).toBe("near");
    expect(run(633).level).toBe("near");
    expect(isLegalExceedanceStatus(run(633).forecast)).toBe(false);
  });

  it("633.01 EUR – statistical month-above hint, not a legal violation", () => {
    expect(run(633.01).level).toBe("monthAbove");
    expect(isLegalExceedanceStatus(run(633.01).forecast)).toBe(false);
  });
});

describe("the legal assessment (rolling 12 months) at the annual boundary", () => {
  const yearOf = (year: number, last: number) => {
    const shifts = months(
      year,
      Array.from({ length: 11 }, (_, i) => [i + 1, 600] as [number, number]),
    );
    shifts.push(shift(`${year}-12-02`, last));
    return surface(shifts, year, 11, `${year}-12-31`);
  };

  it("2026: 7,235.99 and 7,236.00 EUR are within, 7,236.01 EUR is above", () => {
    expect(isLegalExceedanceStatus(yearOf(2026, 635.99).forecast)).toBe(false);
    expect(isLegalExceedanceStatus(yearOf(2026, 636).forecast)).toBe(false);
    const over = yearOf(2026, 636.01);
    expect(isLegalExceedanceStatus(over.forecast)).toBe(true);
    expect(over.level).toBe("forecastOver");
  });

  it("2027: 7,596.00 EUR is within, 7,596.01 EUR is above", () => {
    expect(isLegalExceedanceStatus(yearOf(2027, 996).forecast)).toBe(false);
    expect(isLegalExceedanceStatus(yearOf(2027, 996.01).forecast)).toBe(true);
    expect(yearOf(2027, 996.01).level).toBe("forecastOver");
  });
});

describe("calendar-year actual total vs. the applicable regular-earnings assessment", () => {
  // 12 x 700 EUR = 8,400 EUR in the calendar year, but a March view only sees Jan-Mar
  const shifts = months(
    2026,
    Array.from({ length: 12 }, (_, i) => [i + 1, 700] as [number, number]),
  );

  it("a calendar-year total above 7,236 EUR is NOT a legal status when the assessment is compliant", () => {
    const o = surface(shifts, 2026, 2, "2026-12-31"); // viewing March
    expect(o.yearEarnings).toBe(8400);
    expect(o.yearShare).toBeGreaterThan(100);
    expect(isLegalExceedanceStatus(o.forecast)).toBe(false);
    expect(o.level).toBe("yearAbove");
    expect(o.level).not.toBe("forecastOver");
  });

  it("the same data viewed where the assessment covers the pace IS a legal warning", () => {
    const o = surface(shifts, 2026, 11, "2026-12-31"); // viewing December
    expect(isLegalExceedanceStatus(o.forecast)).toBe(true);
    expect(o.level).toBe("forecastOver");
  });

  it("an excessive regular pace is flagged while the year is still running", () => {
    const pace = months(
      2026,
      Array.from({ length: 9 }, (_, i) => [i + 1, 1000] as [number, number]),
    );
    const o = surface(pace, 2026, 8, "2026-09-30");
    expect(isLegalExceedanceStatus(o.forecast)).toBe(true);
    expect(o.level).toBe("forecastOver");
  });

  it("an excessive plan is flagged as a forecast, in the forecast card's own terms", () => {
    const plan = months(
      2026,
      Array.from({ length: 10 }, (_, i) => [i + 1, 600] as [number, number]),
    );
    plan.push(shift("2026-11-03", 1000), shift("2026-12-02", 1000));
    // The rolling window ends at the displayed month: look at December on 31 October.
    const o = surface(plan, 2026, 11, "2026-10-31");
    expect(isLegalExceedanceStatus(o.forecast)).toBe(true);
    expect(o.level).toBe("forecastOver");
  });
});

describe("employment starting partway through a year", () => {
  const job = { ...baseJob, startDate: "2026-07-01" };

  it("a regular pace far above the limit from the first months is a legal warning", () => {
    // 6 x 1,300 EUR (July-December) = 7,800 EUR
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
    expect(o.level).toBe("forecastOver");
  });

  it("a compliant pace is neither a legal warning nor a calendar-year 'exceedance'", () => {
    const o = surface(
      months(2026, [
        [7, 500],
        [8, 500],
        [9, 500],
        [10, 500],
        [11, 500],
        [12, 500],
      ]),
      2026,
      11,
      "2026-12-31",
      job,
    );
    expect(isLegalExceedanceStatus(o.forecast)).toBe(false);
    expect(o.level).not.toBe("forecastOver");
    expect(o.level).not.toBe("yearAbove");
  });
});

describe("employment known from the outset to last fewer than 12 months", () => {
  const job = { ...baseJob, startDate: "2026-11-01", endDate: "2026-12-31" };

  it("DOCUMENTED LIMITATION (proration is a separate task): the assessment still uses 12 full months, and the forecast card says so", () => {
    const o = surface(
      [shift("2026-11-03", 1000), shift("2026-12-02", 1000)],
      2026,
      11,
      "2026-12-31",
      job,
    );
    // Sources: for an employment of less than 12 months the limit is applied proportionally
    // (here 2 x 603 = 1,206 EUR). The engine does not do that yet, so it must not read as a
    // confirmation: it never calls this a legal exceedance and never an OK-with-certainty either.
    expect(o.regularLimit).toBe(7236);
    expect(o.level).not.toBe("forecastOver");
    for (const lang of ["de", "en", "ru", "tr", "pl"] as const) {
      expect(tl(lang, "legalForecast.disclaimer")).toMatch(/12/);
    }
    expect(tl("de", "legalForecast.disclaimer")).toMatch(/anteilig/);
  });
});

describe("a single high month, and extreme fluctuation", () => {
  it("one month at 1,000 EUR with an otherwise compliant assessment: no legal-violation state", () => {
    const o = surface([shift("2026-03-03", 1000)], 2026, 2, "2026-12-31");
    expect(o.level).toBe("monthAbove");
    expect(o.forecast).toBe("OK");
    expect(o.highVariation).toBe(false);
    expect(o.yearShare).toBeCloseTo((1000 / 7236) * 100, 6);
  });

  it("the actual monthly earnings stay visible and are not capped or hidden", () => {
    const o = surface([shift("2026-03-03", 1000)], 2026, 2, "2026-12-31");
    expect(o.monthEarnings).toBe(1000);
    expect(o.monthLimit).toBe(603);
  });

  it("the doubled monthly reference (1,206 EUR) is the line for the extreme-month hint", () => {
    expect(surface([shift("2026-03-03", 1206)], 2026, 2, "2026-12-31").highVariation).toBe(false);
    const above = surface([shift("2026-03-03", 1206.01)], 2026, 2, "2026-12-31");
    expect(above.highVariation).toBe(true);
    expect(above.level).toBe("highVariation");
  });

  it("extreme fluctuation inside the annual total is NOT silently compliant (Minijob-Zentrale example)", () => {
    // 1,800 EUR x 3 (Jan-Mar) + 204 EUR x 9 (Apr-Dec) = 7,236 EUR: within the annual limit,
    // yet the Minijob-Zentrale says the first three months are not a Minijob.
    const amounts: Array<[number, number]> = [
      [1, 1800],
      [2, 1800],
      [3, 1800],
      [4, 204],
      [5, 204],
      [6, 204],
      [7, 204],
      [8, 204],
      [9, 204],
      [10, 204],
      [11, 204],
      [12, 204],
    ];
    const o = surface(months(2026, amounts), 2026, 11, "2026-12-31");
    expect(o.yearEarnings).toBeCloseTo(7236, 6);
    expect(isLegalExceedanceStatus(o.forecast)).toBe(false);
    expect(o.highVariation).toBe(true);
    expect(o.level).toBe("highVariation");
    expect(o.level).not.toBeNull();
  });

  it("one very large month with the rest empty is also flagged, not waved through", () => {
    // December view: the rolling window is exactly calendar 2026 (12 x 603 = 7,236 EUR)
    const o = surface([shift("2026-05-04", 7000)], 2026, 11, "2026-12-31");
    expect(o.yearShare).toBeLessThan(100);
    expect(o.highVariation).toBe(true);
    expect(o.level).toBe("highVariation");
  });
});

describe("terminology: the legal level is the only one worded as an exceedance", () => {
  it("the calendar-year and month states are worded as statistics / references, not violations", () => {
    for (const lang of ["de", "en", "ru", "tr", "pl"] as const) {
      for (const key of ["dash.limitYearAbove", "limit.yearAboveNote"] as const) {
        const text = tl(lang, key);
        expect(text).not.toBe(key);
        expect(text.length).toBeGreaterThan(30);
      }
    }
    expect(tl("de", "dash.limitYearAbove")).toMatch(/Kalenderjahresverdienst über dem Richtwert/);
    expect(tl("de", "dash.limitYearAbove")).toMatch(/statistisch/);
    expect(tl("de", "dash.limitYearAbove")).toMatch(/keine rechtliche Einstufung/);
    expect(tl("de", "limit.yearAboveNote")).toMatch(/Kalenderjahresverdienst über dem Richtwert/);
    expect(tl("de", "dash.limitYearAbove")).not.toMatch(/überschritten/);
  });
});
