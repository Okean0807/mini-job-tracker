/**
 * Statistik (S3 / B4): rechtliche Minijob-Jahresgrenze unabhängig vom Job-Filter.
 *
 * Die Jahresgrenze ist eine personenbezogene Rechtsgröße: Alle Minijobs eines
 * Jahres zählen zusammen. Der Job-Filter der Statistik ist eine reine
 * Darstellungsauswahl (Verdienst, Stunden, Diagramme, Jobwerte) und darf die
 * rechtliche Kennzahl (Nutzung UND Prozent/Grenze) nicht verkleinern.
 *
 * Darum bekommt die Kennzahl IMMER alle Einträge. Welche Einträge rechtlich
 * zählen, entscheidet unverändert `yearUsage` (limits.ts) über
 * `isEligibleMinijobShift` (legal/employment.ts): nur `employmentType`
 * „minijob“ (aktiv am Datum), kein Klassifizieren über `mode`/workMode;
 * Hauptbeschäftigung, kurzfristig, selbstständig und ungeklärte Altbestände
 * („unknown“) zählen nicht. Hier wird nichts neu berechnet.
 */
import type { AnnualReport } from "./annual";
import { yearUsage, type LimitUsage } from "./limits";
import type { Resolver } from "./resolve";
import type { Settings, Shift } from "./types";

/**
 * Rechtliche Jahresnutzung für die Statistik.
 *
 * @param allShifts ALLE Einträge aus AppData – niemals die Job-gefilterte Liste.
 *                  Einen Filter-Parameter gibt es absichtlich nicht.
 */
export function statsLegalYearUsage(
  allShifts: Shift[],
  resolve: Resolver,
  settings: Settings,
  year: number,
  referenceDate?: string,
): LimitUsage {
  return referenceDate === undefined
    ? yearUsage(allShifts, resolve, settings, year)
    : yearUsage(allShifts, resolve, settings, year, referenceDate);
}

/**
 * Übernimmt in den (gefilterten) Jahresbericht nur die rechtlichen Felder
 * `limit`/`limitShare` aus der ungefilterten Jahresnutzung. Alle anderen
 * Berichtswerte (Verdienst, Stunden, Monate, Jobs …) bleiben gefiltert.
 */
export function withLegalYearLimit(report: AnnualReport, legal: LimitUsage): AnnualReport {
  return {
    ...report,
    limit: legal.earningsLimit,
    limitShare: legal.earningsShare,
  };
}
