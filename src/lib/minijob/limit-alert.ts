import { sharePastLimit } from "./legal/amounts";
import {
  NEAR_LIMIT_RATIO,
  isLegalExceedanceStatus,
  type LegalWarningStatus,
} from "./legal/warnings";

/**
 * Dashboard-/Heute-Hinweis zur Minijob-Grenze (Business/UX-Regel, keine
 * Rechtsfolge). Gleiche Schwelle wie die Prognose-Warnungen (NEAR_LIMIT_RATIO).
 */
export const NEAR_LIMIT_PERCENT = NEAR_LIMIT_RATIO * 100;

/**
 * - `over`         Jahresgrenze (Ist) tatsächlich überschritten – die einzige
 *                  Stufe, die als Überschreitung formuliert wird.
 * - `forecastOver` Die gleitende 12-Monats-Prognose der Legal Engine meldet eine
 *                  Überschreitung (gleicher Befund wie die Prognose-Karte).
 * - `monthAbove`   Der Monatsverdienst liegt über dem Monatsrichtwert, die
 *                  Jahresbetrachtung ist aber (noch) eingehalten – Hinweis, keine
 *                  Überschreitung: Monatliche Schwankungen sind unschädlich, solange
 *                  das regelmäßige Jahresentgelt die Jahresgrenze nicht überschreitet.
 * - `near`         Informativer Hinweis ab 85 % (Business/UX-Regel).
 */
export type LimitAlertLevel = "over" | "forecastOver" | "monthAbove" | "near" | null;

/**
 * `applies` = jobsApplyMinijobLimit(jobs). Ohne (bestätigten) Minijob gibt es
 * keinen Grenzhinweis – auch nicht für ungeklärte Altbestände.
 * Shares in Prozent (0–100+). Die Grenzen sind Obergrenzen: genau 100 % liegt
 * innerhalb, erst mehr als 100 % überschreitet.
 *
 * `forecastStatus` ist der Status der gleitenden 12-Monats-Prognose
 * (`evaluateRollingWarning`). Alle Oberflächen (Dashboard, Heute-Karte,
 * Benachrichtigungen) leiten ihre Stufe aus derselben Funktion ab und können
 * der Prognose-Karte so nicht widersprechen.
 */
export function limitAlertLevel(
  applies: boolean,
  monthShare: number,
  yearShare: number,
  forecastStatus?: LegalWarningStatus,
): LimitAlertLevel {
  if (!applies) return null;
  if (sharePastLimit(yearShare)) return "over";
  if (forecastStatus && isLegalExceedanceStatus(forecastStatus)) return "forecastOver";
  if (sharePastLimit(monthShare)) return "monthAbove";
  if (monthShare >= NEAR_LIMIT_PERCENT || yearShare >= NEAR_LIMIT_PERCENT) return "near";
  return null;
}

/** i18n key of the legal forecast card's status text for an exceeded forecast. */
export function forecastExceededTextKey(
  status: LegalWarningStatus,
):
  | "legalForecast.statusMaximum"
  | "legalForecast.statusRegularExceeded"
  | "legalForecast.statusSpecialPossible" {
  if (status === "MAXIMUM_EXCEEDED") return "legalForecast.statusMaximum";
  if (status === "UNPREDICTABLE_EXCEEDANCE_POSSIBLE") return "legalForecast.statusSpecialPossible";
  return "legalForecast.statusRegularExceeded";
}
