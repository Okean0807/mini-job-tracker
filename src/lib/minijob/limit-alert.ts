import { NEAR_LIMIT_RATIO } from "./legal/warnings";

/**
 * Dashboard-/Heute-Hinweis zur Minijob-Grenze (Business/UX-Regel, keine
 * Rechtsfolge). Gleiche Schwelle wie die Prognose-Warnungen (NEAR_LIMIT_RATIO).
 */
export const NEAR_LIMIT_PERCENT = NEAR_LIMIT_RATIO * 100;

export type LimitAlertLevel = "over" | "near" | null;

/**
 * `applies` = jobsApplyMinijobLimit(jobs). Ohne (bestätigten) Minijob gibt es
 * keinen Grenzhinweis – auch nicht für ungeklärte Altbestände.
 * Shares in Prozent (0–100+).
 */
export function limitAlertLevel(
  applies: boolean,
  monthShare: number,
  yearShare: number,
  /**
   * B3-1/O4: Hauptbeschäftigung + mehrere Minijobs → kein belastbarer Status.
   * `true` unterdrückt beide Bereiche; ein Objekt unterdrückt je Bereich
   * (Monat/Jahr), damit Banner und Karten denselben Zeitraum bewerten.
   */
  unreliable: boolean | { month: boolean; year: boolean } = false,
): LimitAlertLevel {
  if (!applies) return null;
  const skipMonth = typeof unreliable === "boolean" ? unreliable : unreliable.month;
  const skipYear = typeof unreliable === "boolean" ? unreliable : unreliable.year;
  const m = skipMonth ? 0 : monthShare;
  const y = skipYear ? 0 : yearShare;
  if (m >= 100 || y >= 100) return "over";
  if (m >= NEAR_LIMIT_PERCENT || y >= NEAR_LIMIT_PERCENT) return "near";
  return null;
}

/**
 * Anteile, die für Status/Banner verwendet werden dürfen: Bereiche mit
 * HB + mehreren Minijobs (B3-1/O4) zählen als 0 (kein belastbarer Status).
 */
export function effectiveLimitShares(
  monthShare: number,
  yearShare: number,
  unreliable: { month: boolean; year: boolean },
): { month: number; year: number } {
  return {
    month: unreliable.month ? 0 : monthShare,
    year: unreliable.year ? 0 : yearShare,
  };
}
