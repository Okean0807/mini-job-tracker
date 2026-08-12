import type { Shift } from "./types";

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

export function shiftEarnings(shift: Shift): number {
  return shiftHours(shift) * (shift.rate || 0);
}

export function sumHours(shifts: Shift[]): number {
  return shifts.reduce((acc, s) => acc + shiftHours(s), 0);
}

export function sumEarnings(shifts: Shift[]): number {
  return shifts.reduce((acc, s) => acc + shiftEarnings(s), 0);
}

export function averageRate(shifts: Shift[]): number {
  const h = sumHours(shifts);
  return h > 0 ? sumEarnings(shifts) / h : 0;
}

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const num = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatEuro(value: number): string {
  return eur.format(value || 0);
}

export function formatHours(value: number): string {
  return `${num.format(value || 0)} h`;
}

export function formatDateDE(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
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
