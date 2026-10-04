/**
 * Adapter zwischen der bestehenden Payroll (`payroll.ts`, unverändert) und den
 * generischen Aggregations-Helfern (`period-aggregate.ts`).
 *
 * - Ruft ausschließlich `shiftPayroll` auf – je Schicht genau einmal – und
 *   übergibt IMMER die vollständige Historie (`history` ist Pflicht). Damit
 *   bleiben 13-Wochen-Urlaubsentgelt, Krankheitsfälle und Arbeitsmuster
 *   identisch zu Monat/Jahr/Dashboard (keine Periodenhistorie wie in B2).
 * - Die Feldzuordnung entspricht `payrollTotals` (work- vs. absenceEarnings nach
 *   `kind === "arbeit"`), sodass Σ `payrollValues` = `payrollTotals(list, resolve, history)`.
 * - Für Memoisierung (S4/S5): Ergebnis von `evaluateShifts(allShifts, …)` einmal
 *   pro Datenstand berechnen und für alle Zeiträume/Gruppen wiederverwenden.
 */
import { shiftPayroll, type ShiftPayroll } from "./payroll";
import type { ResolveOptions } from "./resolve";
import type { Shift } from "./types";

/** Eine Schicht mit ihrer (einmal berechneten) Payroll-Bewertung. */
export interface EvaluatedShift {
  shift: Shift;
  payroll: ShiftPayroll;
}

/**
 * Bewertet jede Schicht aus `shifts` mit `shiftPayroll` und der vollständigen
 * `history` (i. d. R. alle Schichten aus AppData – NICHT nur Periode/Job/Filter).
 */
export function evaluateShifts(
  shifts: readonly Shift[],
  resolve: (shift: Shift) => ResolveOptions,
  history: Shift[],
): EvaluatedShift[] {
  return shifts.map((shift) => ({
    shift,
    payroll: shiftPayroll(shift, { ...resolve(shift), history }),
  }));
}

/** Summierbare Payroll-Felder je Eintrag. */
export const PAYROLL_VALUE_FIELDS = [
  "earnings",
  "workEarnings",
  "absenceEarnings",
  "workedHours",
  "paidAbsenceHours",
  "base",
  "bonus",
  /** 1, wenn Eintrag eine Abwesenheit ist (kind ≠ "arbeit") und bezahlt wird. */
  "paidAbsenceEntries",
  /** 1, wenn Eintrag eine Abwesenheit ist und nicht bezahlt wird. */
  "unpaidAbsenceEntries",
  /** 1, wenn die Bewertung geschätzt ist (`estimated`). */
  "estimatedEntries",
] as const;

export type PayrollValueField = (typeof PAYROLL_VALUE_FIELDS)[number];

/** Zahlenwerte einer Payroll-Bewertung (keine Neuberechnung, nur Zuordnung). */
export function payrollValues(p: ShiftPayroll): Record<PayrollValueField, number> {
  const work = p.kind === "arbeit";
  return {
    earnings: p.earnings,
    workEarnings: work ? p.earnings : 0,
    absenceEarnings: work ? 0 : p.earnings,
    workedHours: p.workedHours,
    paidAbsenceHours: p.paidAbsenceHours,
    base: p.base,
    bonus: p.bonus,
    paidAbsenceEntries: !work && p.paid ? 1 : 0,
    unpaidAbsenceEntries: !work && !p.paid ? 1 : 0,
    estimatedEntries: p.estimated ? 1 : 0,
  };
}

/**
 * Fertige Optionen für `period-aggregate`-Helfer über `EvaluatedShift`-Listen:
 * `aggregateRange(range, evaluated, payrollAggregateOptions())`.
 */
export function payrollAggregateOptions(today?: string) {
  return {
    getDateKey: (e: EvaluatedShift) => e.shift.date,
    getValues: (e: EvaluatedShift) => payrollValues(e.payroll),
    fields: PAYROLL_VALUE_FIELDS,
    ...(today !== undefined ? { today } : {}),
  };
}
