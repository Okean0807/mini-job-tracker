/**
 * Anwendungs-/Geschäftslogik-Schicht (Facade).
 *
 * Ziel: UI  ->  service.ts  ->  Datenschicht (store.ts) + Rechenkern (calc/limits/…).
 * Alle Funktionen sind rein aufrufbar (kein React nötig) und können später
 * unverändert von einer KI-Schicht genutzt werden.
 * Bestehende Module bleiben unangetastet – dies ist nur eine stabile Fassade.
 */
import {
  averageRate,
  isoDate,
  shiftBreakdown,
  shiftHours,
  shiftsInMonth,
  shiftsInYear,
  shiftsOnDate,
  sumEarnings,
  sumHours,
  weekday,
} from "./calc";
import { goalsProgress, type GoalProgress } from "./goals";
import { holidaysFor, isHoliday } from "./holidays";
import { buildInsights, type Insights } from "./insights";
import { monthUsage, monthlyHoursLimit, yearUsage, yearlyLimitOf, type LimitUsage } from "./limits";
import { payrollTotals, shiftPayroll, type PayrollTotals, type ShiftPayroll } from "./payroll";
import { payPeriod, payPeriods, paydayFor, type PayPeriod } from "./payday";
import { effectiveShiftRate, resolveRate, suggestedRate, type RateSource } from "./rate";
import { makeResolver, type ResolveOptions, type Resolver } from "./resolve";
import { generateAbsence, generateFixedMonth, overtimeHours, weeklyPlanHours } from "./schedule";
import {
  deleteShift as storeDeleteShift,
  getData,
  newId,
  saveShift as storeSaveShift,
  saveShifts as storeSaveShifts,
  updateSettings as storeUpdateSettings,
  updateSupplements as storeUpdateSupplements,
} from "./store";
import type { AppData, Job, Settings, Shift, ShiftKind } from "./types";

/* ---------------- Kontext ---------------- */

export interface AppContext {
  data: AppData;
  resolve: Resolver;
}

/** Aktueller Datenstand + Zuschlags-/Feiertagsauflösung. */
export function context(data: AppData = getData()): AppContext {
  return { data, resolve: makeResolver(data.jobs, data.settings) };
}

/* ---------------- Schichten (CRUD) ---------------- */

export type ShiftInput = Omit<Shift, "id" | "kind"> & { id?: string; kind?: ShiftKind };

/** Neue Schicht anlegen oder bestehende überschreiben. Gibt die gespeicherte Schicht zurück. */
export function upsertShift(input: ShiftInput): Shift {
  const shift: Shift = {
    ...input,
    id: input.id ?? newId(),
    kind: input.kind ?? "arbeit",
    breakMinutes: input.breakMinutes ?? 0,
    createdAt: input.createdAt ?? isoDate(new Date()),
  };
  storeSaveShift(shift);
  // store kann objectId per Auto-Learn setzen — gespeicherten Stand zurückgeben
  return getData().shifts.find((s) => s.id === shift.id) ?? shift;
}

export function addShift(input: Omit<ShiftInput, "id">): Shift {
  return upsertShift(input);
}

/** Teil-Änderung einer vorhandenen Schicht. */
export function updateShift(id: string, patch: Partial<Shift>): Shift | undefined {
  const current = getShift(id);
  if (!current) return undefined;
  const next: Shift = { ...current, ...patch, id };
  storeSaveShift(next);
  return next;
}

export function removeShift(id: string): void {
  storeDeleteShift(id);
}

export function saveManyShifts(list: Shift[]): void {
  storeSaveShifts(list);
}

export function getShift(id: string, data: AppData = getData()): Shift | undefined {
  return data.shifts.find((s) => s.id === id);
}

export function listShifts(
  filter: { from?: string; to?: string; jobId?: string; kind?: ShiftKind } = {},
  data: AppData = getData(),
): Shift[] {
  return data.shifts.filter((s) => {
    if (filter.from && s.date < filter.from) return false;
    if (filter.to && s.date > filter.to) return false;
    if (filter.jobId && s.jobId !== filter.jobId) return false;
    if (filter.kind && s.kind !== filter.kind) return false;
    return true;
  });
}

export function shiftsForDate(date: string, data: AppData = getData()): Shift[] {
  return shiftsOnDate(data.shifts, date);
}

/* ---------------- Berechnungen ---------------- */

/** Arbeitszeit einer Schicht in Stunden (inkl. Nachtschicht über Mitternacht, abzgl. Pause). */
export function hoursOf(shift: Shift): number {
  return shiftHours(shift);
}

/** Verdienst einer Schicht inkl. Zuschlägen – Kontext wird automatisch aufgelöst. */
export function earningsOf(shift: Shift, ctx: AppContext = context()) {
  return shiftBreakdown(shift, ctx.resolve(shift));
}

/** Zuschlags-/Feiertagsregeln für eine Schicht. */
export function rulesFor(shift: Shift, ctx: AppContext = context()): ResolveOptions {
  return ctx.resolve(shift);
}

/**
 * Gültiger Stundenlohn für ein Datum (optional Job): Job-Satz vor Standard-Satz.
 * Liefert zusätzlich die an diesem Tag greifenden Zuschläge.
 */
export function rateForDate(
  date: string,
  jobId?: string,
  data: AppData = getData(),
  options: { shiftRate?: number | undefined } = {},
): {
  rate: number;
  source: RateSource;
  job?: Job;
  holiday: boolean;
  weekday: number;
  supplements: Settings["supplements"];
} {
  const { rate, source, job } = resolveRate(
    { date, jobId, shiftRate: options.shiftRate },
    data.jobs,
    data.settings,
  );
  return {
    rate,
    source,
    ...(job ? { job } : {}),
    holiday: isHoliday(date, data.settings.bundesland),
    weekday: weekday(date),
    supplements: job?.supplements ?? data.settings.supplements,
  };
}

/** Maßgeblicher Satz einer gespeicherten Schicht (Basis der Verdienstberechnung). */
export function rateOf(shift: Shift, ctx: AppContext = context()): number {
  const { job, defaultRate } = ctx.resolve(shift);
  return effectiveShiftRate(shift, { job, defaultRate });
}

/* ---------------- Statistik ---------------- */

export interface PeriodStats {
  year: number;
  month?: number;
  shifts: Shift[];
  /** Tatsächlich geleistete Arbeitsstunden (ohne bezahlte Abwesenheit). */
  hours: number;
  /** Gesamtes Arbeitsentgelt inkl. Entgeltfortzahlung. */
  earnings: number;
  avgRate: number;
  entries: number;
  /** Aufschlüsselung Arbeit / bezahlte Abwesenheit. */
  payroll: PayrollTotals;
}

/** Payroll-Bewertung einer Schicht (bezahlt/unbezahlt, Basis, Schätzung). */
export function payrollOf(shift: Shift, ctx: AppContext = context()): ShiftPayroll {
  return shiftPayroll(shift, { ...ctx.resolve(shift), history: ctx.data.shifts });
}

export function monthStats(year: number, month: number, ctx: AppContext = context()): PeriodStats {
  const list = shiftsInMonth(ctx.data.shifts, year, month);
  const payroll = payrollTotals(list, ctx.resolve, ctx.data.shifts);
  return {
    year,
    month,
    shifts: list,
    hours: payroll.workedHours,
    earnings: payroll.earnings,
    avgRate: payroll.workedHours > 0 ? payroll.workEarnings / payroll.workedHours : 0,
    entries: list.length,
    payroll,
  };
}

export function yearStats(year: number, ctx: AppContext = context()): PeriodStats {
  const list = shiftsInYear(ctx.data.shifts, year);
  const payroll = payrollTotals(list, ctx.resolve, ctx.data.shifts);
  return {
    year,
    shifts: list,
    hours: payroll.workedHours,
    earnings: payroll.earnings,
    avgRate: payroll.workedHours > 0 ? payroll.workEarnings / payroll.workedHours : 0,
    entries: list.length,
    payroll,
  };
}

export function insightsFor(year: number, month: number, ctx: AppContext = context()): Insights {
  return buildInsights(ctx.data.shifts, year, month, ctx.resolve);
}

export function limitsForMonth(
  year: number,
  month: number,
  ctx: AppContext = context(),
): LimitUsage {
  return monthUsage(ctx.data.shifts, ctx.resolve, ctx.data.settings, year, month);
}

export function limitsForYear(year: number, ctx: AppContext = context()): LimitUsage {
  return yearUsage(ctx.data.shifts, ctx.resolve, ctx.data.settings, year);
}

export function goalsOverview(ctx: AppContext = context()): GoalProgress[] {
  return goalsProgress(ctx.data.goals, ctx.data.shifts, ctx.data.jobs, ctx.resolve);
}

export function paymentsForMonth(
  year: number,
  month: number,
  ctx: AppContext = context(),
): PayPeriod[] {
  return payPeriods(ctx.data.jobs, ctx.data.shifts, ctx.data.payments, ctx.resolve, year, month);
}

export function paymentForJob(
  job: Job,
  year: number,
  month: number,
  ctx: AppContext = context(),
): PayPeriod {
  return payPeriod(job, ctx.data.shifts, ctx.data.payments, ctx.resolve, year, month);
}

/* ---------------- Dienstplan ---------------- */

export interface CalendarDay {
  date: string;
  weekday: number;
  holiday: boolean;
  shifts: Shift[];
  hours: number;
  earnings: number;
  /** Geplant laut Wochenplan (Festanstellung), aber noch nicht erfasst */
  planned: boolean;
}

/** Kalenderdaten eines Monats – erfasste Schichten plus geplante Tage. */
export function monthSchedule(
  year: number,
  month: number,
  ctx: AppContext = context(),
): CalendarDay[] {
  const { settings, jobs } = ctx.data;
  const planned = new Set(
    jobs
      .filter((j) => !j.archived && j.week)
      .flatMap((j) =>
        generateFixedMonth(j, year, month, ctx.data.shifts, settings.bundesland).map((s) => s.date),
      ),
  );
  const days = new Date(year, month + 1, 0).getDate();
  const result: CalendarDay[] = [];
  for (let d = 1; d <= days; d++) {
    const date = isoDate(new Date(year, month, d));
    const list = shiftsOnDate(ctx.data.shifts, date);
    const dayPayroll = payrollTotals(list, ctx.resolve, ctx.data.shifts);
    result.push({
      date,
      weekday: weekday(date),
      holiday: isHoliday(date, settings.bundesland),
      shifts: list,
      hours: dayPayroll.workedHours,
      earnings: dayPayroll.earnings,
      planned: planned.has(date),
    });
  }
  return result;
}

/** Schichten aus dem Wochenplan einer Festanstellung erzeugen (ohne zu speichern). */
export function previewFixedMonth(
  job: Job,
  year: number,
  month: number,
  ctx: AppContext = context(),
): Shift[] {
  return generateFixedMonth(job, year, month, ctx.data.shifts, ctx.data.settings.bundesland);
}

/** Wochenplan anwenden und speichern. Gibt die neu erzeugten Schichten zurück. */
export function applyFixedMonth(job: Job, year: number, month: number): Shift[] {
  const created = previewFixedMonth(job, year, month);
  if (created.length) storeSaveShifts(created);
  return created;
}

/** Urlaub / Krank für einen Zeitraum eintragen (überspringt Tage mit bestehendem Job-Eintrag). */
export function addAbsence(job: Job, kind: ShiftKind, from: string, to: string): Shift[] {
  const data = getData();
  const created = generateAbsence(
    job,
    kind,
    from,
    to,
    data.settings.bundesland,
    data.shifts,
  );
  if (created.length) storeSaveShifts(created);
  return created;
}

/**
 * Löscht nur Abwesenheiten (urlaub/krank) eines Jobs im Zeitraum.
 * Arbeit / Feiertag-Einträge bleiben unberührt — keine stillen Löschungen.
 */
export function removeAbsenceRange(
  jobId: string | undefined,
  kind: ShiftKind,
  from: string,
  to: string,
): number {
  if (kind !== "urlaub" && kind !== "krank") return 0;
  const data = getData();
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const targets = data.shifts.filter(
    (s) =>
      s.kind === kind &&
      (s.jobId ?? "") === (jobId ?? "") &&
      s.date >= lo &&
      s.date <= hi,
  );
  for (const s of targets) storeDeleteShift(s.id);
  return targets.length;
}

/**
 * Zeitraum ersetzen: zuerst passende Abwesenheiten entfernen, dann neu anlegen.
 * Arbeitstage im Intervall werden nicht gelöscht; generateAbsence überspringt sie.
 */
export function replaceAbsenceRange(
  job: Job,
  kind: ShiftKind,
  from: string,
  to: string,
): Shift[] {
  removeAbsenceRange(job.id, kind, from, to);
  return addAbsence(job, kind, from, to);
}

export function plannedWeeklyHours(job: Job): number {
  return weeklyPlanHours(job);
}

export function overtimeFor(job: Job, shifts: Shift[], weeks: number): number {
  return overtimeHours(job, shifts, weeks);
}

export function holidays(year: number, data: AppData = getData()) {
  return holidaysFor(year, data.settings.bundesland);
}

/* ---------------- Einstellungen & Jobs ---------------- */

export function getSettings(data: AppData = getData()): Settings {
  return data.settings;
}

export function setSettings(patch: Partial<Settings>): void {
  storeUpdateSettings(patch);
}

export function setSupplements(patch: Partial<Settings["supplements"]>): void {
  storeUpdateSupplements(patch);
}

export function listJobs(data: AppData = getData()): Job[] {
  return data.jobs.filter((j) => !j.archived);
}

export function getJob(id: string | undefined, data: AppData = getData()): Job | undefined {
  return data.jobs.find((j) => j.id === id);
}

export function activeJob(data: AppData = getData()): Job | undefined {
  return getJob(data.settings.activeJobId, data);
}

export const limitInfo = {
  monthlyHours: monthlyHoursLimit,
  yearly: yearlyLimitOf,
};

export { paydayFor, suggestedRate };
export type { PayrollTotals, ShiftPayroll };
export type { RateSource, LimitUsage, PayPeriod, Insights, GoalProgress, Resolver, ResolveOptions };
