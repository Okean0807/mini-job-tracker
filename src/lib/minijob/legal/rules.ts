/**
 * Versionierte gesetzliche Regeln (Deutschland) – reine Datenschicht.
 *
 * WICHTIG:
 * - Hier stehen ausschließlich geltende bzw. bereits rechtsverbindlich
 *   beschlossene Werte mit ihrem Inkrafttretensdatum.
 * - Reformvorschläge / Gesetzentwürfe gehören NICHT in diese Datei.
 * - Diese Schicht ist UI-unabhängig und enthält keine Berechnungs-Engine.
 */

/** Rentenversicherung im Minijob (§ 6 Abs. 1b SGB VI, § 168 SGB VI). */
export interface PensionRules {
  /** Minijobs sind grundsätzlich rentenversicherungspflichtig. */
  mandatory: boolean;
  /** Befreiung auf Antrag möglich. */
  exemptionPossible: boolean;
  /** Arbeitnehmeranteil (Aufstockung) als Dezimalwert, z. B. 0.036 = 3,6 %. */
  employeeContributionRate: number;
  /** Pauschalbeitrag des Arbeitgebers zur RV, z. B. 0.15 = 15 %. */
  employerFlatRate: number;
}

/**
 * Steuer/weitere Sozialversicherung: bewusst minimal.
 * Es wird KEINE Lohnsteuerberechnung implementiert – nur die gesetzlich
 * festgelegte, vom Arbeitgeber getragene Pauschsteuer (§ 40a Abs. 2 EStG)
 * als Erweiterungspunkt. Werte, die nicht belastbar sind, bleiben undefined.
 */
export interface TaxRules {
  /** Einheitliche Pauschsteuer, vom Arbeitgeber getragen (2 %). */
  flatTaxRate: number;
  /** Arbeitnehmer-Lohnsteuer wird bewusst nicht berechnet. */
  employeeIncomeTax: "not-implemented";
}

export interface LegalRuleVersion {
  /** Kennung, z. B. "de-2026". */
  id: string;
  /** Gültig ab (ISO yyyy-MM-dd), inklusive. */
  effectiveFrom: string;
  /** Gültig bis (ISO yyyy-MM-dd), inklusive – offen, wenn undefined. */
  effectiveUntil?: string;
  /** Gesetzlicher Mindestlohn in EUR/Stunde. */
  minimumWage: number;
  /** Rentenversicherungsregeln. */
  pension: PensionRules;
  /** Steuerliche Rahmenparameter (bewusst begrenzt). */
  tax: TaxRules;
  /** Rechtsquelle / Beleg. */
  source: string;
}

const PENSION_STANDARD: PensionRules = {
  mandatory: true,
  exemptionPossible: true,
  employeeContributionRate: 0.036,
  employerFlatRate: 0.15,
};

const TAX_STANDARD: TaxRules = {
  flatTaxRate: 0.02,
  employeeIncomeTax: "not-implemented",
};

/**
 * Chronologisch sortierte Regelversionen.
 * Ergänzung einer künftigen Rechtsänderung = ein weiterer Eintrag.
 */
export const LEGAL_RULE_VERSIONS: LegalRuleVersion[] = [
  {
    id: "de-2024",
    effectiveFrom: "2024-01-01",
    effectiveUntil: "2024-12-31",
    minimumWage: 12.41,
    pension: PENSION_STANDARD,
    tax: TAX_STANDARD,
    source: "MiLoV3 (Mindestlohnerhöhungsverordnung), § 8 Abs. 1a SGB IV",
  },
  {
    id: "de-2025",
    effectiveFrom: "2025-01-01",
    effectiveUntil: "2025-12-31",
    minimumWage: 12.82,
    pension: PENSION_STANDARD,
    tax: TAX_STANDARD,
    source: "MiLoV3, § 8 Abs. 1a SGB IV",
  },
  {
    id: "de-2026",
    effectiveFrom: "2026-01-01",
    effectiveUntil: "2026-12-31",
    minimumWage: 13.9,
    pension: PENSION_STANDARD,
    tax: TAX_STANDARD,
    source: "Vierte Mindestlohnanpassungsverordnung (MiLoV4), § 8 Abs. 1a SGB IV",
  },
  {
    id: "de-2027",
    effectiveFrom: "2027-01-01",
    minimumWage: 14.6,
    pension: PENSION_STANDARD,
    tax: TAX_STANDARD,
    source: "Vierte Mindestlohnanpassungsverordnung (MiLoV4), § 8 Abs. 1a SGB IV",
  },
];

/**
 * Bewusst NICHT abgebildet (Stand: geltendes Recht):
 * - vorgeschlagene Minijob-/Rentenreformen ohne Gesetzeskraft,
 * - individuelle Lohnsteuer- und Kranken-/Pflegeversicherungsberechnung,
 * - Midijob-Übergangsbereich (Gleitzone) – nicht im Anwendungsumfang.
 */
