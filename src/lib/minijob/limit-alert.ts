import { sharePastLimit } from "./legal/amounts";
import { NEAR_LIMIT_RATIO, isAboveRollingFrame, type LegalWarningStatus } from "./legal/warnings";

/**
 * Dashboard-/Heute-Hinweis zur Minijob-Grenze (Business/UX-Regel, keine
 * Rechtsfolge). Gleiche Schwelle wie die Prognose-Warnungen (NEAR_LIMIT_RATIO).
 */
export const NEAR_LIMIT_PERCENT = NEAR_LIMIT_RATIO * 100;

/**
 * Getrennte Begriffe – keiner davon ist eine rechtliche Feststellung:
 *
 * 1. Gleitender 12-Monats-Verdienstindikator (`rollingAbove`): erfasste Verdienste der
 *    gleitenden 12 Monate bis zum angezeigten Monat (plus für später eingetragene Schichten)
 *    liegen über dem Orientierungsrahmen (Summe der Monatsgrenzen). Das ist eine Näherung und
 *    ersetzt nicht die vorausschauende Beurteilung des regelmäßigen Arbeitsentgelts im
 *    Beschäftigungszeitraum (§ 8 SGB IV). Auch „innerhalb“ bestätigt keinen Minijob.
 * 2. Statistische Ist-Werte (`yearAbove`, `monthAbove`): Der Verdienst des Kalenderjahres
 *    bzw. des Monats liegt über dem Richtwert – eine Zahl, keine Einstufung.
 * 3. Informative Hinweise (`highVariation`, `near`): ein Monat über dem Doppelten des
 *    Monatsrichtwerts (kein Gesetzesmaßstab, nicht die Ausnahme für unvorhersehbares
 *    Überschreiten) und die 85-%-Schwelle (Business/UX).
 *
 * Kalenderjahres-Statistik (`yearAbove`) und gleitende 12 Monate (`rollingAbove`) sind
 * verschiedene Zeitbasen und werden nie vermischt.
 */
export type LimitAlertLevel =
  "rollingAbove" | "highVariation" | "yearAbove" | "monthAbove" | "near" | null;

/**
 * `applies` = jobsApplyMinijobLimit(jobs). Ohne (bestätigten) Minijob gibt es
 * keinen Grenzhinweis – auch nicht für ungeklärte Altbestände.
 * Shares in Prozent (0–100+). Die Grenzen sind Obergrenzen: genau 100 % liegt
 * innerhalb, erst mehr als 100 % liegt darüber.
 *
 * `rollingStatus` ist der Status des gleitenden 12-Monats-Indikators
 * (`evaluateRollingWarning`), `highVariation` das Ergebnis von
 * `hasMonthAboveDoubleReference`. Alle Oberflächen (Dashboard, Heute-Karte,
 * Benachrichtigungen) leiten ihre Stufe aus dieser Funktion ab und können der
 * Karte „Verdienste der letzten 12 Monate“ so nicht widersprechen.
 */
export function limitAlertLevel(
  applies: boolean,
  monthShare: number,
  yearShare: number,
  rollingStatus?: LegalWarningStatus,
  highVariation = false,
): LimitAlertLevel {
  if (!applies) return null;
  if (rollingStatus && isAboveRollingFrame(rollingStatus)) return "rollingAbove";
  if (highVariation) return "highVariation";
  if (sharePastLimit(yearShare)) return "yearAbove";
  if (sharePastLimit(monthShare)) return "monthAbove";
  if (monthShare >= NEAR_LIMIT_PERCENT || yearShare >= NEAR_LIMIT_PERCENT) return "near";
  return null;
}
