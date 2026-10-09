/**
 * Statistik S5: Wochenansicht und Vorwochen-Vergleich – reine Komposition
 * vorhandener Bausteine, KEINE eigene Payroll-, Perioden- oder Soll/Ist-Logik.
 *
 * - Woche/Status/Vergleichsfenster: `period.ts` (S1, ISO-Woche, `comparisonWindow`).
 * - Werte: `evaluateShifts` (S1/S2-Adapter auf die unveränderte `shiftPayroll`)
 *   IMMER mit der vollständigen Historie (alle Schichten), danach
 *   `aggregateRange` / `bucketByDay` (`period-aggregate.ts`).
 * - Arbeitstage: `countWorkDays` (S1-Definition: nur `kind === "arbeit"`).
 * - Soll/Ist: Summe der bestehenden Tagesfunktionen `daySollHours` /
 *   `dayIstHours` (`fest-time-account.ts`, unverändert) über die 7 Tage – gleiche
 *   Semantik wie `monthTimeAccount` (Krank/Urlaub mindern das Soll nicht, Ist
 *   enthält auch geplante Arbeitsschichten).
 *
 * Tatsächlich / geplant (bestehende Datumsregel): DateKey ≤ heute = tatsächlich,
 * DateKey > heute = geplant (`period-aggregate.ts`, Option `today`).
 * Hauptwerte sind tatsächlich; geplante Werte werden nur separat ausgewiesen.
 *
 * Keine Jahresgrenze, keine Exporte, keine Zahlungen in der Woche.
 */
import { addDays, parseDateKey, toDateKey, type DateKey, type DateRange } from "./date-key";
import { dayIstHours, daySollHours } from "./fest-time-account";
import {
  comparisonWindow,
  elapsedDays,
  elapsedRange,
  periodContaining,
  periodStatus,
  type PeriodStatus,
  type WeekPeriod,
} from "./period";
import {
  aggregateRange,
  bucketByDay,
  compareValues,
  countWorkDays,
  type ValueComparison,
} from "./period-aggregate";
import { evaluateShifts, payrollAggregateOptions, type EvaluatedShift } from "./period-payroll";
import type { Resolver } from "./resolve";
import type { Job, Shift } from "./types";

/** Summen einer Woche bzw. eines Teilbereichs (ungerundet). */
export interface WeekTotals {
  /** Gesamtes Payroll-Entgelt (Arbeit + bezahlte Abwesenheit). */
  earnings: number;
  /** Entgelt aus geleisteter Arbeit. */
  workEarnings: number;
  /** Entgelt aus bezahlter Abwesenheit (Urlaub, Krank, Feiertag). */
  absenceEarnings: number;
  /** Tatsächlich geleistete Arbeitsstunden (Abwesenheit = 0 h). */
  workedHours: number;
  /** Arbeitstage nach S1-Definition (`countWorkDays`, nur `arbeit`). */
  workDays: number;
  /** Anzahl Einträge (inkl. Abwesenheiten). */
  entries: number;
}

export interface WeekDayPoint {
  date: DateKey;
  /** `true`, wenn der Tag nach heute liegt (alle Einträge des Tages geplant). */
  planned: boolean;
  earnings: number;
  workedHours: number;
}

export interface WeekStats {
  week: WeekPeriod;
  status: PeriodStatus;
  /** Bereits vergangene Tage inkl. heute (0 … 7). */
  elapsedDays: number;
  /** Tatsächlich (DateKey ≤ heute). */
  actual: WeekTotals;
  /** Geplant (DateKey > heute). */
  planned: WeekTotals;
  /** Immer 7 Tage, Mo–So. */
  days: WeekDayPoint[];
}

const ZERO: WeekTotals = {
  earnings: 0,
  workEarnings: 0,
  absenceEarnings: 0,
  workedHours: 0,
  workDays: 0,
  entries: 0,
};

/** Woche, die beim Wechsel auf den Wochen-Tab gezeigt wird (Entscheidung E9). */
export function initialWeekForMonth(year: number, month: number, today: DateKey): WeekPeriod {
  const t = parseDateKey(today);
  if (t.year === year && t.month === month) return periodContaining("week", today);
  return periodContaining("week", toDateKey(year, month, 1));
}

function inRange<T extends { date: DateKey }>(items: readonly T[], range: DateRange): T[] {
  return items.filter((s) => s.date >= range.start && s.date <= range.end);
}

function totalsFor(
  range: DateRange | null,
  shifts: readonly Shift[],
  evaluated: readonly EvaluatedShift[],
): WeekTotals {
  if (!range) return { ...ZERO };
  const b = aggregateRange(range, evaluated, payrollAggregateOptions());
  return {
    earnings: b.values.earnings,
    workEarnings: b.values.workEarnings,
    absenceEarnings: b.values.absenceEarnings,
    workedHours: b.values.workedHours,
    workDays: countWorkDays(shifts, range),
    entries: b.count,
  };
}

/** Bereich der geplanten Tage der Woche (nach heute) oder `null`. */
export function plannedRange(week: WeekPeriod, today: DateKey): DateRange | null {
  if (today >= week.end) return null;
  const start = today < week.start ? week.start : addDays(today, 1);
  return { start, end: week.end };
}

/**
 * Wochenwerte für die (ggf. Job-gefilterte) Liste `shifts`.
 * @param history Vollständige Historie für die Payroll – IMMER alle Schichten.
 */
export function buildWeekStats(
  week: WeekPeriod,
  shifts: readonly Shift[],
  history: Shift[],
  resolve: Resolver,
  today: DateKey,
): WeekStats {
  const inWeek = inRange(shifts, week);
  const evaluated = evaluateShifts(inWeek, resolve, history);
  const actualRange = elapsedRange(week, today);
  const planRange = plannedRange(week, today);
  const days = bucketByDay(week, evaluated, payrollAggregateOptions()).map((d) => ({
    date: d.date,
    planned: d.date > today,
    earnings: d.values.earnings,
    workedHours: d.values.workedHours,
  }));
  return {
    week,
    status: periodStatus(week, today),
    elapsedDays: elapsedDays(week, today),
    actual: totalsFor(actualRange, inWeek, evaluated),
    planned: totalsFor(planRange, inWeek, evaluated),
    days,
  };
}

/* ------------------------------ Vergleich ------------------------------ */

export interface WeekComparison {
  status: PeriodStatus;
  previousWeek: WeekPeriod;
  /** Verglichene Tage (7 bei abgeschlossener Woche, sonst vergangene Tage). */
  days: number;
  current: DateRange;
  previous: DateRange;
  earnings: ValueComparison;
  workedHours: ValueComparison;
  workDays: ValueComparison;
}

/**
 * Vorwochen-Vergleich nach `comparisonWindow` (S1): abgeschlossene Woche
 * komplett vs. komplette Vorwoche; laufende Woche Mo…heute vs. gleiche Anzahl
 * Tage der Vorwoche; zukünftige Woche → `null` (kein Vergleich).
 * Beide Fenster enden spätestens heute → nur tatsächliche Werte.
 */
export function buildWeekComparison(
  week: WeekPeriod,
  shifts: readonly Shift[],
  history: Shift[],
  resolve: Resolver,
  today: DateKey,
): WeekComparison | null {
  const win = comparisonWindow(week, today);
  if (!win.current || !win.previous) return null;
  const cur = inRange(shifts, win.current);
  const prev = inRange(shifts, win.previous);
  const c = totalsFor(win.current, cur, evaluateShifts(cur, resolve, history));
  const p = totalsFor(win.previous, prev, evaluateShifts(prev, resolve, history));
  return {
    status: win.status,
    previousWeek: win.previousPeriod as WeekPeriod,
    days: win.days,
    current: win.current,
    previous: win.previous,
    earnings: compareValues(c.earnings, p.earnings),
    workedHours: compareValues(c.workedHours, p.workedHours),
    workDays: compareValues(c.workDays, p.workDays),
  };
}

/** Anzeige-Variante der relativen Veränderung (Entscheidung E7). */
export type PercentDisplay =
  { kind: "percent"; value: number } | { kind: "noPrevious" } | { kind: "noValues" };

/** Symmetrisch auf ganze Prozent runden (kein −0). */
export function roundPercent(percent: number): number {
  const r = Math.sign(percent) * Math.round(Math.abs(percent));
  return r === 0 ? 0 : r;
}

/**
 * - beide 0 → „Keine Werte“
 * - Vorperiode 0 → kein Prozent („Vorwoche ohne Einträge“)
 * - sonst ganze Prozent (Rückgang auf 0 = −100 %)
 * Werte werden vorher auf Cent bzw. 1/100 h gerundet, damit Rundungsreste
 * (z. B. 1e-13) nicht als Wert gelten.
 */
export function percentDisplay(c: ValueComparison): PercentDisplay {
  const cur = Math.round(c.current * 100) / 100;
  const prev = Math.round(c.previous * 100) / 100;
  if (cur === 0 && prev === 0) return { kind: "noValues" };
  if (prev === 0 || c.percent === null) return { kind: "noPrevious" };
  return { kind: "percent", value: roundPercent(c.percent) };
}

/* ------------------------------ Aufteilung ----------------------------- */

export interface WeekBreakdownRow {
  job: Job;
  actual: { hours: number; earnings: number };
  planned: { hours: number; earnings: number };
}

/**
 * Aufteilung je Job (Entscheidung E8): nur die per Filter gewählten Jobs;
 * ein Job (auch archiviert) erscheint nur, wenn er in der Woche Werte hat.
 * Sortierung wie Monat/Jahr: tatsächlicher Verdienst absteigend.
 */
export function buildWeekBreakdown(
  week: WeekPeriod,
  selectedJobs: readonly Job[],
  shifts: readonly Shift[],
  history: Shift[],
  resolve: Resolver,
  today: DateKey,
): WeekBreakdownRow[] {
  return selectedJobs
    .map((job) => {
      const s = buildWeekStats(
        week,
        shifts.filter((x) => x.jobId === job.id),
        history,
        resolve,
        today,
      );
      return {
        job,
        actual: { hours: s.actual.workedHours, earnings: s.actual.earnings },
        planned: { hours: s.planned.workedHours, earnings: s.planned.earnings },
      };
    })
    .filter(
      (r) =>
        r.actual.hours > 0 ||
        r.actual.earnings > 0 ||
        r.planned.hours > 0 ||
        r.planned.earnings > 0,
    )
    .sort((a, b) => b.actual.earnings - a.actual.earnings);
}

/* ------------------------------- Soll/Ist ------------------------------ */

export interface WeekTimeAccountDay {
  date: DateKey;
  soll: number;
  ist: number;
  diff: number;
}

export interface WeekTimeAccount {
  /** Soll der ganzen Kalenderwoche laut Plan (wie Monat). */
  soll: number;
  /** Ist (Arbeit) – kann geplante Arbeitsschichten enthalten (wie Monat). */
  ist: number;
  saldo: number;
  /** `true`, wenn Ist Einträge nach heute enthält. */
  istIncludesPlanned: boolean;
  days: WeekTimeAccountDay[];
}

const round2 = (n: number) => Number(n.toFixed(2));

/**
 * Soll/Ist einer ISO-Woche: Summe der bestehenden Tagesfunktionen – gleiche
 * Semantik wie `monthTimeAccount` (Σ gekappter Wochen eines Monats = Monat).
 */
export function weekTimeAccount(
  job: Job,
  week: WeekPeriod,
  shifts: Shift[],
  today: DateKey,
  bundesland = "",
): WeekTimeAccount {
  const days: WeekTimeAccountDay[] = [];
  let soll = 0;
  let ist = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(week.start, i);
    const s = daySollHours(job, date, bundesland);
    const t = dayIstHours(job, date, shifts);
    soll += s;
    ist += t;
    days.push({ date, soll: round2(s), ist: round2(t), diff: round2(t - s) });
  }
  const istIncludesPlanned = shifts.some(
    (s) =>
      s.jobId === job.id &&
      s.kind === "arbeit" &&
      s.date > today &&
      s.date >= week.start &&
      s.date <= week.end,
  );
  return {
    soll: round2(soll),
    ist: round2(ist),
    saldo: round2(ist - soll),
    istIncludesPlanned,
    days,
  };
}
