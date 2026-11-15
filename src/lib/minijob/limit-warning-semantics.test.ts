/**
 * AUD-09A – limit warning semantics.
 *
 * The statutory limits are upper bounds, and a single month above the monthly
 * reference amount is not automatically an exceedance: monthly fluctuations are
 * harmless as long as the regular annual earnings stay within the annual limit
 * (§ 8 SGB IV; Minijob-Zentrale: fluctuating earnings).
 *
 * These tests run the real engine (monthUsage / yearUsage / assessLegalIncome)
 * and the one decision every surface uses (limitAlertLevel).
 */
import { describe, expect, it } from "vitest";

import { evaluateRollingWarning, assessLegalIncome, type LegalWarningStatus } from "./legal";
import { isLegalExceedanceStatus } from "./legal/warnings";
import { limitAlertLevel, type LimitAlertLevel } from "./limit-alert";
import { monthUsage, yearUsage } from "./limits";
import { makeResolver } from "./resolve";
import { DEFAULT_SETTINGS, type AppData, type Job, type Settings, type Shift } from "./types";

const settings: Settings = { ...DEFAULT_SETTINGS, limitAuto: true };
const job: Job = {
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
  jobId: job.id,
  kind: "arbeit",
  date,
  start: "08:00",
  end: "09:00",
  breakMinutes: 0,
  rate: amount,
});

interface Outcome {
  monthEarnings: number;
  monthLimit: number;
  yearShare: number;
  forecast: LegalWarningStatus;
  level: LimitAlertLevel;
}

/** What the dashboard shows for `year`/`month` (0-based) at `referenceDate`. */
function surface(shifts: Shift[], year: number, month: number, referenceDate: string): Outcome {
  const resolve = makeResolver([job], settings);
  const mu = monthUsage(shifts, resolve, settings, year, month, referenceDate);
  const yu = yearUsage(shifts, resolve, settings, year, referenceDate);
  const data = { jobs: [job], shifts, settings } as AppData;
  const anchor = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const forecast = evaluateRollingWarning(
    assessLegalIncome(data, anchor, referenceDate).rolling,
  ).status;
  return {
    monthEarnings: mu.earnings,
    monthLimit: mu.earningsLimit,
    yearShare: yu.earningsShare,
    forecast,
    level: limitAlertLevel(true, mu.share, yu.share, forecast),
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
    expect(o.level).not.toBe("over");
    expect(isLegalExceedanceStatus(o.forecast)).toBe(false);
  });

  it("603.01 EUR – not automatically a legal violation because of the monthly amount", () => {
    const o = run(603.01);
    expect(o.monthEarnings).toBe(603.01);
    expect(o.level).toBe("monthAbove");
    expect(isLegalExceedanceStatus(o.forecast)).toBe(false);
    expect(o.yearShare).toBeLessThan(10);
  });
});

describe("2027: monthly reference 633 EUR", () => {
  const run = (amount: number) => surface([shift("2027-02-03", amount)], 2027, 1, "2027-02-28");

  it("632.99 EUR – not exceeded", () => {
    const o = run(632.99);
    expect(o.monthLimit).toBe(633);
    expect(o.level).toBe("near");
  });

  it("633.00 EUR – not exceeded", () => {
    const o = run(633.0);
    expect(o.monthEarnings).toBe(633);
    expect(o.level).toBe("near");
    expect(isLegalExceedanceStatus(o.forecast)).toBe(false);
  });

  it("633.01 EUR – not automatically a legal violation because of the monthly amount", () => {
    const o = run(633.01);
    expect(o.level).toBe("monthAbove");
    expect(isLegalExceedanceStatus(o.forecast)).toBe(false);
  });
});

describe("annual boundary (exact amounts, applicable annual assessment)", () => {
  const yearOf = (year: number, last: number) => {
    const shifts: Shift[] = [];
    for (let m = 1; m <= 11; m++)
      shifts.push(shift(`${year}-${String(m).padStart(2, "0")}-03`, 600));
    shifts.push(shift(`${year}-12-02`, last));
    return surface(shifts, year, 11, `${year}-12-31`);
  };

  it("2026: 7,235.99 and 7,236.00 EUR are within the annual limit, 7,236.01 is not", () => {
    expect(yearOf(2026, 635.99).level).not.toBe("over");
    expect(isLegalExceedanceStatus(yearOf(2026, 635.99).forecast)).toBe(false);
    expect(yearOf(2026, 636).level).not.toBe("over");
    expect(isLegalExceedanceStatus(yearOf(2026, 636).forecast)).toBe(false);
    const over = yearOf(2026, 636.01);
    expect(over.level).toBe("over");
    expect(isLegalExceedanceStatus(over.forecast)).toBe(true);
  });

  it("2027: 7,596.00 EUR is within, 7,596.01 EUR exceeds", () => {
    // 11 x 600 = 6,600 -> remainder 996.00 / 996.01
    expect(yearOf(2027, 996).level).not.toBe("over");
    expect(yearOf(2027, 996.01).level).toBe("over");
  });
});

describe("fluctuating earnings", () => {
  it("one month at 1,000 EUR with a compliant annual assessment is no legal-violation banner", () => {
    const o = surface([shift("2026-03-03", 1000)], 2026, 2, "2026-12-31");
    expect(o.level).toBe("monthAbove");
    expect(o.level).not.toBe("over");
    expect(o.level).not.toBe("forecastOver");
    expect(o.forecast).toBe("OK");
    expect(o.yearShare).toBeCloseTo((1000 / 7236) * 100, 6);
  });

  it("the actual monthly earnings stay visible and are not capped or hidden", () => {
    const o = surface([shift("2026-03-03", 1000)], 2026, 2, "2026-12-31");
    expect(o.monthEarnings).toBe(1000);
    expect(o.monthLimit).toBe(603);
  });

  it("a genuinely excessive regular annual assessment still produces a warning", () => {
    // 12 months x 700 EUR = 8,400 EUR > 7,236 EUR
    const shifts: Shift[] = [];
    for (let m = 1; m <= 12; m++) shifts.push(shift(`2026-${String(m).padStart(2, "0")}-03`, 700));
    const o = surface(shifts, 2026, 11, "2026-12-31");
    expect(o.level).toBe("over");
    expect(isLegalExceedanceStatus(o.forecast)).toBe(true);
  });

  it("an excessive pace is flagged while the year is still running (year-to-date)", () => {
    // 9 x 1,000 EUR by September = 9,000 EUR > 7,236 EUR already
    const shifts: Shift[] = [];
    for (let m = 1; m <= 9; m++) shifts.push(shift(`2026-${String(m).padStart(2, "0")}-03`, 1000));
    const o = surface(shifts, 2026, 8, "2026-09-30");
    expect(o.level).toBe("over");
  });

  it("an excessive plan is flagged as a forecast, in the forecast card's own terms", () => {
    // actual to October 6,000 EUR; planned November/December 1,000 EUR each -> 8,000 EUR > 7,236 EUR
    const shifts: Shift[] = [];
    for (let m = 1; m <= 10; m++) shifts.push(shift(`2026-${String(m).padStart(2, "0")}-03`, 600));
    shifts.push(shift("2026-11-03", 1000), shift("2026-12-02", 1000));
    // The rolling window ends at the displayed month: look at December on 31 October.
    const o = surface(shifts, 2026, 11, "2026-10-31");
    expect(isLegalExceedanceStatus(o.forecast)).toBe(true);
    expect(o.level).toBe("forecastOver");
  });
});

describe("cross-surface consistency", () => {
  const scenarios: Array<[string, Shift[], number, number, string]> = [
    ["603.00", [shift("2026-06-03", 603)], 2026, 5, "2026-06-30"],
    ["603.01", [shift("2026-06-03", 603.01)], 2026, 5, "2026-06-30"],
    ["1000 single month", [shift("2026-03-03", 1000)], 2026, 2, "2026-12-31"],
    [
      "12 x 700",
      Array.from({ length: 12 }, (_, i) => shift(`2026-${String(i + 1).padStart(2, "0")}-03`, 700)),
      2026,
      11,
      "2026-12-31",
    ],
    [
      "plan 8,000",
      [
        ...Array.from({ length: 10 }, (_, i) =>
          shift(`2026-${String(i + 1).padStart(2, "0")}-03`, 600),
        ),
        shift("2026-11-03", 1000),
        shift("2026-12-02", 1000),
      ],
      2026,
      11,
      "2026-10-31",
    ],
  ];

  it.each(scenarios)(
    "%s: banner level and legal forecast never contradict each other",
    (_n, shifts, y, m, ref) => {
      const o = surface(shifts, y, m, ref);
      const exceeded = isLegalExceedanceStatus(o.forecast);
      // forecast says exceeded  =>  the banner level says exceeded (actual or forecast)
      if (exceeded) expect(["over", "forecastOver"]).toContain(o.level);
      // the banner says exceeded  =>  the actual annual figure or the forecast backs it up
      if (o.level === "over") expect(o.yearShare).toBeGreaterThan(100);
      if (o.level === "forecastOver") expect(exceeded).toBe(true);
      // a lone month above the reference never reads as an exceedance by itself
      if (o.level === "monthAbove") expect(exceeded).toBe(false);
    },
  );
});
