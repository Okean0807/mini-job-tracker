/**
 * Fresh assistant context snapshot built at ask-time from live AppData.
 * Keeps hourly rate, current month, and limits explicit so Gemini cannot
 * confuse forecast / other months with the current period.
 */
import { MONTHS_DE, isoDate, shiftsInMonth, shiftsInYear } from "./calc";
import { employmentTypeOf, isMinijobEmployment, monthlyHoursLimitFor } from "./legal";
import { monthlyHoursLimit, monthlyLimitOf, yearlyLimitOf } from "./limits";
import { payrollTotals } from "./payroll";
import { makeResolver } from "./resolve";
import type { AppData, ResolvedEmploymentType, WorkMode } from "./types";
import { jobsApplyMinijobLimit, primaryWorkMode } from "./work-mode";

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
  /** Recent historical months, including zero-activity years, for period-aware questions. */
  historicalYears: Array<{
    year: number;
    hours: number;
    earnings: number;
  }>;
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
    /** Aufgelöste Beschäftigungsart; "unknown" = Altbestand fest, Art noch nicht gewählt. */
    employmentType: ResolvedEmploymentType;
    minijobLimitApplies: boolean;
  }>;
  /**
   * Current-month forecast inputs, computed here so the model never has to
   * guess: recorded facts, future-dated entries and the pace projection are
   * kept apart, and `dataBasedForecastPossible` is false without entries.
   */
  forecast: {
    dataBasedForecastPossible: boolean;
    /** Entries dated up to and including today (actual recorded work). */
    recordedToDate: PeriodTotals;
    /** Entries the user already entered for later this month (planned, not yet worked). */
    plannedAfterToday: PeriodTotals;
    /** Linear pace from recordedToDate over the whole month; null without recorded entries. */
    paceProjection: { hours: number; earnings: number } | null;
    /** Monthly limit minus this month's entered earnings — headroom, not expected income. */
    remainingLimitAmount: number | null;
    daysElapsed: number;
    daysInMonth: number;
    /** Mon–Fri days after today in this month (calendar only, not a work schedule). */
    remainingWeekdays: number;
    rules: string[];
  };
};

type PeriodTotals = { entriesCount: number; hours: number; earnings: number };

const round2 = (n: number) => Number(n.toFixed(2));

const FORECAST_RULES_WITH_DATA = [
  "Trenne strikt: 'Erfasst' = forecast.recordedToDate (Fakten), 'Geplant' = forecast.plannedAfterToday (eingetragen, noch nicht gearbeitet), 'Hochrechnung' = forecast.paceProjection (Schätzung bei gleichem Tempo).",
  "remainingLimitAmount ist nur der verbleibende Spielraum bis zur Grenze, kein erwarteter Verdienst.",
  "Erfinde keine Schichten, Stunden oder Verdienste.",
];

const FORECAST_RULES_NO_DATA = [
  "Für diesen Monat sind keine Einträge erfasst: Sage ausdrücklich, dass keine datenbasierte Prognose möglich ist.",
  "Setze den verbleibenden Spielraum (remainingLimitAmount) nicht als erwarteten Verdienst an und rechne ihn nicht auf Stunden hoch, als wären sie gearbeitet.",
  "Eine Beispielrechnung ist nur erlaubt, wenn sie als 'Annahme' gekennzeichnet ist und die angenommenen Stunden, den Stundenlohn (settings.hourlyRate) und die verbleibenden Werktage (remainingWeekdays) nennt; es gibt keinen hinterlegten Dienstplan.",
  "Erfinde keine Schichten, Stunden oder Verdienste.",
];

function remainingWeekdaysAfter(now: Date, daysInMonth: number): number {
  let count = 0;
  for (let d = now.getDate() + 1; d <= daysInMonth; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), d).getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

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

  const recordedList = currentList.filter((s) => s.date <= currentDate);
  const plannedList = currentList.filter((s) => s.date > currentDate);
  const periodTotals = (list: typeof currentList): PeriodTotals => {
    const totals = payrollTotals(list, resolve, data.shifts);
    return {
      entriesCount: list.length,
      hours: round2(totals.workedHours),
      earnings: round2(totals.earnings),
    };
  };
  const recordedToDate = periodTotals(recordedList);
  const plannedAfterToday = periodTotals(plannedList);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const paceProjection =
    recordedToDate.entriesCount > 0
      ? {
          hours: round2((recordedToDate.hours / daysElapsed) * daysInMonth),
          earnings: round2((recordedToDate.earnings / daysElapsed) * daysInMonth),
        }
      : null;
  const dataBasedForecastPossible = currentList.length > 0;

  const yearList = shiftsInYear(data.shifts, year);
  const yearTotals = payrollTotals(yearList, resolve, data.shifts);

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
      entriesCount: currentList.length,
    },
    year: {
      year,
      hours: Number(yearTotals.workedHours.toFixed(2)),
      earnings: Number(yearTotals.earnings.toFixed(2)),
    },
    historicalYears,
    months,
    jobs,
    forecast: {
      dataBasedForecastPossible,
      recordedToDate,
      plannedAfterToday,
      paceProjection,
      remainingLimitAmount:
        legalMonthly == null ? null : round2(Math.max(0, legalMonthly - currentTotals.earnings)),
      daysElapsed,
      daysInMonth,
      remainingWeekdays: remainingWeekdaysAfter(now, daysInMonth),
      rules: dataBasedForecastPossible ? FORECAST_RULES_WITH_DATA : FORECAST_RULES_NO_DATA,
    },
  };

  return JSON.stringify(payload);
}
