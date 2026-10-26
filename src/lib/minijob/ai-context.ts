/**
 * Fresh assistant context snapshot built at ask-time from live AppData.
 * Keeps hourly rate, current month, and limits explicit so Gemini cannot
 * confuse forecast / other months with the current period.
 */
import { MONTHS_DE, isoDate, shiftsInMonth, shiftsInYear } from "./calc";
import { employmentTypeOf, isMinijobEmployment, monthlyHoursLimitFor } from "./legal";
import { monthUsage, monthlyHoursLimit, monthlyLimitOf, yearUsage, yearlyLimitOf } from "./limits";
import { activityOptions, limitReliabilityFlags } from "./multi-minijob";
import { payrollTotals } from "./payroll";
import { makeResolver } from "./resolve";
import type { AppData, ResolvedEmploymentType, WorkMode } from "./types";
import { jobsApplyMinijobLimit, primaryWorkMode } from "./work-mode";

export type AssistantContextPayload = {
  /**
   * "Today" (ISO date). Reference for the recorded/planned split below: entries dated
   * after it are future-dated (planned), the rest are recorded. See the Datenbasis
   * paragraph of buildSystemInstruction (ai/gemini-provider.ts).
   */
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
    /**
     * All jobs incl. Hauptbeschäftigung / self-employment — NOT the limit-relevant value.
     * Whole calendar month: INCLUDES entries dated after currentDate (planned), so it
     * mixes recorded and planned entries (N1). Worked hours only; paid absences are not
     * part of it (payrollTotals.workedHours), unlike `earnings`.
     */
    hours: number;
    /**
     * All jobs incl. Hauptbeschäftigung / self-employment — NOT the limit-relevant value.
     * Whole calendar month: INCLUDES entries dated after currentDate (planned). May
     * include pay for absences (payrollTotals.earnings), so its basis differs from `hours`.
     */
    earnings: number;
    /**
     * Minijob-only, limit-relevant income up to and including currentDate (null if no
     * Minijob limit applies). Excludes future-dated entries (monthUsage).
     */
    minijobEarnings: number | null;
    /** Worked hours of the Minijob-only value above: up to and including currentDate. */
    minijobHours: number | null;
    /**
     * B3-1/O4 (same rule as the UI, multi-minijob.ts): Hauptbeschäftigung plus
     * several active Minijobs in this month → minijobEarnings vs. limit is
     * NOT an unambiguous "over/under" statement.
     */
    multipleMinijobsWithMainJob: boolean;
    /**
     * Owner R5 (Variante B): whether the constellation applies cannot be
     * determined (paid status of absences estimated / pending confirmation).
     */
    minijobActivityUncertain: boolean;
    /** Number of entries of the whole month, INCLUDING those dated after currentDate. */
    entriesCount: number;
  };
  year: {
    year: number;
    /** Whole year, all jobs: INCLUDES entries dated after currentDate (see currentMonth.hours). */
    hours: number;
    /** Whole year, all jobs: INCLUDES entries dated after currentDate (see currentMonth.earnings). */
    earnings: number;
    /** Minijob-only, up to and including currentDate (yearUsage); no future-dated entries. */
    minijobEarnings: number | null;
    minijobHours: number | null;
    /** B3-1/O4 for the whole year (see currentMonth). */
    multipleMinijobsWithMainJob: boolean;
    minijobActivityUncertain: boolean;
  };
  /**
   * Recent historical months, including zero-activity years, for period-aware questions.
   * All jobs, whole years. Earlier years are complete; the CURRENT year equals year.hours /
   * year.earnings and therefore also includes entries dated after currentDate.
   */
  historicalYears: Array<{
    year: number;
    hours: number;
    earnings: number;
  }>;
  /**
   * Months of the current year that have entries, all jobs, whole months. The current and
   * later months INCLUDE entries dated after currentDate (N2: no Minijob split).
   */
  months: Array<{
    year: number;
    month: number;
    monthName: string;
    hours: number;
    earnings: number;
    entriesCount: number;
  }>;
  /**
   * Per job, over ALL periods (not split by month or year), INCLUDING entries dated after
   * currentDate; not limit-relevant.
   */
  jobs: Array<{
    id: string;
    name: string;
    mode: WorkMode;
    hourlyRate: number | null;
    hours: number;
    earnings: number;
    /** Aufgelöste Beschäftigungsart; "unknown" = Altbestand fest, Art noch nicht gewählt. */
    employmentType: ResolvedEmploymentType;
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
    ? monthlyHoursLimit(data.settings, year, month) || monthlyHoursLimitFor(currentDate, hourlyRate)
    : null;
  const annual = limitApplies ? yearlyLimitOf(data.settings, year) : null;

  const currentList = shiftsInMonth(data.shifts, year, month);
  const currentTotals = payrollTotals(currentList, resolve, data.shifts);

  const yearList = shiftsInYear(data.shifts, year);
  const yearTotals = payrollTotals(yearList, resolve, data.shifts);

  // B4-1: the limit-relevant values come from the same functions as the UI limit cards
  // (eligible Minijob shifts only, up to today) — never from the all-jobs totals.
  const mjMonth = limitApplies
    ? monthUsage(data.shifts, resolve, data.settings, year, month, currentDate)
    : null;
  const mjYear = limitApplies
    ? yearUsage(data.shifts, resolve, data.settings, year, currentDate)
    : null;
  const r2 = (v: number) => Number(v.toFixed(2));
  // B3-1/O4: shared rule with the dashboard/annual report (multi-minijob.ts).
  const multiMinijob = limitApplies
    ? limitReliabilityFlags(data.jobs, data.shifts, year, month, activityOptions(data.settings))
    : { month: false, year: false, forecast: false };

  const historicalYears: AssistantContextPayload["historicalYears"] = [];
  for (let y = year - 2; y <= year; y++) {
    const list = shiftsInYear(data.shifts, y);
    const totals = payrollTotals(list, resolve, data.shifts);
    historicalYears.push({
      year: y,
      hours: Number(totals.workedHours.toFixed(2)),
      earnings: Number(totals.earnings.toFixed(2)),
    });
  }

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
      employmentType: employmentTypeOf(job),
      minijobLimitApplies: isMinijobEmployment(job),
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
      minijobEarnings: mjMonth ? r2(mjMonth.earnings) : null,
      minijobHours: mjMonth ? r2(mjMonth.hours) : null,
      multipleMinijobsWithMainJob: multiMinijob.month,
      minijobActivityUncertain: !!multiMinijob.monthUncertain,
      entriesCount: currentList.length,
    },
    year: {
      year,
      hours: Number(yearTotals.workedHours.toFixed(2)),
      earnings: Number(yearTotals.earnings.toFixed(2)),
      minijobEarnings: mjYear ? r2(mjYear.earnings) : null,
      minijobHours: mjYear ? r2(mjYear.hours) : null,
      multipleMinijobsWithMainJob: multiMinijob.year,
      minijobActivityUncertain: !!multiMinijob.yearUncertain,
    },
    historicalYears,
    months,
    jobs,
  };

  return JSON.stringify(payload);
}
