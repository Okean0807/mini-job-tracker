import { isoDate, shiftsInMonth } from "./calc";
import { payrollTotals } from "./payroll";
import type { Resolver } from "./resolve";
import type { Job, Payment, Shift } from "./types";

export interface PayPeriod {
  job: Job;
  /** Abrechnungsmonat */
  year: number;
  month: number;
  /** Erwartete Auszahlung */
  expected: number;
  hours: number;
  /** Erwartetes Zahlungsdatum (ISO) */
  dueDate: string;
  payment?: Payment | undefined;
  /** Differenz Ist − Soll (nur wenn erfasst) */
  diff?: number | undefined;
}

const DEFAULT_PAYDAY = 15;

/** Erwartetes Zahlungsdatum für einen Abrechnungsmonat. */
export function paydayFor(job: Job, year: number, month: number): string {
  const day = Math.min(Math.max(job.payday ?? DEFAULT_PAYDAY, 1), 31);
  const delay = job.payrollDelay ?? 1;
  const target = new Date(year, month + delay, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return isoDate(target);
}

export function findPayment(
  payments: Payment[],
  jobId: string,
  year: number,
  month: number,
): Payment | undefined {
  return payments.find((p) => p.jobId === jobId && p.year === year && p.month === month);
}

/** Abrechnungszeitraum je Job für einen Monat. */
export function payPeriod(
  job: Job,
  shifts: Shift[],
  payments: Payment[],
  resolve: Resolver,
  year: number,
  month: number,
): PayPeriod {
  const list = shiftsInMonth(shifts, year, month).filter((s) => s.jobId === job.id);
  // Payroll-Semantik: Entgeltfortzahlung zählt zur Auszahlung, erzeugt aber
  // keine geleisteten Arbeitsstunden (siehe payroll.ts).
  const totals = payrollTotals(list, resolve, shifts);
  const expected = totals.earnings;
  const payment = findPayment(payments, job.id, year, month);
  return {
    job,
    year,
    month,
    expected,
    hours: totals.workedHours + totals.paidAbsenceHours,
    dueDate: paydayFor(job, year, month),
    payment,
    diff: payment ? payment.actual - expected : undefined,
  };
}

/** Alle offenen bzw. jüngsten Zeiträume, nach Zahltag sortiert. */
export function payPeriods(
  jobs: Job[],
  shifts: Shift[],
  payments: Payment[],
  resolve: Resolver,
  year: number,
  month: number,
): PayPeriod[] {
  return jobs
    .filter((j) => !j.archived)
    .map((job) => payPeriod(job, shifts, payments, resolve, year, month))
    .filter((p) => p.expected > 0 || p.payment)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
}
