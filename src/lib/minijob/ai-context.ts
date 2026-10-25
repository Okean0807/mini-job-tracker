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
   * The app stores no work schedule, so nothing here describes future workdays.
   */
  forecast: {
    dataBasedForecastPossible: boolean;
    /** Entries dated up to and including today (actual recorded work). */
    recordedToDate: PeriodTotals;
    /** Entries the user already entered for later this month (planned, not yet worked). */
    plannedAfterToday: PeriodTotals;
    /** recordedToDate + plannedAfterToday: everything the user has entered for this month. */
    enteredTotal: { hours: number; earnings: number };
    /**
     * Linear pace from recordedToDate over the whole month. Only when entries are
     * recorded and none are planned — planned entries already are the user's own plan.
     */
    paceProjection: { hours: number; earnings: number } | null;
    /** Monthly limit minus this month's entered earnings — headroom, not expected income. */
    remainingLimitAmount: number | null;
    daysElapsed: number;
    daysInMonth: number;
    /** Mon–Fri days after today in this month — calendar only, never the user's workdays. */
    calendarWeekdaysRemaining: number;
    /** The app stores no work schedule; future working days are unknown. */
    workScheduleKnown: false;
    rules: string[];
  };
};

type PeriodTotals = { entriesCount: number; hours: number; earnings: number };

const round2 = (n: number) => Number(n.toFixed(2));

const FORECAST_RULES_COMMON = [
  "remainingLimitAmount ist nur die Obergrenze bis zur Minijob-Grenze, kein erwarteter Verdienst.",
  "calendarWeekdaysRemaining sind nur verbleibende Kalender-Werktage, nicht die Arbeitstage des Nutzers. Die App kennt keinen Dienstplan (workScheduleKnown=false); stelle sie nie als Arbeitstage dar und rechne nicht mit ihnen.",
  "Erfinde keine Schichten, Stunden pro Tag, Arbeitstage oder Verdienste.",
  "Eine Beispielrechnung nur mit Stunden, die der Nutzer selbst genannt hat: Stunden × settings.hourlyRate, gekennzeichnet als 'Beispiel – keine Prognose'.",
];

const FORECAST_RULES_WITH_DATA = [
  "Rechne nur mit den erfassten Daten und kennzeichne jede Zahl: 'Erfasst' = forecast.recordedToDate (bereits gearbeitet), 'Geplant' = forecast.plannedAfterToday (vom Nutzer eingetragen, noch nicht gearbeitet), 'Erfasst + geplant' = forecast.enteredTotal, 'Hochrechnung' = forecast.paceProjection (nur falls vorhanden; gleiches Tempo wie bisher, keine Zusage).",
  ...FORECAST_RULES_COMMON,
];

const FORECAST_RULES_NO_DATA = [
  "Für diesen Monat sind weder erfasste noch geplante Schichten eingetragen: Sage ausdrücklich, dass sich aus den vorhandenen Daten keine persönliche Prognose berechnen lässt.",
  "Wähle keine angenommenen Stunden oder Tage selbst. Frage stattdessen, wie viele Stunden der Nutzer diesen Monat voraussichtlich arbeitet, oder schlage vor, geplante Schichten in der App einzutragen.",
  ...FORECAST_RULES_COMMON,
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
    recordedToDate.entriesCount > 0 && plannedAfterToday.entriesCount === 0
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
      enteredTotal: {
        hours: round2(recordedToDate.hours + plannedAfterToday.hours),
        earnings: round2(recordedToDate.earnings + plannedAfterToday.earnings),
      },
      paceProjection,
      remainingLimitAmount:
        legalMonthly == null ? null : round2(Math.max(0, legalMonthly - currentTotals.earnings)),
      daysElapsed,
      daysInMonth,
      calendarWeekdaysRemaining: remainingWeekdaysAfter(now, daysInMonth),
      workScheduleKnown: false,
      rules: dataBasedForecastPossible ? FORECAST_RULES_WITH_DATA : FORECAST_RULES_NO_DATA,
    },
  };

  return JSON.stringify(payload);
}
