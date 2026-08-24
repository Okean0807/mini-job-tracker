/**
 * Auflösung der gesetzlichen Regeln nach Stichtag.
 * UI-unabhängig, ohne Abhängigkeit zur Berechnungs-Engine.
 */
import {
  LEGAL_RULE_VERSIONS,
  type LegalRuleVersion,
  type PensionRules,
  type TaxRules,
} from "./rules";

export { LEGAL_RULE_VERSIONS };
export type { LegalRuleVersion, PensionRules, TaxRules };

/** Faktor der Geringfügigkeitsgrenze: Mindestlohn × 130 ÷ 3 (§ 8 Abs. 1a SGB IV). */
export const MINIJOB_WEEKLY_HOURS_FACTOR = 130;
export const MINIJOB_MONTHS_FACTOR = 3;

function toIso(date: string | Date): string {
  if (typeof date === "string") return date.slice(0, 10);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Gültige Regelversion für ein Datum. Gibt undefined zurück, wenn das Datum
 * vor der ältesten hinterlegten Version liegt (keine Rückwirkung neuer Regeln).
 */
export function findRuleVersion(date: string | Date): LegalRuleVersion | undefined {
  const iso = toIso(date);
  let match: LegalRuleVersion | undefined;
  for (const version of LEGAL_RULE_VERSIONS) {
    if (version.effectiveFrom > iso) continue;
    if (version.effectiveUntil && version.effectiveUntil < iso) continue;
    if (!match || version.effectiveFrom > match.effectiveFrom) match = version;
  }
  return match;
}

/** Wie findRuleVersion, wirft aber bei fehlender Regel. */
export function ruleVersionFor(date: string | Date): LegalRuleVersion {
  const version = findRuleVersion(date);
  if (!version) throw new Error(`Keine gesetzliche Regelversion für ${toIso(date)} hinterlegt.`);
  return version;
}

/** Gesetzlicher Mindestlohn zum Stichtag (EUR/Stunde). */
export function minimumWageFor(date: string | Date): number {
  return ruleVersionFor(date).minimumWage;
}

/**
 * Geringfügigkeitsgrenze aus dem Mindestlohn:
 * Mindestlohn × 130 ÷ 3, aufgerundet auf volle Euro (§ 8 Abs. 1a SGB IV).
 */
export function minijobLimitFromWage(minimumWage: number): number {
  const raw = (minimumWage * MINIJOB_WEEKLY_HOURS_FACTOR) / MINIJOB_MONTHS_FACTOR;
  // Aufrunden auf volle Euro; kleine Gleitkomma-Toleranz vermeidet 603.0000000001 → 604.
  return Math.ceil(Number(raw.toFixed(6)));
}

/** Monatliche Geringfügigkeitsgrenze zum Stichtag (EUR). */
export function minijobIncomeLimitFor(date: string | Date): number {
  return minijobLimitFromWage(minimumWageFor(date));
}

/** Jahresgrenze: Monatsgrenze × 12. */
export function minijobYearlyLimitFor(date: string | Date): number {
  return minijobIncomeLimitFor(date) * 12;
}

/**
 * Zulässige Monatsstunden bei gegebenem Stundenlohn (Standard: Mindestlohn).
 * Rein informativ – ersetzt keine Arbeitszeitprüfung.
 */
export function monthlyHoursLimitFor(date: string | Date, hourlyRate?: number): number {
  const version = ruleVersionFor(date);
  const rate = typeof hourlyRate === "number" && hourlyRate > 0 ? hourlyRate : version.minimumWage;
  if (rate <= 0) return 0;
  return minijobLimitFromWage(version.minimumWage) / rate;
}

/** Rentenversicherungsregeln zum Stichtag. */
export function pensionRulesFor(date: string | Date): PensionRules {
  return ruleVersionFor(date).pension;
}

/** Steuerliche Rahmenparameter zum Stichtag. */
export function taxRulesFor(date: string | Date): TaxRules {
  return ruleVersionFor(date).tax;
}

/** Kompaktes Bündel aller abgeleiteten Werte – Grundlage künftiger Payroll-Regeln. */
export interface LegalContext {
  version: LegalRuleVersion;
  minimumWage: number;
  minijobIncomeLimit: number;
  minijobYearlyLimit: number;
  pension: PensionRules;
  tax: TaxRules;
}

export function legalContextFor(date: string | Date): LegalContext {
  const version = ruleVersionFor(date);
  const minijobIncomeLimit = minijobLimitFromWage(version.minimumWage);
  return {
    version,
    minimumWage: version.minimumWage,
    minijobIncomeLimit,
    minijobYearlyLimit: minijobIncomeLimit * 12,
    pension: version.pension,
    tax: version.tax,
  };
}
