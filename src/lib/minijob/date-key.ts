/**
 * Reine Kalender-Datumsschlüssel ("YYYY-MM-DD") ohne Zeitzonen-Bezug.
 *
 * Grundlage der Perioden-Helfer (ISO-Woche, Monat, Jahr) für die Statistik.
 *
 * Regeln:
 * - Ein `DateKey` ist ein Kalendertag, kein Zeitpunkt. Er entspricht exakt
 *   `Shift.date` und dem Ergebnis von `isoDate(new Date())` (`calc.ts`) für
 *   "heute" in der lokalen Zeitzone des Geräts.
 * - Datumsstrings werden nie über den Date-Konstruktor oder `Date.parse`
 *   geparst (das wäre ein UTC-Parse), und es wird nie mit lokalen
 *   Zeitstempeln (+24 h) gerechnet.
 * - Tagesarithmetik läuft über eine fortlaufende Tagesnummer auf Basis von
 *   `Date.UTC(y, m, d)` (reine Kalenderrechnung: kein DST, keine lokale TZ).
 *   Ergebnisse sind daher in jeder Zeitzone identisch.
 * - Monat ist – wie in `shiftsInMonth`, `payPeriods`, `monthNames()` und
 *   `daysInCalendarMonth` – **0-basiert** (0 = Januar … 11 = Dezember).
 *   Tag ist 1-basiert.
 */

/** Kalendertag im Format "YYYY-MM-DD" (wie `Shift.date`). */
export type DateKey = string;

/** Zerlegter Kalendertag. `month` ist 0-basiert (0 = Januar). */
export interface DateParts {
  year: number;
  /** 0 = Januar … 11 = Dezember */
  month: number;
  /** 1 … 31 */
  day: number;
}

/** Inklusiver Kalenderbereich `start` … `end` (beide als DateKey). */
export interface DateRange {
  start: DateKey;
  end: DateKey;
}

/** Nur für UTC-Epoch-Werte (ohne Zeitumstellung), nie für lokale Zeitstempel. */
const MS_PER_DAY = 86_400_000;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Schaltjahr nach gregorianischem Kalender. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Anzahl Kalendertage eines Monats (`month` 0-basiert). */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 0 || month > 11) {
    throw new RangeError(`Ungültiger Monat (0–11): ${month}`);
  }
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Anzahl Kalendertage eines Jahres (365 / 366). */
export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/**
 * `true`, wenn `value` ein gültiger Kalendertag "YYYY-MM-DD" ist
 * (4-stelliges Jahr 0001–9999, real existierender Tag, z. B. kein 2026-02-29).
 */
export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== "string") return false;
  const m = DATE_KEY_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (year < 1 || month < 0 || month > 11 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** Zerlegt einen DateKey. Wirft `RangeError` bei ungültigem Wert. */
export function parseDateKey(key: DateKey): DateParts {
  if (!isDateKey(key)) throw new RangeError(`Ungültiger DateKey: ${String(key)}`);
  return {
    year: Number(key.slice(0, 4)),
    month: Number(key.slice(5, 7)) - 1,
    day: Number(key.slice(8, 10)),
  };
}

/**
 * Baut einen DateKey aus Jahr, 0-basiertem Monat und Tag.
 * Wirft `RangeError`, wenn der Tag nicht existiert (kein Überlauf wie bei `Date`).
 */
export function toDateKey(year: number, month: number, day: number): DateKey {
  const key = `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!Number.isInteger(year) || !Number.isInteger(day) || !isDateKey(key)) {
    throw new RangeError(`Ungültiges Datum: ${year}-${month + 1}-${day}`);
  }
  return key;
}

/** Fortlaufende Tagesnummer (Tage seit 1970-01-01, kalendarisch, TZ-frei). */
export function dayNumber(key: DateKey): number {
  const { year, month, day } = parseDateKey(key);
  const d = new Date(0);
  d.setUTCFullYear(year, month, day);
  return Math.round(d.getTime() / MS_PER_DAY);
}

/** Umkehrung von `dayNumber`. */
export function fromDayNumber(n: number): DateKey {
  if (!Number.isInteger(n)) throw new RangeError(`Tagesnummer muss ganzzahlig sein: ${n}`);
  const d = new Date(n * MS_PER_DAY);
  return toDateKey(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Kalendertag + `days` (negativ = zurück). DST-sicher, TZ-frei. */
export function addDays(key: DateKey, days: number): DateKey {
  return fromDayNumber(dayNumber(key) + days);
}

/** Anzahl Tage von `from` bis `to` (`to − from`; gleicher Tag = 0). */
export function diffDays(from: DateKey, to: DateKey): number {
  return dayNumber(to) - dayNumber(from);
}

/** Vergleich für `sort`: < 0, 0, > 0. Gültige DateKeys sind lexikografisch sortierbar. */
export function compareDateKeys(a: DateKey, b: DateKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** ISO-Wochentag: 1 = Montag … 7 = Sonntag. */
export function isoWeekday(key: DateKey): number {
  // 1970-01-01 war ein Donnerstag (ISO 4).
  const n = dayNumber(key);
  return ((((n + 3) % 7) + 7) % 7) + 1;
}

/** Tag im Jahr: 1 … 365/366. */
export function dayOfYear(key: DateKey): number {
  const { year } = parseDateKey(key);
  return diffDays(toDateKey(year, 0, 1), key) + 1;
}

/** `true`, wenn `key` im inklusiven Bereich liegt. */
export function rangeContains(range: DateRange, key: DateKey): boolean {
  return key >= range.start && key <= range.end;
}

/** Anzahl Tage im inklusiven Bereich (0, wenn `end < start`). */
export function rangeLength(range: DateRange): number {
  return Math.max(0, diffDays(range.start, range.end) + 1);
}

/**
 * Alle Kalendertage des inklusiven Bereichs in aufsteigender Reihenfolge.
 * Iteration über Tagesnummern (nicht über lokale Zeitstempel) → jeder Tag genau
 * einmal, auch über Zeitumstellungen hinweg. Leeres Array, wenn `end < start`.
 */
export function eachDateKey(range: DateRange): DateKey[] {
  const first = dayNumber(range.start);
  const last = dayNumber(range.end);
  const out: DateKey[] = [];
  for (let n = first; n <= last; n++) out.push(fromDayNumber(n));
  return out;
}

/** Schnittmenge zweier Bereiche oder `null`, wenn sie sich nicht überlappen. */
export function intersectRanges(a: DateRange, b: DateRange): DateRange | null {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  return start <= end ? { start, end } : null;
}
