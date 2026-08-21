import { currentLocale } from "@/lib/i18n";

import { effectiveShiftRate } from "./rate";
import { DEFAULT_SUPPLEMENTS, type Job, type Shift, type Supplements } from "./types";

export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Dauer in Stunden, berücksichtigt Nachtschichten über Mitternacht. */
export function shiftHours(shift: Shift): number {
  let diff = toMinutes(shift.end) - toMinutes(shift.start);
  if (diff < 0) diff += 24 * 60;
  diff -= shift.breakMinutes || 0;
  return Math.max(0, diff) / 60;
}

/** Anteil der Arbeitszeit im Nachtfenster (in Stunden). */
export function nightHours(shift: Shift, from: string, to: string): number {
  const start = toMinutes(shift.start);
  let end = toMinutes(shift.end);
  if (end <= start) end += 24 * 60;
  const nStart = toMinutes(from);
  let nEnd = toMinutes(to);
  if (nEnd <= nStart) nEnd += 24 * 60;

  let overlap = 0;
  for (const offset of [-24 * 60, 0, 24 * 60]) {
    const a = Math.max(start, nStart + offset);
    const b = Math.min(end, nEnd + offset);
    if (b > a) overlap += b - a;
  }
  const gross = end - start;
  if (gross <= 0) return 0;
  // Pause anteilig abziehen
  const paid = Math.max(0, gross - (shift.breakMinutes || 0));
  return (Math.min(overlap, gross) / gross) * paid / 60;
}

export interface Breakdown {
  hours: number;
  base: number;
  bonus: number;
  total: number;
  labels: string[];
}

function bonusFor(
  supplement: { enabled: boolean; mode: string; value: number },
  hours: number,
  rate: number,
): number {
  if (!supplement.enabled || hours <= 0) return 0;
  return supplement.mode === "prozent"
    ? (hours * rate * supplement.value) / 100
    : hours * supplement.value;
}

export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).getDay();
}

export function shiftBreakdown(
  shift: Shift,
  options: {
    job?: Job | undefined;
    supplements?: Supplements | undefined;
    holiday?: boolean;
    defaultRate?: number | undefined;
  } = {},
): Breakdown {
  const sup = options.job?.supplements ?? options.supplements ?? DEFAULT_SUPPLEMENTS;
  const hours = shiftHours(shift);
  const rate = effectiveShiftRate(shift, { job: options.job, defaultRate: options.defaultRate });
  const base = hours * rate;
  const labels: string[] = [];
  let bonus = 0;

  const day = weekday(shift.date);
  if (options.holiday && sup.holiday.enabled) {
    const value = bonusFor(sup.holiday, hours, rate);
    if (value) labels.push("Feiertag");
    bonus += value;
  } else if (day === 0 && sup.sunday.enabled) {
    const value = bonusFor(sup.sunday, hours, rate);
    if (value) labels.push("Sonntag");
    bonus += value;
  } else if (day === 6 && sup.saturday.enabled) {
    const value = bonusFor(sup.saturday, hours, rate);
    if (value) labels.push("Samstag");
    bonus += value;
  }

  if (sup.night.enabled) {
    const nh = nightHours(shift, sup.nightStart, sup.nightEnd);
    const value = bonusFor(sup.night, nh, rate);
    if (value) labels.push("Nacht");
    bonus += value;
  }

  if (shift.overtime && sup.overtime.enabled) {
    const value = bonusFor(sup.overtime, hours, rate);
    if (value) labels.push("Überstunden");
    bonus += value;
  }

  return { hours, base, bonus, total: base + bonus, labels };
}

export function shiftEarnings(
  shift: Shift,
  options?: { job?: Job | undefined; supplements?: Supplements | undefined; holiday?: boolean },
): number {
  return shiftBreakdown(shift, options ?? {}).total;
}

export function sumHours(shifts: Shift[]): number {
  return shifts.reduce((acc, s) => acc + shiftHours(s), 0);
}

export function sumEarnings(
  shifts: Shift[],
  resolve?: (shift: Shift) => {
    job?: Job | undefined;
    supplements?: Supplements | undefined;
    holiday?: boolean;
  },
): number {
  return shifts.reduce((acc, s) => acc + shiftEarnings(s, resolve?.(s)), 0);
}

export function averageRate(shifts: Shift[]): number {
  const h = sumHours(shifts);
  return h > 0 ? sumEarnings(shifts) / h : 0;
}

const eurCache = new Map<string, Intl.NumberFormat>();
const numCache = new Map<string, Intl.NumberFormat>();
const monthCache = new Map<string, string[]>();

function eurFormat(locale: string) {
  let f = eurCache.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
    eurCache.set(locale, f);
  }
  return f;
}

function numFormat(locale: string) {
  let f = numCache.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    numCache.set(locale, f);
  }
  return f;
}

export function formatEuro(value: number, locale = currentLocale()): string {
  return eurFormat(locale).format(value || 0);
}

export function formatHours(value: number, locale = currentLocale()): string {
  return `${numFormat(locale).format(value || 0)} h`;
}

/** Datum lokalisiert (Standard: eingestellte Sprache). */
export function formatDate(iso: string, locale = currentLocale()): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

/** @deprecated formatDate verwenden – bleibt für Kompatibilität. */
export const formatDateDE = formatDate;

function namesFor(locale: string, key: string, build: () => string[]): string[] {
  const cacheKey = `${locale}:${key}`;
  let list = monthCache.get(cacheKey);
  if (!list) {
    list = build();
    monthCache.set(cacheKey, list);
  }
  return list;
}

/** Monatsnamen (lang) in der gewünschten Sprache. */
export function monthNames(locale = currentLocale()): string[] {
  return namesFor(locale, "long", () => {
    const f = new Intl.DateTimeFormat(locale, { month: "long" });
    return Array.from({ length: 12 }, (_, i) => f.format(new Date(2021, i, 1)));
  });
}

export function monthNamesShort(locale = currentLocale()): string[] {
  return namesFor(locale, "short", () => {
    const f = new Intl.DateTimeFormat(locale, { month: "short" });
    return Array.from({ length: 12 }, (_, i) => f.format(new Date(2021, i, 1)));
  });
}

/** Wochentage ab Montag. */
export function weekdayNames(locale = currentLocale(), style: "long" | "short" = "long"): string[] {
  return namesFor(locale, `wd-${style}`, () => {
    const f = new Intl.DateTimeFormat(locale, { weekday: style });
    // 2021-03-01 war ein Montag
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(2021, 2, 1 + i)));
  });
}

export const MONTHS_DE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

export const MONTHS_SHORT_DE = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
];

export const WEEKDAYS_DE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shiftsInMonth(shifts: Shift[], year: number, month: number): Shift[] {
  return shifts.filter((s) => {
    const [y, m] = s.date.split("-").map(Number);
    return y === year && m === month + 1;
  });
}

export function shiftsInYear(shifts: Shift[], year: number): Shift[] {
  return shifts.filter((s) => Number(s.date.slice(0, 4)) === year);
}

export function shiftsOnDate(shifts: Shift[], date: string): Shift[] {
  return shifts.filter((s) => s.date === date);
}

export function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export function timeFromDate(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
