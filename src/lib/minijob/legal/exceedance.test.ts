import { describe, expect, it } from "vitest";

import {
  evaluateRolling12MonthExceedances,
  evaluateUnpredictableMonth,
} from "./exceedance";

describe("unvorhersehbares gelegentliches Überschreiten", () => {
  it("erlaubt in 2026 höchstens das Doppelte der Monatsgrenze", () => {
    expect(evaluateUnpredictableMonth("2026-09-01", 603, 0).allowed).toBe(true);
    expect(evaluateUnpredictableMonth("2026-09-01", 1206, 0).allowed).toBe(false);
    expect(evaluateUnpredictableMonth("2026-09-01", 1206, 0, true).allowed).toBe(true);
    expect(evaluateUnpredictableMonth("2026-09-01", 1206.01, 0, true).allowed).toBe(false);
  });

  it("begrenzt die Sondermonate auf zwei innerhalb des Betrachtungsfensters", () => {
    const months = [
      { date: "2026-01-01", earnings: 1206, unpredictable: true },
      { date: "2026-05-01", earnings: 1206, unpredictable: true },
      { date: "2026-09-01", earnings: 1206, unpredictable: true },
    ];
    const result = evaluateRolling12MonthExceedances(months);
    expect(result.allowed).toBe(false);
    expect(result.unpredictableMonths).toHaveLength(3);
  });

  it("berechnet 2026 die reguläre Jahresgrenze und das dokumentierte Maximum", () => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      date: `2026-${String(i + 1).padStart(2, "0")}-01`,
      earnings: 603,
      unpredictable: false,
    }));
    months[2]!.earnings = 1206;
    months[2]!.unpredictable = true;
    months[7]!.earnings = 1206;
    months[7]!.unpredictable = true;

    const result = evaluateRolling12MonthExceedances(months);
    expect(result.regularAnnualLimit).toBe(7236);
    expect(result.maximumAllowedAnnualIncome).toBe(8442);
    expect(result.allowed).toBe(true);
  });
});
