/**
 * Fresh assistant context snapshot built at ask-time from live AppData.
 * Keeps hourly rate, current month, and limits explicit so Gemini cannot
 * confuse forecast / other months with the current period.
 */
import { MONTHS_DE, isoDate, shiftsInMonth, shiftsInYear } from "./calc";
import { monthlyHoursLimitFor } from "./legal";
import { monthlyHoursLimit, monthlyLimitOf, yearlyLimitOf } from "./limits";
import { payrollTotals } from "./payroll";
import { makeResolver } from "./resolve";
import type { AppData, WorkMode } from "./types";
import {
  jobsApplyMinijobLimit,
  primaryWorkMode,
  workModeAppliesMinijobLimit,
} from "./work-mode";

export type AssistantContextPayload = {
  currentDate: string;
  settings: {
    hourlyRate: number;
    legalMonthlyLimit: number | null;
    automaticMonthlyHours: number | null;
    annualLimit: number | null;
    workMode: WorkMode;
    minijobLimitApplies: boolean;
  };
  currentMonth: {
    year: number;
    month: number;
    monthName: string;
    hours: number;
    earnings: number;
    entriesCount: number;
  };
  year: {
    year: number;
    hours: number;
    earnings: number;
  };
  months: Array<{
    year: number;
    month: number;
    monthName: string;
    hours: number;
    earnings: number;
    entriesCount: number;
  }>;
  jobs: Array<{
    id: string;
    name: string;
    mode: WorkMode;
    hourlyRate: number | null;
    hours: number;
    earnings: number;
    minijobLimitApplies: boolean;
  }>;
};

/** Build a JSON string context for the KI assistant from live store data. */
export function buildAssistantContext(data: AppData, now: Date = new Date()): string {
  const resolve = makeResolver(data.jobs, data.settings);
  const year = now.getFullYear();
  const month = now.getMonth();
  const currentDate = isoDate(now);
  const hourlyRate = data.settings.defaultRate;

  const limitApplies = jobsApplyMinijobLimit(data.jobs);
  const workMode = primaryWorkMode(data.jobs, data.settings.activeJobId);
  const legalMonthly = limitApplies ? monthlyLimitOf(data.settings, year, month) : null;
  const autoHours = limitApplies
    ? monthlyHoursLimit(data.settings, year, month) ||
      monthlyHoursLimitFor(currentDate, hourlyRate)
    : null;
  const annual = limitApplies ? yearlyLimitOf(data.settings, year) : null;

  const currentList = shiftsInMonth(data.shifts, year, month);
  const currentTotals = payrollTotals(currentList, resolve, data.shifts);

  const yearList = shiftsInYear(data.shifts, year);
  const yearTotals = payrollTotals(yearList, resolve, data.shifts);

  const months: AssistantContextPayload["months"] = [];
  for (let m = 0; m < 12; m++) {
    const list = shiftsInMonth(data.shifts, year, m);
    if (list.length === 0) continue;
    const totals = payrollTotals(list, resolve, data.shifts);
    months.push({
      year,
      month: m,
      monthName: MONTHS_DE[m]!,
      hours: Number(totals.workedHours.toFixed(2)),
      earnings: Number(totals.earnings.toFixed(2)),
      entriesCount: list.length,
    });
  }

  const jobs = data.jobs.map((job) => {
    const list = data.shifts.filter((s) => s.jobId === job.id);
    const totals = payrollTotals(list, resolve, data.shifts);
    return {
      id: job.id,
      name: job.name,
      mode: job.mode,
      hourlyRate: typeof job.rate === "number" ? job.rate : null,
      hours: Number(totals.workedHours.toFixed(2)),
      earnings: Number(totals.earnings.toFixed(2)),
      minijobLimitApplies: workModeAppliesMinijobLimit(job.mode),
    };
  });

  const payload: AssistantContextPayload = {
    currentDate,
    settings: {
      hourlyRate,
      legalMonthlyLimit: legalMonthly,
      automaticMonthlyHours: autoHours == null ? null : Number(autoHours.toFixed(2)),
      annualLimit: annual,
      workMode,
      minijobLimitApplies: limitApplies,
    },
    currentMonth: {
      year,
      month,
      monthName: MONTHS_DE[month]!,
      hours: Number(currentTotals.workedHours.toFixed(2)),
      earnings: Number(currentTotals.earnings.toFixed(2)),
      entriesCount: currentList.length,
    },
    year: {
      year,
      hours: Number(yearTotals.workedHours.toFixed(2)),
      earnings: Number(yearTotals.earnings.toFixed(2)),
    },
    months,
    jobs,
  };

  return JSON.stringify(payload);
}
