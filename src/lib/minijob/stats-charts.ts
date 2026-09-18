import { formatDate, formatEuro, formatHours, shiftEarnings, shiftHours } from "./calc";
import type { Resolver } from "./resolve";
import type { Shift } from "./types";

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
 * Tage ohne Arbeit haben verdienst/stunden = 0 (volle Monatstendenz sichtbar).
 * Mehrere Schichten am selben Tag werden summiert.
 */
export function buildDailyMonthSeries(
  year: number,
  month: number,
  shifts: Shift[],
  resolve: Resolver,
): DailyChartPoint[] {
  const n = daysInCalendarMonth(year, month);
  const byDate = new Map<string, { verdienst: number; stunden: number }>();

  for (const s of shifts) {
    const prev = byDate.get(s.date) ?? { verdienst: 0, stunden: 0 };
    prev.verdienst += shiftEarnings(s, resolve(s));
    prev.stunden += shiftHours(s);
    byDate.set(s.date, prev);
  }

  const series: DailyChartPoint[] = [];
  for (let day = 1; day <= n; day++) {
    const date = isoDay(year, month, day);
    const agg = byDate.get(date);
    series.push({
      day,
      tag: String(day),
      date,
      verdienst: Number((agg?.verdienst ?? 0).toFixed(2)),
      stunden: Number((agg?.stunden ?? 0).toFixed(2)),
    });
  }
  return series;
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
