/**
 * Eine Quelle für die vier Stundenkennzahlen, die Statistik, Listen-Exporte und Jahresbericht
 * nebeneinander zeigen. Es wird nichts neu berechnet: alle Werte kommen aus `shiftPayroll`
 * (Arbeit und Entgeltfortzahlung getrennt) bzw. aus dem Wochenplan (Soll).
 *
 * - Gearbeitete Stunden:        nur Einträge der Art "arbeit"
 * - Bezahlte Abwesenheitsstunden: Urlaub / Krank / Feiertag, soweit tatsächlich bezahlt
 * - Gesamtstunden bezahlt:      Summe der beiden
 * - Soll-Stunden:               Plan-Soll fester Jobs; null, wenn kein fester Wochenplan existiert
 *
 * Unbezahlte Abwesenheit (z. B. nach dem 42. Krankheitstag) zählt in keiner der Summen.
 */
import { payrollTotals } from "./payroll";
import { monthTimeAccount } from "./fest-time-account";
import type { ResolveOptions } from "./resolve";
import type { Job, Shift } from "./types";

export interface HoursSummary {
  worked: number;
  paidAbsence: number;
  paidTotal: number;
  /** null = nicht verfügbar (kein Job mit festem Wochenplan im Umfang). */
  soll: number | null;
}

/**
 * Soll-Stunden laut Wochenplan für einen Monat (`month` 0–11) oder das ganze Jahr (`month` = null).
 * Nur Jobs mit `mode === "fest"` haben ein Soll; ohne solchen Job ist das Soll nicht verfügbar.
 */
export function sollHoursFor(
  jobs: Job[],
  year: number,
  month: number | null,
  bundesland = "",
): number | null {
  const fixed = jobs.filter((j) => j.mode === "fest");
  if (fixed.length === 0) return null;
  const months = month === null ? Array.from({ length: 12 }, (_, i) => i) : [month];
  let soll = 0;
  for (const job of fixed) {
    for (const m of months) soll += monthTimeAccount(job, year, m, [], bundesland).soll;
  }
  return Number(soll.toFixed(2));
}

export function summarizeHours(
  shifts: Shift[],
  resolve: (shift: Shift) => ResolveOptions,
  history: Shift[],
  soll: number | null,
): HoursSummary {
  const totals = payrollTotals(shifts, resolve, history);
  return {
    worked: totals.workedHours,
    paidAbsence: totals.paidAbsenceHours,
    paidTotal: totals.workedHours + totals.paidAbsenceHours,
    soll,
  };
}
