import { formatDate, formatEuro, formatHours } from "./calc";
import { parseDateKey } from "./date-key";
import type { Resolver } from "./resolve";
import { dayIstHours, daySollHours } from "./fest-time-account";
import { monthPeriod } from "./period";
import { bucketByDay } from "./period-aggregate";
import { evaluateShifts, payrollAggregateOptions } from "./period-payroll";
import type { Job, Shift } from "./types";

/** Ein Kalendertag im Monatsdiagramm (auch ohne Schichten → 0). */
export interface DailyChartPoint {
  /** Kalendertag 1..N */
  day: number;
  /** X-Achsen-Label (z. B. "1", "15", "31") */
  tag: string;
  /** ISO-Datum YYYY-MM-DD */
  date: string;
  verdienst: number;
  stunden: number;
  /** Fest: Sollstunden laut Wochenplan */
  soll?: number;
  /** Fest: Iststunden (Arbeit) */
  ist?: number;
  /** Fest: Ist − Soll */
  diff?: number;
}

/** Anzahl Kalendertage im Monat (month 0-basiert). */
export function daysInCalendarMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Tagesreihe für den gesamten Monat: jeder Kalendertag 1..N ist vorhanden.
 * Tage ohne Einträge haben verdienst/stunden = 0 (volle Monatstendenz sichtbar).
 * Mehrere Einträge am selben Tag werden summiert.
 *
 * Werte kommen ausschließlich aus der bestehenden Payroll (B1):
 * `shiftPayroll` je Eintrag über `evaluateShifts` mit der VOLLSTÄNDIGEN
 * `history` (alle Schichten, nicht Job-Filter/Monat), danach Tages-Buckets
 * über `bucketByDay`. Damit gilt Σ Tage = `payrollTotals(shifts, resolve, history)`:
 * - `verdienst` = Payroll-Entgelt inkl. Zuschläge und bezahlter Abwesenheit
 *   (Urlaub 13-Wochen-Schnitt, Krank/Feiertag nach Plan); unbezahlt (Frei) = 0.
 * - `stunden` = geleistete Arbeitsstunden (`workedHours`); Abwesenheit = 0 h.
 * Geplante (zukünftige) Einträge des Monats zählen mit (wie die Monatskarte).
 *
 * @param shifts  Einträge der Ansicht (z. B. Monat + Job-Filter); nur Einträge
 *                des Monats werden berücksichtigt.
 * @param history Vollständige Historie für die Payroll (i. d. R. alle Schichten).
 */
export function buildDailyMonthSeries(
  year: number,
  month: number,
  shifts: readonly Shift[],
  resolve: Resolver,
  history: Shift[],
): DailyChartPoint[] {
  const period = monthPeriod(year, month);
  const inMonth = shifts.filter((s) => s.date >= period.start && s.date <= period.end);
  const evaluated = evaluateShifts(inMonth, resolve, history);
  return bucketByDay(period, evaluated, payrollAggregateOptions()).map((bucket) => {
    const { day } = parseDateKey(bucket.date);
    return {
      day,
      tag: String(day),
      date: bucket.date,
      verdienst: Number(bucket.values.earnings.toFixed(2)),
      stunden: Number(bucket.values.workedHours.toFixed(2)),
    };
  });
}

/** Klarer Diagrammtitel inkl. Monat/Jahr, z. B. "Verdienst pro Tag — September 2026". */
export function dailyChartTitle(baseTitle: string, monthName: string, year: number): string {
  const month = monthName.trim();
  const base = baseTitle.trim();
  if (!month) return `${base} — ${year}`;
  return `${base} — ${month} ${year}`;
}

/**
 * Tooltip-Zeile: Datum + Stunden + €
 * Beispiel (de-DE): "20.09.2026 / 7,50 h / 151,88 €"
 */
export function formatDailyTooltipLine(
  dateIso: string,
  hours: number,
  earnings: number,
  locale?: string,
): string {
  return `${formatDate(dateIso, locale)} / ${formatHours(hours, locale)} / ${formatEuro(earnings, locale)}`;
}

/**
 * Intelligente X-Tick-Dichte: alle Tage bleiben in den Daten,
 * aber die Achse zeigt nur eine lesbare Teilmenge (1 und N immer dabei).
 */
export function dailyXAxisTicks(daysInMonth: number): number[] {
  if (daysInMonth <= 0) return [];
  if (daysInMonth <= 12) {
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  }
  const target = daysInMonth <= 20 ? 8 : 10;
  const step = Math.max(1, Math.round((daysInMonth - 1) / (target - 1)));
  const ticks: number[] = [];
  for (let d = 1; d <= daysInMonth; d += step) {
    ticks.push(d);
  }
  if (ticks[ticks.length - 1] !== daysInMonth) {
    ticks.push(daysInMonth);
  }
  return ticks;
}


/**
 * Fest-Monatsreihe: jeder Kalendertag mit Soll / Ist / Diff (Arbeitszeitkonto).
 * Tage ohne Plan haben soll=0; Ist summiert Arbeitsschichten des Jobs.
 */
export function buildFestDailyMonthSeries(
  year: number,
  month: number,
  job: Job,
  shifts: Shift[],
  bundesland = "",
): DailyChartPoint[] {
  const n = daysInCalendarMonth(year, month);
  const jobShifts = shifts.filter((s) => s.jobId === job.id);
  const series: DailyChartPoint[] = [];
  for (let day = 1; day <= n; day++) {
    const date = isoDay(year, month, day);
    const soll = daySollHours(job, date, bundesland);
    const ist = dayIstHours(job, date, jobShifts);
    series.push({
      day,
      tag: String(day),
      date,
      verdienst: 0,
      stunden: ist,
      soll: Number(soll.toFixed(2)),
      ist: Number(ist.toFixed(2)),
      diff: Number((ist - soll).toFixed(2)),
    });
  }
  return series;
}
