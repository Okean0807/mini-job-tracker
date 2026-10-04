/**
 * ISO-8601-Kalenderwochen auf reinen DateKeys ("YYYY-MM-DD").
 *
 * - Woche beginnt Montag und endet Sonntag (wie `FixedDay`-Index 0 = Montag
 *   und `weekdayNames()` in `calc.ts`).
 * - KW 1 ist die Woche mit dem ersten Donnerstag des Jahres; das ISO-Wochenjahr
 *   (`isoYear`) kann vom Kalenderjahr abweichen (z. B. 01.01.2027 = KW 53/2026).
 * - Ein Jahr hat 53 ISO-Wochen, wenn der 1. Januar ein Donnerstag ist oder
 *   (Schaltjahr) ein Mittwoch; sonst 52.
 * - Zeitzonen-unabhängig (siehe `date-key.ts`).
 */
import {
  addDays,
  dayOfYear,
  isoWeekday,
  parseDateKey,
  toDateKey,
  type DateKey,
  type DateRange,
} from "./date-key";

/** ISO-Woche: Wochenjahr + Wochennummer (1 … 52/53). */
export interface IsoWeek {
  isoYear: number;
  week: number;
}

/** ISO-Woche (Wochenjahr + Nummer) des Kalendertags. */
export function isoWeekOf(key: DateKey): IsoWeek {
  // Donnerstag derselben ISO-Woche bestimmt Wochenjahr und Nummer.
  const thursday = addDays(key, 4 - isoWeekday(key));
  return {
    isoYear: parseDateKey(thursday).year,
    week: Math.floor((dayOfYear(thursday) - 1) / 7) + 1,
  };
}

/** Montag der ISO-Woche, in der `key` liegt. */
export function isoWeekStart(key: DateKey): DateKey {
  return addDays(key, 1 - isoWeekday(key));
}

/** Sonntag der ISO-Woche, in der `key` liegt. */
export function isoWeekEnd(key: DateKey): DateKey {
  return addDays(key, 7 - isoWeekday(key));
}

/** Anzahl ISO-Wochen des Wochenjahres (52 oder 53). */
export function isoWeeksInYear(isoYear: number): 52 | 53 {
  // Der 28.12. liegt immer in der letzten ISO-Woche seines Jahres.
  return isoWeekOf(toDateKey(isoYear, 11, 28)).week === 53 ? 53 : 52;
}

/** `true`, wenn (isoYear, week) existiert (week 1 … isoWeeksInYear). */
export function isValidIsoWeek(isoYear: number, week: number): boolean {
  return (
    Number.isInteger(isoYear) &&
    isoYear >= 1 &&
    isoYear <= 9998 &&
    Number.isInteger(week) &&
    week >= 1 &&
    week <= isoWeeksInYear(isoYear)
  );
}

/**
 * Montag … Sonntag der ISO-Woche (isoYear, week) als inklusiver Bereich.
 * Wirft `RangeError`, wenn die Woche nicht existiert (z. B. KW 53/2027).
 */
export function isoWeekRange(isoYear: number, week: number): DateRange {
  if (!isValidIsoWeek(isoYear, week)) {
    throw new RangeError(`Ungültige ISO-Woche: ${week}/${isoYear}`);
  }
  // Der 4. Januar liegt immer in KW 1.
  const week1Monday = isoWeekStart(toDateKey(isoYear, 0, 4));
  const start = addDays(week1Monday, (week - 1) * 7);
  return { start, end: addDays(start, 6) };
}

/** Wochenschlüssel nach ISO 8601, z. B. `"2026-W53"`. */
export function formatIsoWeekKey(w: IsoWeek): string {
  return `${String(w.isoYear).padStart(4, "0")}-W${String(w.week).padStart(2, "0")}`;
}

/** Parst `"YYYY-Www"`; `null` bei ungültiger oder nicht existierender Woche. */
export function parseIsoWeekKey(value: string): IsoWeek | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!m) return null;
  const isoYear = Number(m[1]);
  const week = Number(m[2]);
  return isValidIsoWeek(isoYear, week) ? { isoYear, week } : null;
}

/** Nachbarwoche (`delta` Wochen vor/zurück) über Jahresgrenzen und KW 53 hinweg. */
export function shiftIsoWeek(w: IsoWeek, delta: number): IsoWeek {
  return isoWeekOf(addDays(isoWeekRange(w.isoYear, w.week).start, delta * 7));
}
