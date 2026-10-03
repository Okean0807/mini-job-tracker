import { isoDate, shiftsInMonth } from "./calc";
import { payrollTotals } from "./payroll";
import { roundMoney } from "./rounding";
import type { Resolver } from "./resolve";
import type { Job, Payment, Shift } from "./types";

export interface PayPeriod {
  job: Job;
  /** Abrechnungsmonat */
  year: number;
  month: number;
  /** Gesamtentgelt für den Abrechnungsmonat inkl. noch nicht eingetretener geplanter Einträge. */
  expected: number;
  /** Bis zum Stichtag bereits verdient / angefallen. */
  earned: number;
  /** Bereits tatsächlich erhaltene Zahlung. */
  paid: number;
  /** Noch offener bereits verdienter Betrag (earned − paid). Zukunft erzeugt keine offene Forderung. */
  outstanding: number;
  /** Bereits ausgezahlt minus bereits verdient. Negativ = noch offen, positiv = überzahlt. */
  paymentDiff: number;
  /** Bereits ausgezahlter Betrag übersteigt das bis zum Stichtag verdiente Entgelt. */
  overpaid: number;
  /** Zahlung ist fällig und deckt das bis dahin verdiente Entgelt nicht. */
  overdue: boolean;
  /** Arbeits-/Ausfallstunden bis zum Stichtag. */
  hours: number;
  /** Erwartetes Zahlungsdatum (ISO) */
  dueDate: string;
  /** Alle Zahlungen dieses Jobs und Abrechnungsmonats. */
  payments: Payment[];
  /** Rückwärtskompatibel: die zuletzt erfasste Zahlung. */
  payment?: Payment | undefined;
  /** Differenz Ist − Soll (nur wenn erfasst); bleibt als Legacy-Alias erhalten. */
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

export function findPayments(
  payments: Payment[],
  jobId: string,
  year: number,
  month: number,
): Payment[] {
  return payments.filter((p) => p.jobId === jobId && p.year === year && p.month === month);
}

/** Rückwärtskompatibler Einzelzugriff: liefert die zuletzt erfasste Zahlung. */
export function findPayment(
  payments: Payment[],
  jobId: string,
  year: number,
  month: number,
): Payment | undefined {
  const matches = findPayments(payments, jobId, year, month);
  return matches[matches.length - 1];
}

function confirmedPaymentAmount(payment: Payment): number {
  return payment.confirmed === false ? 0 : Math.max(0, Number(payment.actual) || 0);
}

/** Abrechnungszeitraum je Job für einen Monat. */
export function payPeriod(
  job: Job,
  shifts: Shift[],
  payments: Payment[],
  resolve: Resolver,
  year: number,
  month: number,
  asOfDate: string = isoDate(new Date()),
): PayPeriod {
  const list = shiftsInMonth(shifts, year, month).filter((s) => s.jobId === job.id);
  // Payroll-Semantik: Entgeltfortzahlung zählt zur Auszahlung, erzeugt aber
  // keine geleisteten Arbeitsstunden (siehe payroll.ts).
  const totals = payrollTotals(list, resolve, shifts);
  const earnedList = list.filter((s) => s.date <= asOfDate);
  const earnedTotals = payrollTotals(earnedList, resolve, shifts);
  const expected = roundMoney(totals.earnings);
  const earned = roundMoney(earnedTotals.earnings);
  const periodPayments = findPayments(payments, job.id, year, month);
  const payment = periodPayments[periodPayments.length - 1];
  const paid = roundMoney(periodPayments.reduce((sum, item) => sum + confirmedPaymentAmount(item), 0));
  const dueDate = paydayFor(job, year, month);
  const outstanding = roundMoney(Math.max(0, earned - paid));
  const paymentDiff = roundMoney(paid - earned);
  const overpaid = roundMoney(Math.max(0, paymentDiff));
  const overdue = dueDate < asOfDate && outstanding > 0.005;
  return {
    job,
    year,
    month,
    expected,
    earned,
    paid,
    outstanding,
    paymentDiff,
    overpaid,
    overdue,
    hours: earnedTotals.workedHours + earnedTotals.paidAbsenceHours,
    dueDate,
    payments: periodPayments,
    payment,
    // Backwards-compatible alias: historically diff meant payment − expected.
    diff: periodPayments.length > 0 ? paid - expected : undefined,
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
    .filter((p) => p.expected > 0 || p.payments.length > 0)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
}
