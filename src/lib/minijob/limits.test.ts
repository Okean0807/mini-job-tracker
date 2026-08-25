import { describe, expect, it } from "vitest";

import { minijobLimitFromWage, minimumWageFor } from "./legal";
import {
  legalMonthlyLimit,
  monthUsage,
  monthlyHoursLimit,
  monthlyLimitOf,
  yearUsage,
  yearlyHoursLimitOf,
  yearlyLimitOf,
} from "./limits";
import { makeResolver } from "./resolve";
import { DEFAULT_SETTINGS, type Settings, type Shift } from "./types";

const base: Settings = { ...DEFAULT_SETTINGS, defaultRate: 15, limitAuto: true };
const resolve = makeResolver([], base);

function shift(date: string, start = "08:00", end = "12:00"): Shift {
  return { id: date, date, start, end, breakMinutes: 0, kind: "arbeit" } as Shift;
}

describe("Stichtagsbezogene Grenzen", () => {
  it("nutzt die gesetzliche Monatsgrenze des jeweiligen Jahres", () => {
    expect(legalMonthlyLimit(2025, 0)).toBe(minijobLimitFromWage(minimumWageFor("2025-01-01")));
    expect(monthlyLimitOf(base, 2025, 0)).toBe(556);
    expect(monthlyLimitOf(base, 2026, 0)).toBe(603);
    expect(monthlyLimitOf(base, 2027, 5)).toBe(633);
  });

  it("fällt vor der ältesten Regelversion auf den Nutzerwert zurück", () => {
    expect(legalMonthlyLimit(2020, 0)).toBeUndefined();
    expect(monthlyLimitOf(base, 2020, 0)).toBe(base.monthlyLimit);
  });

  it("respektiert eine manuell gesetzte Grenze", () => {
    const manual: Settings = { ...base, limitAuto: false, monthlyLimit: 400 };
    expect(monthlyLimitOf(manual, 2026, 0)).toBe(400);
    expect(yearlyLimitOf(manual, 2026)).toBe(4800);
  });

  it("bildet die Jahresgrenze als Summe der Monatsgrenzen", () => {
    expect(yearlyLimitOf(base, 2026)).toBe(603 * 12);
    expect(yearlyLimitOf(base, 2025)).toBe(556 * 12);
  });

  it("leitet die Stundengrenze aus der Grenze des Zeitraums ab", () => {
    expect(monthlyHoursLimit(base, 2026, 0)).toBeCloseTo(603 / 15, 6);
    expect(yearlyHoursLimitOf(base, 2026)).toBeCloseTo((603 / 15) * 12, 6);
  });

  it("nutzt bei manueller Stundengrenze weiterhin den festen Wert", () => {
    const manualHours: Settings = { ...base, hoursLimitAuto: false, hoursLimitMonthly: 30 };
    expect(monthlyHoursLimit(manualHours, 2026, 0)).toBe(30);
  });

  it("berechnet Auslastung mit der Grenze des betrachteten Monats", () => {
    const shifts = [shift("2025-03-03"), shift("2026-03-03")];
    const m2025 = monthUsage(shifts, resolve, base, 2025, 2);
    const m2026 = monthUsage(shifts, resolve, base, 2026, 2);
    expect(m2025.earningsLimit).toBe(556);
    expect(m2026.earningsLimit).toBe(603);
    expect(m2025.limitSource).toBe("legal");
    expect(m2025.earnings).toBe(60);
    expect(m2026.earnings).toBe(60);
  });

  it("markiert historische Zeiträume ohne Regel als manuell", () => {
    const u = yearUsage([], resolve, base, 2020);
    expect(u.limitSource).toBe("manual");
    expect(u.earningsLimit).toBe(base.monthlyLimit * 12);
  });
});
