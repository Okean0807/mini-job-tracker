/**
 * Perioden-Modell für die Statistik (Woche / Monat / Jahr) – reine Datumslogik.
 *
 * - Woche = ISO-Woche (Mo–So, ISO-Wochenjahr), siehe `iso-week.ts`.
 * - Monat = Kalendermonat, `month` 0-basiert (wie `shiftsInMonth`, `payPeriods`).
 * - Jahr  = Kalenderjahr.
 * - `start`/`end` sind inklusive DateKeys; Zugehörigkeit eines Eintrags wird
 *   ausschließlich über seinen DateKey (`Shift.date`) bestimmt – eine Nachtschicht
 *   So 22:00 → Mo 06:00 gehört vollständig zum Sonntag (wie überall in der App).
 * - Keine UI, kein Payroll, keine Zeitzone (siehe `date-key.ts`).
 *
 * Vergleichsregel (freigegeben): Ein laufender Zeitraum wird mit derselben
 * Anzahl bereits vergangener Tage des Vorzeitraums verglichen
 * (`comparisonWindow`).
 */
import {
  addDays,
  diffDays,
  eachDateKey,
  parseDateKey,
  rangeContains,
  rangeLength,
  toDateKey,
  daysInMonth,
  type DateKey,
  type DateRange,
} from "./date-key";
import {
  formatIsoWeekKey,
  isoWeekOf,
  isoWeekRange,
  parseIsoWeekKey,
  shiftIsoWeek,
} from "./iso-week";

export type PeriodType = "week" | "month" | "year";

export interface WeekPeriod extends DateRange {
  type: "week";
  /** ISO-Wochenjahr (kann vom Kalenderjahr von start/end abweichen). */
  isoYear: number;
  /** ISO-Wochennummer 1 … 52/53. */
  isoWeek: number;
}

export interface MonthPeriod extends DateRange {
  type: "month";
  year: number;
  /** 0 = Januar … 11 = Dezember */
  month: number;
}

export interface YearPeriod extends DateRange {
  type: "year";
  year: number;
}

/** Statistik-Zeitraum; `start`/`end` inklusive. */
export type Period = WeekPeriod | MonthPeriod | YearPeriod;

/** ISO-Woche (isoYear, isoWeek). Wirft `RangeError` bei nicht existierender Woche. */
export function weekPeriod(isoYear: number, isoWeek: number): WeekPeriod {
  const { start, end } = isoWeekRange(isoYear, isoWeek);
  return { type: "week", start, end, isoYear, isoWeek };
}

/** Kalendermonat (`month` 0-basiert). */
export function monthPeriod(year: number, month: number): MonthPeriod {
  return {
    type: "month",
    start: toDateKey(year, month, 1),
    end: toDateKey(year, month, daysInMonth(year, month)),
    year,
    month,
  };
}

/** Kalenderjahr. */
export function yearPeriod(year: number): YearPeriod {
  return { type: "year", start: toDateKey(year, 0, 1), end: toDateKey(year, 11, 31), year };
}

/** Zeitraum des gegebenen Typs, der `key` enthält (z. B. "heute"). */
export function periodContaining(type: "week", key: DateKey): WeekPeriod;
export function periodContaining(type: "month", key: DateKey): MonthPeriod;
export function periodContaining(type: "year", key: DateKey): YearPeriod;
export function periodContaining(type: PeriodType, key: DateKey): Period;
export function periodContaining(type: PeriodType, key: DateKey): Period {
  if (type === "week") {
    const w = isoWeekOf(key);
    return weekPeriod(w.isoYear, w.week);
  }
  const { year, month } = parseDateKey(key);
  return type === "month" ? monthPeriod(year, month) : yearPeriod(year);
}

/** Zeitraum gleichen Typs, um `delta` Einheiten verschoben (Woche/Monat/Jahr). */
export function shiftPeriod<P extends Period>(period: P, delta: number): P;
export function shiftPeriod(period: Period, delta: number): Period {
  if (!Number.isInteger(delta)) throw new RangeError(`delta muss ganzzahlig sein: ${delta}`);
  switch (period.type) {
    case "week": {
      const w = shiftIsoWeek({ isoYear: period.isoYear, week: period.isoWeek }, delta);
      return weekPeriod(w.isoYear, w.week);
    }
    case "month": {
      const index = period.year * 12 + period.month + delta;
      return monthPeriod(Math.floor(index / 12), ((index % 12) + 12) % 12);
    }
    case "year":
      return yearPeriod(period.year + delta);
  }
}

/** Vorheriger Zeitraum gleichen Typs (KW 1/2027 → KW 53/2026, Jan → Dez Vorjahr). */
export function prevPeriod<P extends Period>(period: P): P {
  return shiftPeriod(period, -1);
}

/** Nächster Zeitraum gleichen Typs. */
export function nextPeriod<P extends Period>(period: P): P {
  return shiftPeriod(period, 1);
}

/** `true`, wenn `key` im Zeitraum liegt (inklusive Grenzen). */
export function periodContains(period: Period, key: DateKey): boolean {
  return rangeContains(period, key);
}

/** Anzahl Kalendertage des Zeitraums (7 / 28–31 / 365–366). */
export function periodLength(period: Period): number {
  return rangeLength(period);
}

/** Alle Kalendertage des Zeitraums (kalendarische Iteration, DST-sicher). */
export function daysInPeriod(period: Period): DateKey[] {
  return eachDateKey(period);
}

/** Gleicher Zeitraum (Typ + Bereich). */
export function isSamePeriod(a: Period, b: Period): boolean {
  return a.type === b.type && a.start === b.start && a.end === b.end;
}

/**
 * Stabiler Schlüssel (z. B. für Memo/URL): `"2026-W53"`, `"2026-09"` (Monat
 * 1-basiert wie ISO 8601), `"2026"`.
 */
export function periodKey(period: Period): string {
  switch (period.type) {
    case "week":
      return formatIsoWeekKey({ isoYear: period.isoYear, week: period.isoWeek });
    case "month":
      return period.start.slice(0, 7);
    case "year":
      return period.start.slice(0, 4);
  }
}

/** Umkehrung von `periodKey`; `null` bei ungültigem Wert (kein Throw). */
export function parsePeriodKey(value: string): Period | null {
  const week = parseIsoWeekKey(value);
  if (week) return weekPeriod(week.isoYear, week.week);
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) {
    const year = Number(month[1]);
    const m = Number(month[2]) - 1;
    return year >= 1 && m >= 0 && m <= 11 ? monthPeriod(year, m) : null;
  }
  const year = /^(\d{4})$/.exec(value);
  if (year && Number(year[1]) >= 1) return yearPeriod(Number(year[1]));
  return null;
}

/* ------------------------- Laufender Zeitraum / Vergleich ------------------------- */

/**
 * Anzahl der bis einschließlich `today` vergangenen Tage des Zeitraums:
 * 0 (Zeitraum beginnt nach heute) … `periodLength` (Zeitraum abgeschlossen).
 */
export function elapsedDays(period: Period, today: DateKey): number {
  if (today < period.start) return 0;
  if (today > period.end) return periodLength(period);
  return diffDays(period.start, today) + 1;
}

/**
 * Bereits vergangener Teil des Zeitraums (`start` … min(today, end)),
 * `null`, wenn der Zeitraum erst nach `today` beginnt.
 */
export function elapsedRange(period: Period, today: DateKey): DateRange | null {
  const n = elapsedDays(period, today);
  return n === 0 ? null : { start: period.start, end: addDays(period.start, n - 1) };
}

/** Status eines Zeitraums relativ zu `today`. */
export type PeriodStatus = "past" | "running" | "future";

export function periodStatus(period: Period, today: DateKey): PeriodStatus {
  if (today > period.end) return "past";
  if (today < period.start) return "future";
  return "running";
}

export interface ComparisonWindow {
  /** Status des aktuellen Zeitraums relativ zu `today`. */
  status: PeriodStatus;
  /** Vergleichsbereich im aktuellen Zeitraum; `null` bei `status = "future"`. */
  current: DateRange | null;
  /** Vorzeitraum gleichen Typs (immer gesetzt, z. B. für Beschriftungen). */
  previousPeriod: Period;
  /** Gleich langer Bereich ab Beginn des Vorzeitraums; `null` bei `status = "future"`. */
  previous: DateRange | null;
  /** Anzahl verglichener Tage im aktuellen Zeitraum. */
  days: number;
  /** Anzahl verglichener Tage im Vorzeitraum (kann wegen Kappung kleiner sein). */
  previousDays: number;
  /**
   * `true`, wenn der Vorzeitraum kürzer ist als die vergangenen Tage des
   * aktuellen (z. B. 31.03. vs. Februar, 31.12.2028 vs. 2027) und auf seine
   * volle Länge gekappt wurde.
   */
  clamped: boolean;
}

/**
 * Vergleichsfenster nach der freigegebenen Regel "gleiche Anzahl vergangener
 * Tage":
 * - abgeschlossener Zeitraum (`past`): kompletter Zeitraum vs. kompletter Vorzeitraum;
 * - laufender Zeitraum (`running`): `start … today` vs. die ersten N Tage des
 *   Vorzeitraums (N = vergangene Tage, gekappt auf die Länge des Vorzeitraums);
 * - zukünftiger Zeitraum (`future`): kein Vergleich (`current`/`previous` = null).
 *
 * Beispiel (today 04.10.2026): Okt 2026 → 01.–04.10. vs. 01.–04.09.;
 * KW 40/2026 (28.09.–04.10.) ist am Sonntag 04.10. vollständig vergangen → 7 vs. 7 Tage.
 *
 * Bei `past` werden Vorzeitraum-Längen nicht angeglichen (z. B. März 31 Tage
 * vs. Februar 28 Tage) – das ist der normale Periodenvergleich.
 */
export function comparisonWindow(period: Period, today: DateKey): ComparisonWindow {
  const previousPeriod = prevPeriod(period);
  const status = periodStatus(period, today);
  if (status === "future") {
    return {
      status,
      current: null,
      previousPeriod,
      previous: null,
      days: 0,
      previousDays: 0,
      clamped: false,
    };
  }
  if (status === "past") {
    return {
      status,
      current: { start: period.start, end: period.end },
      previousPeriod,
      previous: { start: previousPeriod.start, end: previousPeriod.end },
      days: periodLength(period),
      previousDays: periodLength(previousPeriod),
      clamped: false,
    };
  }
  const days = elapsedDays(period, today);
  const prevLength = periodLength(previousPeriod);
  const previousDays = Math.min(days, prevLength);
  return {
    status,
    current: { start: period.start, end: addDays(period.start, days - 1) },
    previousPeriod,
    previous: { start: previousPeriod.start, end: addDays(previousPeriod.start, previousDays - 1) },
    days,
    previousDays,
    clamped: previousDays < days,
  };
}

/**
 * Teil-Zeiträume eines Bereichs, jeweils auf den Bereich zugeschnitten
 * (z. B. Monat → ISO-Wochen, Jahr → Monate oder Wochen). Wochen am Rand werden
 * auf den Bereich gekappt (`clipped`), damit die Summe der Teile dem Bereich
 * entspricht. Für ungeschnittene Wochen `period` statt `clipped` verwenden.
 */
export interface SubPeriod {
  period: Period;
  /** Schnitt von `period` mit dem angefragten Bereich. */
  clipped: DateRange;
  /** `true`, wenn `period` über den Bereich hinausragt. */
  partial: boolean;
}

export function subPeriods(range: DateRange, type: PeriodType): SubPeriod[] {
  const out: SubPeriod[] = [];
  if (range.end < range.start) return out;
  let current: Period = periodContaining(type, range.start);
  while (current.start <= range.end) {
    const start = current.start > range.start ? current.start : range.start;
    const end = current.end < range.end ? current.end : range.end;
    out.push({
      period: current,
      clipped: { start, end },
      partial: start !== current.start || end !== current.end,
    });
    current = nextPeriod(current);
  }
  return out;
}
