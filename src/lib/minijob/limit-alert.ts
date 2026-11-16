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
 * Drei getrennte Begriffe – nur der erste ist eine rechtliche Bewertung:
 *
 * 1. Rechtliche Prognose/Beurteilung (`forecastOver`): das Ergebnis der gleitenden
 *    12-Monats-Prognose der Legal Engine (`evaluateRollingWarning`). Das ist die
 *    einzige Stufe, die als Überschreitung formuliert wird.
 * 2. Statistische Ist-Werte (`yearAbove`, `monthAbove`): Der Verdienst des
 *    Kalenderjahres bzw. des Monats liegt über dem Richtwert. Das ist eine Zahl,
 *    keine Einstufung – maßgeblich ist das regelmäßige Entgelt im
 *    Beschäftigungszeitraum (höchstens 12 Monate); ein einzelner hoher Monat und
 *    ein Kalenderjahr über dem Richtwert sind für sich keine Überschreitung.
 * 3. Informative Hinweise (`highVariation`, `near`): ein Monat über dem Doppelten
 *    des Monatsrichtwerts – eine Summe innerhalb der Grenze belegt dann allein nicht,
 *    dass die Beschäftigung ein Minijob bleibt – und die 85-%-Schwelle (Business/UX).
 */
export type LimitAlertLevel =
  "forecastOver" | "highVariation" | "yearAbove" | "monthAbove" | "near" | null;

/**
 * `applies` = jobsApplyMinijobLimit(jobs). Ohne (bestätigten) Minijob gibt es
 * keinen Grenzhinweis – auch nicht für ungeklärte Altbestände.
 * Shares in Prozent (0–100+). Die Grenzen sind Obergrenzen: genau 100 % liegt
 * innerhalb, erst mehr als 100 % liegt darüber.
 *
 * `forecastStatus` ist der Status der gleitenden 12-Monats-Prognose
 * (`evaluateRollingWarning`), `highVariation` das Ergebnis von
 * `hasMonthAboveDoubleReference`. Alle Oberflächen (Dashboard, Heute-Karte,
 * Benachrichtigungen) leiten ihre Stufe aus dieser Funktion ab und können der
 * Prognose-Karte so nicht widersprechen. `yearShare` ist der Kalenderjahres-Ist-
 * Verdienst: bewusst nur ein statistischer Hinweis, nie eine Rechtsaussage.
 */
export function limitAlertLevel(
  applies: boolean,
  monthShare: number,
  yearShare: number,
  forecastStatus?: LegalWarningStatus,
  highVariation = false,
): LimitAlertLevel {
  if (!applies) return null;
  if (forecastStatus && isLegalExceedanceStatus(forecastStatus)) return "forecastOver";
  if (highVariation) return "highVariation";
  if (sharePastLimit(yearShare)) return "yearAbove";
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
