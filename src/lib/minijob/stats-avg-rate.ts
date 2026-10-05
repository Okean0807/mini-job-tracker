/**
 * S4 / B1: Ø Stundenlohn = Arbeitsverdienst / geleistete Stunden
 * (`workEarnings / workedHours`). Abwesenheitsentgelt zählt nicht im Zähler.
 */
export function avgHourlyRate(workEarnings: number, workedHours: number): number {
  if (!(workedHours > 0)) return 0;
  return workEarnings / workedHours;
}
