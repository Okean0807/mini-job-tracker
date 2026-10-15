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
  /** B3-1/O4: Hauptbeschäftigung + mehrere Minijobs → kein belastbarer Status. */
  unreliable = false,
): LimitAlertLevel {
  if (!applies || unreliable) return null;
  if (monthShare >= 100 || yearShare >= 100) return "over";
  if (monthShare >= NEAR_LIMIT_PERCENT || yearShare >= NEAR_LIMIT_PERCENT) return "near";
  return null;
}
