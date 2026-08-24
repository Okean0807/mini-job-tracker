import { describe, expect, it } from "vitest";

import {
  findRuleVersion,
  legalContextFor,
  minijobIncomeLimitFor,
  minijobLimitFromWage,
  minijobYearlyLimitFor,
  minimumWageFor,
  monthlyHoursLimitFor,
  pensionRulesFor,
  ruleVersionFor,
  taxRulesFor,
  LEGAL_RULE_VERSIONS,
} from "./index";

describe("Regelversion nach Datum", () => {
  it("wählt 2025 für ein Datum in 2025", () => {
    expect(ruleVersionFor("2025-06-15").id).toBe("de-2025");
  });

  it("wählt 2026 für ein Datum in 2026", () => {
    expect(ruleVersionFor("2026-08-24").id).toBe("de-2026");
  });

  it("wählt 2027 für ein Datum in 2027", () => {
    expect(ruleVersionFor("2027-03-01").id).toBe("de-2027");
  });

  it("akzeptiert Date-Objekte", () => {
    expect(ruleVersionFor(new Date(2026, 0, 1)).id).toBe("de-2026");
  });

  it("liefert keine Regel vor der ältesten Version", () => {
    expect(findRuleVersion("2020-01-01")).toBeUndefined();
    expect(() => ruleVersionFor("2020-01-01")).toThrow();
  });

  it("Versionen überschneiden sich nicht", () => {
    for (const v of LEGAL_RULE_VERSIONS) {
      if (!v.effectiveUntil) continue;
      expect(v.effectiveFrom <= v.effectiveUntil).toBe(true);
    }
  });
});

describe("Stichtagsgrenzen", () => {
  it("31.12.2025 nutzt noch 2025er Mindestlohn", () => {
    expect(minimumWageFor("2025-12-31")).toBe(12.82);
  });

  it("01.01.2026 nutzt den 2026er Mindestlohn", () => {
    expect(minimumWageFor("2026-01-01")).toBe(13.9);
  });

  it("31.12.2026 nutzt noch 2026er Werte", () => {
    expect(minimumWageFor("2026-12-31")).toBe(13.9);
    expect(minijobIncomeLimitFor("2026-12-31")).toBe(603);
  });

  it("01.01.2027 nutzt die 2027er Werte", () => {
    expect(minimumWageFor("2027-01-01")).toBe(14.6);
    expect(minijobIncomeLimitFor("2027-01-01")).toBe(633);
  });
});

describe("Mindestlohn und Minijob-Grenze", () => {
  it("2026: 13,90 € → 603 €", () => {
    expect(minimumWageFor("2026-05-01")).toBe(13.9);
    expect(minijobIncomeLimitFor("2026-05-01")).toBe(603);
    expect(minijobYearlyLimitFor("2026-05-01")).toBe(7236);
  });

  it("2027: 14,60 € → 633 €", () => {
    expect(minimumWageFor("2027-05-01")).toBe(14.6);
    expect(minijobIncomeLimitFor("2027-05-01")).toBe(633);
    expect(minijobYearlyLimitFor("2027-05-01")).toBe(7596);
  });

  it("rundet auf volle Euro auf", () => {
    expect(minijobLimitFromWage(12.82)).toBe(556); // 555,53
    expect(minijobLimitFromWage(12.41)).toBe(538); // 537,77
    expect(minijobLimitFromWage(13.9)).toBe(603); // 602,33
    expect(minijobLimitFromWage(14.6)).toBe(633); // 632,67
  });

  it("rundet glatte Werte nicht künstlich hoch", () => {
    // 12,00 × 130 / 3 = 520,00 exakt
    expect(minijobLimitFromWage(12)).toBe(520);
  });
});

describe("Historische Berechnungen bleiben an ihre Version gebunden", () => {
  it("verwendet für 2024/2025 keine späteren Regeln", () => {
    expect(minimumWageFor("2024-07-01")).toBe(12.41);
    expect(minijobIncomeLimitFor("2024-07-01")).toBe(538);
    expect(minijobIncomeLimitFor("2025-07-01")).toBe(556);
  });

  it("Grenzwerte je Jahr sind streng monoton nach Stichtag", () => {
    const dates = ["2024-06-01", "2025-06-01", "2026-06-01", "2027-06-01"];
    const limits = dates.map((d) => minijobIncomeLimitFor(d));
    expect(limits).toEqual([538, 556, 603, 633]);
  });
});

describe("Stundengrenze", () => {
  it("nutzt den Mindestlohn, wenn kein Satz übergeben wird", () => {
    expect(monthlyHoursLimitFor("2026-03-01")).toBeCloseTo(603 / 13.9, 6);
  });

  it("nutzt den übergebenen Stundenlohn", () => {
    expect(monthlyHoursLimitFor("2026-03-01", 20)).toBeCloseTo(603 / 20, 6);
  });
});

describe("Rentenversicherung und Steuer", () => {
  it("bildet die geltende RV-Pflicht mit Befreiungsmöglichkeit ab", () => {
    const rv = pensionRulesFor("2026-01-01");
    expect(rv.mandatory).toBe(true);
    expect(rv.exemptionPossible).toBe(true);
    expect(rv.employeeContributionRate).toBeCloseTo(0.036, 6);
    expect(rv.employerFlatRate).toBeCloseTo(0.15, 6);
  });

  it("RV-Regeln bleiben über die Versionen unverändert (keine erfundene Reform)", () => {
    expect(pensionRulesFor("2027-01-01")).toEqual(pensionRulesFor("2025-01-01"));
  });

  it("berechnet keine Arbeitnehmer-Lohnsteuer", () => {
    expect(taxRulesFor("2026-01-01").employeeIncomeTax).toBe("not-implemented");
    expect(taxRulesFor("2026-01-01").flatTaxRate).toBeCloseTo(0.02, 6);
  });
});

describe("legalContextFor", () => {
  it("bündelt die abgeleiteten Werte", () => {
    const ctx = legalContextFor("2026-02-02");
    expect(ctx.version.id).toBe("de-2026");
    expect(ctx.minimumWage).toBe(13.9);
    expect(ctx.minijobIncomeLimit).toBe(603);
    expect(ctx.minijobYearlyLimit).toBe(7236);
  });
});
