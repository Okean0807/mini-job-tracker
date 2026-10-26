/**
 * Fresh assistant context snapshot built at ask-time from live AppData.
 * Keeps hourly rate, current month, and limits explicit so Gemini cannot
 * confuse forecast / other months with the current period.
 */
import { MONTHS_DE, isoDate, shiftsInMonth, shiftsInYear } from "./calc";
import {
  employmentTypeOf,
  isMinijobEmployment,
  monthlyHoursLimitFor,
  multipleMinijobsBesideMainJob,
  type MultipleMinijobsNotice,
} from "./legal";
import { minijobHoursLimits, monthUsage, monthlyLimitOf, yearlyLimitOf } from "./limits";
import { payrollTotals } from "./payroll";
import { makeResolver } from "./resolve";
import type { AppData, Job, ResolvedEmploymentType, WorkMode } from "./types";
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
    /**
     * Minijobs only: monthly limit ÷ this job's own hourly rate (informative).
     * null for non-Minijobs, without a usable rate, or when no limit applies.
     */
    monthlyHoursLimit: number | null;
  }>;
  /**
   * Several Minijobs next to a Hauptbeschäftigung (legal/employment.ts). Job ids
   * refer to jobs[]; no extra personal data. The limit calculation is unchanged.
   */
  minijobStatus: MultipleMinijobsNotice & { rules: string[] };
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
     * Linear pace from recordedToDate over the whole month. Only with at least
     * MIN_RECORDED_DAYS_FOR_PROJECTION distinct recorded workdays and nothing
     * planned — planned entries already are the user's own plan.
     */
    paceProjection: { hours: number; earnings: number } | null;
    /** How paceProjection was calculated; null when there is none. */
    paceProjectionMethod: string | null;
    /** Plain-text calculation with the actual numbers (no LaTeX); null without projection. */
    paceProjectionExplanation: string | null;
    /** Distinct recorded workdays the projection is based on (the sample size). */
    paceProjectionBasisDays: number;
    /** Why paceProjection is null; null when a projection exists. */
    paceProjectionUnavailableReason:
      "no_recorded_entries" | "too_few_recorded_days" | "planned_entries_present" | null;
    /**
     * This month's entered Minijob earnings (all Minijobs combined, recorded +
     * planned) as counted by the legal engine (limits.monthUsage). Earnings from
     * Hauptbeschäftigung and other non-Minijob jobs are not included.
     */
    minijobEarningsEntered: number | null;
    /** Monthly limit minus minijobEarningsEntered — headroom, not expected income. */
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

/** Fewer distinct recorded workdays than this give no monthly pace projection. */
const MIN_RECORDED_DAYS_FOR_PROJECTION = 2;

const PACE_PROJECTION_METHOD =
  "Grobe statistische Hochrechnung: erfasster Verdienst ÷ bisher vergangene Kalendertage des Monats × Tage im Monat. Setzt gleiches Tempo wie bisher voraus; keine Zusage, kein erwarteter Verdienst, kein Dienstplan.";

/** de-DE number with two decimals, e.g. 137.89 -> "137,89". */
const de2 = (n: number) => n.toFixed(2).replace(".", ",");

function paceExplanation(
  earnings: number,
  daysElapsed: number,
  daysInMonth: number,
  projected: number,
  basisDays: number,
): string {
  // At the minimum allowed basis the sample is, by definition, the smallest one we project from.
  const sample = basisDays <= MIN_RECORDED_DAYS_FOR_PROJECTION ? ", sehr kleine Datenbasis" : "";
  return (
    `${de2(earnings)} € ÷ ${daysElapsed} bisher vergangene Kalendertage × ${daysInMonth} Tage im Monat ≈ ${de2(projected)} € ` +
    `(grobe statistische Hochrechnung aus nur ${basisDays} erfassten Arbeitstagen${sample}; keine Zusage und kein erwarteter Verdienst).`
  );
}

const FORECAST_RULE_TOO_FEW_DAYS =
  "Es gibt erst zu wenige erfasste Arbeitstage und keine geplanten Schichten: Sage ausdrücklich, dass eine verlässliche Monatsprognose noch nicht möglich ist, und nenne keine hochgerechneten Monatswerte. Nenne nur Erfasst und remainingLimitAmount; frage nach den erwarteten Stunden oder schlage vor, geplante Schichten einzutragen.";

const FORECAST_RULES_COMMON = [
  "remainingLimitAmount ist nur die Obergrenze bis zur Minijob-Grenze, kein erwarteter Verdienst.",
  "Für die Minijob-Grenze zählt nur forecast.minijobEarningsEntered (alle Minijobs zusammen). Verdienst aus Hauptbeschäftigung oder anderen Nicht-Minijobs (jobs[].minijobLimitApplies=false) zählt nicht zur Grenze, auch wenn er in recordedToDate enthalten ist.",
  "calendarWeekdaysRemaining sind nur verbleibende Kalender-Werktage, nicht die Arbeitstage des Nutzers. Die App kennt keinen Dienstplan (workScheduleKnown=false); stelle sie nie als Arbeitstage dar und rechne nicht mit ihnen.",
  "Erfinde keine Schichten, Stunden pro Tag, Arbeitstage oder Verdienste.",
  "Eine Beispielrechnung nur mit Stunden, die der Nutzer selbst genannt hat: Stunden × settings.hourlyRate, gekennzeichnet als 'Beispiel – keine Prognose'.",
];

const FORECAST_RULES_WITH_DATA = [
  "Rechne nur mit den erfassten Daten und kennzeichne jede Zahl: 'Erfasst' = forecast.recordedToDate (bereits gearbeitet), 'Geplant' = forecast.plannedAfterToday (vom Nutzer eingetragen, noch nicht gearbeitet), 'Erfasst + geplant' = forecast.enteredTotal, 'Hochrechnung' = forecast.paceProjection (nur falls nicht null). Ist paceProjection null, nenne keine Monatshochrechnung.",
  "Eine Hochrechnung heißt immer 'grobe Hochrechnung': Nenne die Datenbasis (paceProjectionBasisDays erfasste Arbeitstage; steht in paceProjectionExplanation 'sehr kleine Datenbasis', sage ausdrücklich, dass es eine sehr kleine Stichprobe ist) und erkläre die Rechnung mit forecast.paceProjectionExplanation im Klartext. Stelle sie nie als verlässliche Schätzung, Zusage oder erwarteten Verdienst dar.",
  ...FORECAST_RULES_COMMON,
];

const FORECAST_RULES_NO_DATA = [
  "Für diesen Monat sind weder erfasste noch geplante Schichten eingetragen: Sage ausdrücklich, dass sich aus den vorhandenen Daten keine persönliche Prognose berechnen lässt.",
  "Wähle keine angenommenen Stunden oder Tage selbst. Frage stattdessen, wie viele Stunden der Nutzer diesen Monat voraussichtlich arbeitet, oder schlage vor, geplante Schichten in der App einzutragen.",
  ...FORECAST_RULES_COMMON,
];

const MINIJOB_STATUS_RULES = [
  "Neben einer Hauptbeschäftigung bleibt in der Regel nur der zeitlich zuerst aufgenommene Minijob geringfügig; weitere Minijobs werden mit der Hauptbeschäftigung zusammengerechnet und können versicherungspflichtig sein. Behaupte daher nicht, dass alle Jobs Minijobs bleiben.",
  "Die Minijob-Summe der App (forecast.minijobEarningsEntered, remainingLimitAmount) rechnet alle Minijobs zusammen; sage, dass diese Kombination aus Hauptbeschäftigung und mehreren Minijobs nach den Regeln der Sozialversicherung geprüft werden muss (Arbeitgeber oder Minijob-Zentrale).",
];
const MINIJOB_STATUS_RULE_KNOWN =
  "minijobStatus order_known: firstJobId ist nur nach Beginndatum voraussichtlich der erste Minijob – nenne ihn als 'voraussichtlich', nicht als sicher.";
const MINIJOB_STATUS_RULE_UNKNOWN =
  "minijobStatus order_unknown: Beginndaten fehlen oder sind gleich – sage, dass offen ist, welcher Minijob der erste ist, und empfehle, die Beginndaten in der App einzutragen.";

function minijobStatusFor(
  notice: MultipleMinijobsNotice,
): AssistantContextPayload["minijobStatus"] {
  if (notice.status === "none") return { ...notice, rules: [] };
  const specific =
    notice.status === "order_known" ? MINIJOB_STATUS_RULE_KNOWN : MINIJOB_STATUS_RULE_UNKNOWN;
  return { ...notice, rules: [...MINIJOB_STATUS_RULES, specific] };
}

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
  // Hours limits come from each Minijob's effective rate (limits.minijobHoursLimits);
  // several Minijobs with different rates have no shared hours limit — the
  // combined earnings limit is what counts.
  const perJobHours = new Map(
    (limitApplies ? minijobHoursLimits(data.jobs, data.settings, year, month) : []).map((h) => [
      h.jobId,
      round2(h.hours),
    ]),
  );
  const minijobHoursLimit = (job: Job): number | null => perJobHours.get(job.id) ?? null;
  const activeMinijobs = data.jobs.filter((j) => !j.archived && isMinijobEmployment(j));
  const distinctHours = new Set(perJobHours.values());
  const manualHours =
    !data.settings.hoursLimitAuto && data.settings.hoursLimitMonthly > 0
      ? data.settings.hoursLimitMonthly
      : null;
  const autoHours = !limitApplies
    ? null
    : (manualHours ??
      (activeMinijobs.length === 0
        ? monthlyHoursLimitFor(currentDate, hourlyRate) // onboarding: no jobs yet
        : distinctHours.size === 1
          ? [...distinctHours][0]!
          : null));
  const minijobMonth = limitApplies
    ? monthUsage(data.shifts, resolve, data.settings, year, month, currentDate)
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
  const recordedDays = new Set(recordedList.map((s) => s.date)).size;
  const paceProjectionUnavailableReason =
    recordedToDate.entriesCount === 0
      ? ("no_recorded_entries" as const)
      : plannedAfterToday.entriesCount > 0
        ? ("planned_entries_present" as const)
        : recordedDays < MIN_RECORDED_DAYS_FOR_PROJECTION
          ? ("too_few_recorded_days" as const)
          : null;
  const paceProjection =
    paceProjectionUnavailableReason === null
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
      monthlyHoursLimit: minijobHoursLimit(job),
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
    minijobStatus: minijobStatusFor(multipleMinijobsBesideMainJob(data.jobs, currentDate)),
    forecast: {
      dataBasedForecastPossible,
      recordedToDate,
      plannedAfterToday,
      enteredTotal: {
        hours: round2(recordedToDate.hours + plannedAfterToday.hours),
        earnings: round2(recordedToDate.earnings + plannedAfterToday.earnings),
      },
      paceProjection,
      paceProjectionMethod: paceProjection ? PACE_PROJECTION_METHOD : null,
      paceProjectionExplanation: paceProjection
        ? paceExplanation(
            recordedToDate.earnings,
            daysElapsed,
            daysInMonth,
            paceProjection.earnings,
            recordedDays,
          )
        : null,
      paceProjectionBasisDays: recordedDays,
      paceProjectionUnavailableReason,
      minijobEarningsEntered: minijobMonth ? round2(minijobMonth.projectedEarnings) : null,
      remainingLimitAmount:
        legalMonthly == null || !minijobMonth
          ? null
          : round2(Math.max(0, legalMonthly - minijobMonth.projectedEarnings)),
      daysElapsed,
      daysInMonth,
      calendarWeekdaysRemaining: remainingWeekdaysAfter(now, daysInMonth),
      workScheduleKnown: false,
      rules: !dataBasedForecastPossible
        ? FORECAST_RULES_NO_DATA
        : paceProjectionUnavailableReason === "too_few_recorded_days"
          ? [FORECAST_RULE_TOO_FEW_DAYS, ...FORECAST_RULES_WITH_DATA]
          : FORECAST_RULES_WITH_DATA,
    },
  };

  return JSON.stringify(payload);
}
