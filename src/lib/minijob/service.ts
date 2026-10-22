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
import { eachIsoDateInclusive } from "./absence-range";
import { goalsProgress, type GoalProgress } from "./goals";
import { holidaysFor, isHoliday } from "./holidays";
import { buildInsights, type Insights } from "./insights";
import { monthUsage, monthlyHoursLimit, yearUsage, yearlyLimitOf, type LimitUsage } from "./limits";
import {
  payrollTotals,
  shiftPayroll,
  SICK_SEPARATE_GAP_DAYS,
  type PayrollTotals,
  type ShiftPayroll,
} from "./payroll";
import { addDays } from "./date-key";
import { payPeriod, payPeriods, paydayFor, type PayPeriod } from "./payday";
import { effectiveShiftRate, resolveRate, suggestedRate, type RateSource } from "./rate";
import { makeResolver, type ResolveOptions, type Resolver } from "./resolve";
import { assessLegalIncome, type LegalIncomeAssessment } from "./legal";

import { generateAbsence, generateFixedMonth, overtimeHours, weeklyPlanHours } from "./schedule";
import {
  applyShiftChanges as storeApplyShiftChanges,
  deleteShift as storeDeleteShift,
  getData,
  newId,
  saveShift as storeSaveShift,
  saveShifts as storeSaveShifts,
  updateSettings as storeUpdateSettings,
  updateSupplements as storeUpdateSupplements,
} from "./store";
import type { AppData, Job, Settings, Shift, ShiftKind } from "./types";
import { absencePlanDay } from "./week-plan";

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

/**
 * Entry-dialog save: UPDATE when an editing Shift ID is present, otherwise CREATE.
 * The ID is the only identity — never infer from date/time/address.
 */
export function persistDialogShift(
  input: ShiftInput,
  editingId?: string | null,
): Shift {
  const id = (editingId ?? "").trim();
  if (id) {
    return upsertShift({ ...input, id });
  }
  const { id: _ignored, ...rest } = input;
  return addShift(rest);
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

/** Rolling-12 Legal Engine assessment using the current application data. */
export function legalIncomeForMonth(
  year: number,
  month: number,
  ctx: AppContext = context(),
  referenceDate?: string,
): LegalIncomeAssessment {
  const anchorMonth = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return assessLegalIncome(ctx.data, anchorMonth, referenceDate);
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

/** Abwesenheiten (urlaub/krank) eines Jobs im Zeitraum – reine Auswahl, ändert nichts. */
export function absenceRangeTargets(
  shifts: Shift[],
  jobId: string | undefined,
  kind: ShiftKind,
  from: string,
  to: string,
): Shift[] {
  if (kind !== "urlaub" && kind !== "krank") return [];
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  return shifts.filter(
    (s) => s.kind === kind && (s.jobId ?? "") === (jobId ?? "") && s.date >= lo && s.date <= hi,
  );
}

/** D3 (Owner R4): geplante Änderung eines Abwesenheitszeitraums (noch nicht gespeichert). */
export interface AbsencePlan {
  removeIds: string[];
  created: Shift[];
  /** V10-LATEBLOCK-CASE: Krankheitsfall der neu angelegten Krank-Tage (nur Krank). */
  sickCase?: AbsenceSickCase;
}

/** Benachbarter, ausdrücklich zugeordneter Krankheitsfall (mit sickCaseId). */
export interface SickCaseNeighbour {
  caseId: string;
  /** Erster Tag dieses Falls. */
  start: string;
  /** "continuous": nur planmäßig freie Tage dazwischen; "ambiguous": unklare Grenze. */
  boundary: "continuous" | "ambiguous";
}

/**
 * V10-LATEBLOCK-CASE: Fallzuordnung eines Krank-Zeitraums.
 * - "continued": bearbeiteter Block gehörte schon zu diesem Fall und schließt lückenlos an
 *   (dazwischen nur laut gültigem Plan sicher freie Tage) → dieselbe sickCaseId.
 * - "linked": unklare Grenze, vom Nutzer ausdrücklich zugeordnet.
 * - "new": neuer Fall; bei unklarer Grenze steht der Kandidat in `linkCandidate`.
 */
export interface AbsenceSickCase {
  mode: "new" | "continued" | "linked";
  caseId: string;
  start: string;
  linkCandidate?: SickCaseNeighbour;
  /** QA-Delta P2-1: durch die Änderung entsteht eine Lücke ≥ 6 Tage → Fall ab `start` getrennt. */
  split?: { start: string };
}

/**
 * Plant Anlegen bzw. Ersetzen eines Abwesenheitszeitraums, OHNE zu speichern –
 * damit vor dem Speichern die Auswirkung auf andere Einträge/Monate gezeigt
 * und bestätigt werden kann. `replace` = bisheriger Zeitraum (Bearbeiten).
 */
export function planAbsence(
  job: Job,
  kind: ShiftKind,
  from: string,
  to: string,
  replace?: { jobId: string | undefined; kind: ShiftKind; from: string; to: string },
  data: AppData = getData(),
  options: { linkCaseId?: string | undefined } = {},
): AbsencePlan {
  const plan = planAbsenceCore(job, kind, from, to, replace, data, options);
  return kind === "krank" ? splitAtNewSeparateGaps(job, plan, data.shifts) : plan;
}

/**
 * V10-LATEBLOCK-CASE (QA-Delta P2-1, Regel W-1/K-05): Entsteht durch die Änderung IM Fall
 * eine Lücke von ≥ SICK_SEPARATE_GAP_DAYS leeren Kalendertagen (zwischen zwei Tagen des
 * Falls liegt KEIN Eintrag des Jobs), bleibt der Fall nie einer – auch nicht per Haken. Der frühere Teil behält die
 * sickCaseId, jeder Teil nach einer NEUEN Lücke bekommt eine neue (bestehende Einträge
 * werden nur innerhalb dieses Plans umgeschrieben, also erst nach Bestätigung gespeichert).
 * Lücken, die schon vorher bestanden, bleiben unangetastet.
 */
function splitAtNewSeparateGaps(job: Job, plan: AbsencePlan, shifts: Shift[]): AbsencePlan {
  const ofJob = (list: Shift[]) => list.filter((s) => (s.jobId ?? "") === job.id);
  const gone = new Set(plan.removeIds);
  const caseIds = new Set(
    [
      ...shifts.filter((s) => gone.has(s.id) && s.kind === "krank").map((s) => s.sickCaseId),
      ...plan.created.filter((s) => s.kind === "krank").map((s) => s.sickCaseId),
    ].filter((id): id is string => Boolean(id)),
  );
  const after = ofJob(shiftsAfterPlan(shifts, plan));
  const byDate = new Map<string, Shift[]>();
  for (const s of after) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const ownIds = new Set(plan.created.map((s) => s.id));
  /**
   * NEUE Lücke ≥ SICK_SEPARATE_GAP_DAYS zwischen zwei Tagen a < b des Falls `caseId`?
   * Gezählt werden LEERE Kalendertage (kein Eintrag des Jobs). Zwischen a und b dürfen außer
   * leeren Tagen nur Krank-Tage DIESER Änderung liegen, die einem ANDEREN Fall zugeordnet
   * werden (t653u: unklare linke Grenze → bearbeiteter Block = neuer Fall). Jeder andere
   * Eintrag (Arbeit, Urlaub, Bestand) schließt die Lücke wie bisher. „Neu“ = in einem leeren
   * Lauf ≥ 6 Tage lagen vor der Änderung Tage dieses Falls (alte Lücken bleiben unangetastet).
   */
  const newGapBetween = (a: string, b: string, caseId: string, beforeDates: string[]) => {
    let runStart: string | undefined;
    let run = 0;
    let found = false;
    const closeRun = (end: string) => {
      if (runStart !== undefined && run >= SICK_SEPARATE_GAP_DAYS) {
        const lo = runStart;
        if (beforeDates.some((d) => d >= lo && d < end)) found = true;
      }
      runStart = undefined;
      run = 0;
    };
    for (let d = addDays(a, 1); d < b; d = addDays(d, 1)) {
      const entries = byDate.get(d) ?? [];
      if (!entries.length) {
        runStart ??= d;
        run += 1;
        continue;
      }
      const otherCaseOfThisEdit = entries.every(
        (s) => s.kind === "krank" && ownIds.has(s.id) && !!s.sickCaseId && s.sickCaseId !== caseId,
      );
      if (!otherCaseOfThisEdit) return false;
      closeRun(d);
    }
    closeRun(b);
    return found;
  };
  const removeIds = [...plan.removeIds];
  const created = [...plan.created];
  let split: { start: string } | undefined;
  for (const caseId of caseIds) {
    const beforeDates = ofJob(shifts)
      .filter((s) => s.kind === "krank" && s.sickCaseId === caseId)
      .map((s) => s.date);
    const days = after
      .filter((s) => s.kind === "krank" && s.sickCaseId === caseId)
      .sort((x, y) => x.date.localeCompare(y.date));
    let current = caseId;
    for (let i = 1; i < days.length; i++) {
      const a = days[i - 1]!.date;
      const b = days[i]!.date;
      const isNewGap = newGapBetween(a, b, caseId, beforeDates);
      if (isNewGap) {
        current = newId();
        split ??= { start: b };
      }
      if (current === caseId) continue;
      const entry = { ...days[i]!, sickCaseId: current };
      const idx = created.findIndex((s) => s.id === entry.id);
      if (idx >= 0) created[idx] = entry;
      else {
        removeIds.push(entry.id);
        created.push(entry);
      }
    }
  }
  if (!split) return plan;
  const result: AbsencePlan = { removeIds, created };
  const ownId = created.find((s) => s.kind === "krank" && s.sickCaseId)?.sickCaseId;
  const prevCase = plan.sickCase;
  if (ownId) {
    const start = caseStartIn(shiftsAfterPlan(shifts, result), ownId) ?? "";
    result.sickCase =
      prevCase && prevCase.caseId === ownId
        ? { ...prevCase, start, split }
        : { mode: "new", caseId: ownId, start, split };
  }
  return result;
}

/** t653u: Kennzahlen der Krankheitstage eines Jobs (Fälle / Tage / bezahlt / €). */
export interface SickCaseFigures {
  cases: number;
  days: number;
  paidDays: number;
  eur: number;
}

/** t653u: zusammenhängende Krank-Tage, die durch die Änderung einem anderen Fall angehören. */
export interface SickCaseMove {
  from: string;
  to: string;
  days: number;
  /** Beginn des bisherigen Falls (leer: Tag war vorher nicht krank). */
  fromCaseStart: string;
  /** Beginn des Falls nach der Änderung. */
  toCaseStart: string;
  /** Zielfall gab es vorher nicht. */
  toCaseNew: boolean;
}

export interface SickSplitImpact {
  before: SickCaseFigures;
  after: SickCaseFigures;
  moves: SickCaseMove[];
}

function sickCaseFigures(
  jobId: string,
  shifts: Shift[],
  jobs: Job[],
  settings: Settings,
): SickCaseFigures {
  const resolve = makeResolver(jobs, settings);
  const sick = shifts.filter((s) => s.kind === "krank" && (s.jobId ?? "") === jobId);
  return {
    cases: new Set(sick.map((s) => s.sickCaseId ?? "-")).size,
    days: sick.length,
    paidDays: sick.filter((s) => shiftPayroll(s, { ...resolve(s), history: shifts }).paid).length,
    eur: payrollTotals(sick, resolve, shifts).earnings,
  };
}

/**
 * t653u (W-1/K-05): Vorher/Nachher für die Rückfrage, wenn eine Änderung einen Fall wegen
 * einer neuen Lücke ≥ 6 Tage trennt: Fälle, Krank-Tage, bezahlte Tage, € und welche Blöcke
 * in welchen Fall wechseln. Rein rechnend, speichert nichts.
 */
export function sickSplitImpact(
  jobId: string,
  before: Shift[],
  after: Shift[],
  jobs: Job[],
  settings: Settings,
): SickSplitImpact {
  const sickOf = (list: Shift[]) =>
    list
      .filter((s) => s.kind === "krank" && (s.jobId ?? "") === jobId)
      .sort((a, b) => a.date.localeCompare(b.date));
  const caseStarts = (list: Shift[]) => {
    const m = new Map<string, string>();
    for (const s of list) if (s.sickCaseId && !m.has(s.sickCaseId)) m.set(s.sickCaseId, s.date);
    return m;
  };
  const sickBefore = sickOf(before);
  const sickAfter = sickOf(after);
  const startsBefore = caseStarts(sickBefore);
  const startsAfter = caseStarts(sickAfter);
  const caseOnBefore = new Map(sickBefore.map((s) => [s.date, s.sickCaseId ?? ""]));
  const moves: SickCaseMove[] = [];
  let prevIdx = -2;
  sickAfter.forEach((s, idx) => {
    const fromId = caseOnBefore.get(s.date) ?? "";
    const toId = s.sickCaseId ?? "";
    if (!toId || fromId === toId) return;
    const fromCaseStart = fromId ? (startsBefore.get(fromId) ?? "") : "";
    const toCaseStart = startsAfter.get(toId) ?? "";
    const last = moves.at(-1);
    if (
      last &&
      prevIdx === idx - 1 &&
      last.fromCaseStart === fromCaseStart &&
      last.toCaseStart === toCaseStart
    ) {
      last.to = s.date;
      last.days += 1;
    } else {
      moves.push({
        from: s.date,
        to: s.date,
        days: 1,
        fromCaseStart,
        toCaseStart,
        toCaseNew: !startsBefore.has(toId),
      });
    }
    prevIdx = idx;
  });
  return {
    before: sickCaseFigures(jobId, before, jobs, settings),
    after: sickCaseFigures(jobId, after, jobs, settings),
    moves,
  };
}

function planAbsenceCore(
  job: Job,
  kind: ShiftKind,
  from: string,
  to: string,
  replace?: { jobId: string | undefined; kind: ShiftKind; from: string; to: string },
  data: AppData = getData(),
  options: { linkCaseId?: string | undefined } = {},
): AbsencePlan {
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const sameJob = replace ? (replace.jobId ?? job.id) === job.id : false;
  // V10-ABS-PLAN-P2-1: Unverändert gespeichert (gleicher Job, gleiche Art, gleiche
  // Daten) → nichts entfernen, nichts neu anlegen. Bestehende Einträge bleiben
  // unverändert, auch an Tagen, die laut gültigem Plan frei oder unbekannt sind.
  if (replace && sameJob && replace.kind === kind && replace.from === from && replace.to === to) {
    return { removeIds: [], created: [] };
  }
  // Einträge gleicher Art im neuen Zeitraum, deren historischer Plan UNBEKANNT ist,
  // bleiben stehen: kein Ersetzen nach einem geratenen Plan, keine stille Null.
  const keep = (s: Shift) =>
    sameJob &&
    s.kind === kind &&
    s.date >= lo &&
    s.date <= hi &&
    absencePlanDay(job, s.date).status === "unknown";
  const removed = replace
    ? absenceRangeTargets(
        data.shifts,
        replace.jobId,
        replace.kind,
        replace.from,
        replace.to,
      ).filter((s) => !keep(s))
    : [];
  const removeIds = removed.map((s) => s.id);
  const gone = new Set(removeIds);
  const remaining = data.shifts.filter((s) => !gone.has(s.id));
  const created = generateAbsence(job, kind, from, to, data.settings.bundesland, remaining);
  if (kind !== "krank") return { removeIds, created };
  // V10-ABS-PLAN-P2-1b: Ein ersetzter Krank-Zeitraum bleibt EIN Krankheitsfall (wie 78ef353):
  // behaltene Einträge (unbekannter Plan) und neu angelegte Tage teilen eine sickCaseId.
  const keptIds = new Set(removed.map((s) => s.id));
  const kept = replace
    ? absenceRangeTargets(
        data.shifts,
        replace.jobId,
        replace.kind,
        replace.from,
        replace.to,
      ).filter((s) => !keptIds.has(s.id) && keep(s))
    : [];
  if (kept.length) {
    return withSickCase(unifySickCase(removeIds, created, kept), data.shifts, "continued");
  }
  if (!created.length) return { removeIds, created };
  // V10-LATEBLOCK-CASE (DECISIONS R3): Grenze zum benachbarten Fall prüfen.
  //  - lückenlos (nur laut gültigem Plan sicher freie Tage dazwischen) → derselbe Fall;
  //  - unklar (leerer Arbeitstag oder unbekannter Plan dazwischen) → nur nach Bestätigung;
  //  - ≥ SICK_SEPARATE_GAP_DAYS leere Tage, andere Einträge, Einträge ohne sickCaseId → nie.
  //  - Automatisch NUR beim Bearbeiten eines Blocks, der schon zu diesem Fall gehörte
  //    (der Block behält seinen Fall); ein NEUER Zeitraum neben einem Fall wird nie still
  //    zugeordnet → Hinweis + Entscheidung (Haken) vor dem Speichern.
  const dates = created.map((s) => s.date).sort();
  const prev = sickCaseBoundary(job, dates[0]!, -1, remaining);
  const next = sickCaseBoundary(job, dates[dates.length - 1]!, 1, remaining);
  const ownCase =
    replace && sameJob && replace.kind === "krank" ? singleSickCaseId(removed) : undefined;
  const sides = [prev, next].filter((b) => b !== undefined);
  const own = sides.filter((b) => b.caseId === ownCase);
  // eigener Fall: lückenlos auf allen angrenzenden Seiten dieses Falls → bleibt derselbe Fall
  if (own.length && own.every((b) => b.kind === "continuous")) {
    return withSickCase(relabel(removeIds, created, ownCase!), data.shifts, "continued");
  }
  const candidate = own[0] ?? sides[0];
  if (candidate && options.linkCaseId === candidate.caseId) {
    return withSickCase(relabel(removeIds, created, candidate.caseId), data.shifts, "linked");
  }
  const plan = withSickCase({ removeIds, created }, data.shifts, "new");
  if (candidate && plan.sickCase) {
    plan.sickCase.linkCandidate = {
      caseId: candidate.caseId,
      start: caseStartIn(remaining, candidate.caseId) ?? "",
      boundary: candidate.kind,
    };
  }
  return plan;
}

/** Gemeinsame sickCaseId aller Einträge (nur wenn alle dieselbe, nicht leere ID tragen). */
function singleSickCaseId(entries: Shift[]): string | undefined {
  const ids = new Set(entries.map((s) => s.sickCaseId));
  const [id] = [...ids];
  return ids.size === 1 && id ? id : undefined;
}

/**
 * Nächster Krankheitsfall vor (step −1) bzw. nach (step +1) `date`: läuft über LEERE Tage.
 * Nur laut gültigem (historischem) Plan sicher freie Tage halten die Grenze lückenlos;
 * ein leerer Arbeitstag oder unbekannter Plan macht sie unklar. Kein Rückgriff auf
 * Schätzungen aus der Payroll.
 */
function sickCaseBoundary(
  job: Job,
  date: string,
  step: -1 | 1,
  shifts: Shift[],
): { kind: "continuous" | "ambiguous"; caseId: string } | undefined {
  let ambiguous = false;
  let empty = 0;
  for (let d = addDays(date, step); ; d = addDays(d, step)) {
    const entries = shifts.filter((s) => (s.jobId ?? "") === job.id && s.date === d);
    if (entries.length) {
      if (!entries.every((s) => s.kind === "krank")) return undefined;
      const ids = new Set(entries.map((s) => s.sickCaseId));
      const [id] = [...ids];
      // Einträge ohne sickCaseId (Bestand/D1) oder gemischte Fälle: nicht anfassen.
      if (ids.size !== 1 || !id) return undefined;
      return { kind: ambiguous ? "ambiguous" : "continuous", caseId: id };
    }
    empty += 1;
    if (empty >= SICK_SEPARATE_GAP_DAYS) return undefined;
    if (absencePlanDay(job, d).status !== "off") ambiguous = true;
  }
}

function caseStartIn(shifts: Shift[], caseId: string): string | undefined {
  return shifts
    .filter((s) => s.kind === "krank" && s.sickCaseId === caseId)
    .map((s) => s.date)
    .sort()[0];
}

function relabel(removeIds: string[], created: Shift[], caseId: string): AbsencePlan {
  return { removeIds, created: created.map((s) => ({ ...s, sickCaseId: caseId })) };
}

function withSickCase(
  plan: AbsencePlan,
  shifts: Shift[],
  mode: AbsenceSickCase["mode"],
): AbsencePlan {
  const caseId = plan.created.find((s) => s.kind === "krank" && s.sickCaseId)?.sickCaseId;
  if (!caseId) return plan;
  const start = caseStartIn(shiftsAfterPlan(shifts, plan), caseId) ?? "";
  return { ...plan, sickCase: { mode: mode, caseId, start } };
}

/** Alle Tage eines Krank-Ersetzens auf eine sickCaseId bringen (nur innerhalb dieses Plans). */
function unifySickCase(removeIds: string[], created: Shift[], kept: Shift[]): AbsencePlan {
  if (!kept.length) return { removeIds, created };
  const caseId = kept.find((s) => s.sickCaseId)?.sickCaseId ?? created[0]?.sickCaseId;
  if (!caseId) return { removeIds, created };
  const relabel = kept.filter((s) => s.sickCaseId !== caseId);
  return {
    removeIds: [...removeIds, ...relabel.map((s) => s.id)],
    created: [
      ...created.map((s) => ({ ...s, sickCaseId: caseId })),
      ...relabel.map((s) => ({ ...s, sickCaseId: caseId })),
    ],
  };
}

/**
 * Tage im Zeitraum, an denen wegen UNBEKANNTEM historischem Plan nichts angelegt
 * wird (nur freie, noch nicht belegte Tage) – für einen eigenen Hinweis.
 */
export function unknownPlanDates(
  job: Job,
  from: string,
  to: string,
  shifts: Shift[] = getData().shifts,
): string[] {
  const taken = new Set(shifts.filter((s) => s.jobId === job.id).map((s) => s.date));
  return eachIsoDateInclusive(from, to).filter(
    (d) => !taken.has(d) && absencePlanDay(job, d).status === "unknown",
  );
}

/** Plant das Löschen eines Abwesenheitszeitraums, OHNE zu speichern. */
export function planAbsenceRemoval(
  jobId: string | undefined,
  kind: ShiftKind,
  from: string,
  to: string,
  data: AppData = getData(),
): AbsencePlan {
  return {
    removeIds: absenceRangeTargets(data.shifts, jobId, kind, from, to).map((s) => s.id),
    created: [],
  };
}

/** Geplante Abwesenheitsänderung in einem Schritt speichern. */
export function applyAbsencePlan(plan: AbsencePlan): void {
  if (!plan.removeIds.length && !plan.created.length) return;
  storeApplyShiftChanges(plan.removeIds, plan.created);
}

/** Schichtbestand nach Anwendung eines Plans (für die Vorschau). */
export function shiftsAfterPlan(shifts: Shift[], plan: AbsencePlan): Shift[] {
  const gone = new Set(plan.removeIds);
  return [...shifts.filter((s) => !gone.has(s.id)), ...plan.created];
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
