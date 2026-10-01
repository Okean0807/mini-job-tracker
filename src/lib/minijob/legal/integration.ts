import { payrollTotals, shiftPayroll } from "../payroll";
import { isEligibleMinijobShift } from "./employment";
import { monthStart, forecastRolling12Months, type Rolling12ForecastResult } from "./rolling";
import type { AppData, Job, Settings, Shift } from "../types";
import type { Resolver } from "../resolve";

export interface MonthlyIncomeBreakdown {
  date: string;
  /** Einkommen aus Schichten bis einschließlich referenceDate. */
  actual: number;
  /** Einkommen aus zukünftigen Schichten nach referenceDate. */
  expectedAdditional: number;
  /** Anzahl der tatsächlichen Schichten, die in actual eingeflossen sind. */
  actualEntries: number;
  /** Anzahl der zukünftigen Schichten, die in expectedAdditional eingeflossen sind. */
  expectedEntries: number;
  /** true, wenn mindestens ein erwarteter Betrag auf einer Schätzung beruht. */
  estimated: boolean;
}

export function legalActualIncomeForMonth(
  shifts: Shift[],
  resolve: Resolver,
  year: number,
  month: number,
  referenceDate = todayIso(),
): number {
  const key = `${year}-${String(month + 1).padStart(2, "0")}`;
  const eligible = shifts.filter(
    (shift) =>
      shift.date.slice(0, 7) === key &&
      shift.date <= referenceDate &&
      isEligibleMinijobShift(shift, resolve(shift).job),
  );
  return payrollTotals(eligible, resolve, shifts).earnings;
}

export function legalActualIncomeForYear(
  shifts: Shift[],
  resolve: Resolver,
  year: number,
  referenceDate = todayIso(),
): number {
  const eligible = shifts.filter(
    (shift) =>
      shift.date.startsWith(`${year}-`) &&
      shift.date <= referenceDate &&
      isEligibleMinijobShift(shift, resolve(shift).job),
  );
  return payrollTotals(eligible, resolve, shifts).earnings;
}

export interface LegalIncomeAssessment {
  anchorMonth: string;
  referenceDate: string;
  months: MonthlyIncomeBreakdown[];
  rolling: Rolling12ForecastResult;
}

/** YYYY-MM-DD for a Date without timezone conversion. */
function todayIso(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function monthKey(date: string): string {
  return monthStart(date);
}

/**
 * Builds the legal-engine income stream directly from stored shifts.
 *
 * "actual" means earned from entries dated on/before referenceDate.
 * "expectedAdditional" means payable/estimated income from future-dated entries.
 * This deliberately does not treat future shifts as actual income.
 */
export function buildMonthlyIncomeFromShifts(
  shifts: Shift[],
  resolve: Resolver,
  referenceDate = todayIso(),
): MonthlyIncomeBreakdown[] {
  const eligible = shifts.filter((shift) =>
    isEligibleMinijobShift(shift, resolve(shift).job),
  );

  const groups = new Map<string, Shift[]>();
  for (const shift of eligible) {
    const key = monthKey(shift.date);
    const list = groups.get(key) ?? [];
    list.push(shift);
    groups.set(key, list);
  }

  const result: MonthlyIncomeBreakdown[] = [];
  for (const [date, list] of groups) {
    const actualShifts = list.filter((shift) => shift.date <= referenceDate);
    const expectedShifts = list.filter((shift) => shift.date > referenceDate);

    const actualTotals = payrollTotals(actualShifts, resolve, shifts);
    let expectedAdditional = 0;
    let estimated = false;

    for (const shift of expectedShifts) {
      const options = { ...resolve(shift), history: shifts };
      const payroll = shiftPayroll(shift, options);
      if (payroll.paid) {
        expectedAdditional += payroll.earnings;
        estimated ||= payroll.estimated;
      }
    }

    result.push({
      date,
      actual: actualTotals.earnings,
      expectedAdditional,
      actualEntries: actualShifts.length,
      expectedEntries: expectedShifts.length,
      estimated,
    });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Produces the complete rolling legal assessment for the selected anchor month.
 *
 * The legal engine remains independent from React/UI and receives AppData only
 * through this adapter. This makes the same calculation reusable by dashboard,
 * statistics and notifications.
 */
export function assessLegalIncome(
  data: AppData,
  anchorMonth: string,
  referenceDate = todayIso(),
): LegalIncomeAssessment {
  const resolve = ((shift: Shift) => {
    const job = data.jobs.find((candidate) => candidate.id === shift.jobId);
    return {
      job,
      defaultRate: data.settings.defaultRate,
      supplements: job?.supplements ?? data.settings.supplements,
      holiday: false,
    };
  }) as Resolver;

  const months = buildMonthlyIncomeFromShifts(data.shifts, resolve, referenceDate);
  const rolling = forecastRolling12Months(
    months.map((month) => ({
      date: month.date,
      actual: month.actual,
      expectedAdditional: month.expectedAdditional,
    })),
    anchorMonth,
  );

  return {
    anchorMonth: monthStart(anchorMonth),
    referenceDate,
    months,
    rolling,
  };
}
