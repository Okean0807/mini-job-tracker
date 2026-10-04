/**
 * Generische, reine Aggregation bereits berechneter Werte nach Tag, Teil-Zeitraum
 * und Gruppe (Job, Objekt …) – Grundlage für Statistik S4/S5.
 *
 * WICHTIG: Dieses Modul rechnet KEIN Entgelt und KEINE Stunden aus Schichten.
 * Es summiert nur Zahlen, die der Aufrufer liefert (`getValues`), z. B. die
 * pro Schicht einmal berechneten `shiftPayroll`-Ergebnisse aus
 * `period-payroll.ts`. Damit gibt es keine zweite Payroll-Formel.
 *
 * Regeln:
 * - Zuordnung eines Eintrags ausschließlich über seinen DateKey (`getDateKey`,
 *   i. d. R. `shift.date`). Einträge außerhalb des Bereichs werden ignoriert.
 * - Geplante (zukünftige) Einträge werden NICHT verworfen. Optional (`today`)
 *   werden sie zusätzlich separat ausgewiesen (`planned`), z. B. für
 *   "inkl. geplanter Einträge" oder "bis heute"-Ansichten.
 * - Summen werden ungerundet gebildet; Runden nur bei der Anzeige.
 * - Leere Bereiche/Gruppen liefern Nullwerte für alle `fields` (nie NaN).
 */
import { eachDateKey, type DateKey, type DateRange } from "./date-key";
import { subPeriods, type Period, type PeriodType } from "./period";
import type { Shift } from "./types";

/** Summen je Feld. */
export type Values<K extends string> = Record<K, number>;

export interface Bucket<K extends string> {
  /** Anzahl berücksichtigter Einträge. */
  count: number;
  /** Ungerundete Summen je Feld. */
  values: Values<K>;
  /**
   * Nur gesetzt, wenn `today` übergeben wurde: Anteil der Einträge mit
   * DateKey > today (geplant/zukünftig). Bereits in `count`/`values` enthalten.
   */
  planned?: { count: number; values: Values<K> };
}

export interface DayBucket<K extends string> extends Bucket<K> {
  date: DateKey;
}

export interface PeriodBucket<K extends string> extends Bucket<K> {
  /** Vollständiger Teil-Zeitraum (z. B. ganze ISO-Woche). */
  period: Period;
  /** Auf den angefragten Bereich gekappter Teil, über den summiert wurde. */
  range: DateRange;
  /** `true`, wenn `period` über den angefragten Bereich hinausragt. */
  partial: boolean;
}

export interface GroupBucket<K extends string> extends Bucket<K> {
  key: string;
}

export interface AggregateOptions<T, K extends string> {
  /** Kalendertag des Eintrags ("YYYY-MM-DD"), i. d. R. `shift.date`. */
  getDateKey: (item: T) => DateKey;
  /** Bereits berechnete Zahlen des Eintrags (kein Payroll im Aggregator). */
  getValues: (item: T) => Partial<Values<K>>;
  /** Alle Felder, die summiert werden (bestimmt auch die Nullwerte). */
  fields: readonly K[];
  /** Optional: "heute" – Einträge danach zusätzlich als `planned` ausweisen. */
  today?: DateKey;
}

/** Nullwerte für alle Felder. */
export function emptyValues<K extends string>(fields: readonly K[]): Values<K> {
  const out = {} as Values<K>;
  for (const f of fields) out[f] = 0;
  return out;
}

function emptyBucket<K extends string>(fields: readonly K[], withPlanned: boolean): Bucket<K> {
  const bucket: Bucket<K> = { count: 0, values: emptyValues(fields) };
  if (withPlanned) bucket.planned = { count: 0, values: emptyValues(fields) };
  return bucket;
}

function addInto<K extends string>(
  target: { count: number; values: Values<K> },
  values: Partial<Values<K>>,
  fields: readonly K[],
): void {
  target.count += 1;
  for (const f of fields) {
    const v = values[f];
    if (typeof v === "number" && Number.isFinite(v)) target.values[f] += v;
  }
}

function addItem<T, K extends string>(
  bucket: Bucket<K>,
  item: T,
  date: DateKey,
  opts: AggregateOptions<T, K>,
): void {
  const values = opts.getValues(item);
  addInto(bucket, values, opts.fields);
  if (bucket.planned && opts.today !== undefined && date > opts.today) {
    addInto(bucket.planned, values, opts.fields);
  }
}

/** Summe aller Einträge ohne Datumsfilter (z. B. bereits gefilterte Liste). */
export function sumValues<T, K extends string>(
  items: readonly T[],
  opts: AggregateOptions<T, K>,
): Bucket<K> {
  const bucket = emptyBucket(opts.fields, opts.today !== undefined);
  for (const item of items) addItem(bucket, item, opts.getDateKey(item), opts);
  return bucket;
}

/** Summe aller Einträge mit DateKey im inklusiven Bereich. */
export function aggregateRange<T, K extends string>(
  range: DateRange,
  items: readonly T[],
  opts: AggregateOptions<T, K>,
): Bucket<K> {
  const bucket = emptyBucket(opts.fields, opts.today !== undefined);
  for (const item of items) {
    const date = opts.getDateKey(item);
    if (date >= range.start && date <= range.end) addItem(bucket, item, date, opts);
  }
  return bucket;
}

/**
 * Ein Bucket pro Kalendertag des Bereichs (lückenlos, auch Tage ohne Einträge).
 * Mehrere Einträge am selben Tag werden summiert.
 */
export function bucketByDay<T, K extends string>(
  range: DateRange,
  items: readonly T[],
  opts: AggregateOptions<T, K>,
): DayBucket<K>[] {
  const withPlanned = opts.today !== undefined;
  const days = eachDateKey(range).map((date): DayBucket<K> => ({
    date,
    ...emptyBucket(opts.fields, withPlanned),
  }));
  const index = new Map(days.map((d, i) => [d.date, i]));
  for (const item of items) {
    const date = opts.getDateKey(item);
    const i = index.get(date);
    if (i !== undefined) addItem(days[i]!, item, date, opts);
  }
  return days;
}

/**
 * Ein Bucket pro Teil-Zeitraum (`type`) des Bereichs, auf den Bereich gekappt
 * (z. B. Monat → ISO-Wochen, Jahr → Monate). Σ Buckets = `aggregateRange(range)`.
 * Für ungekappte Wochen `aggregateRange(bucket.period, …)` verwenden.
 */
export function bucketBySubPeriod<T, K extends string>(
  range: DateRange,
  type: PeriodType,
  items: readonly T[],
  opts: AggregateOptions<T, K>,
): PeriodBucket<K>[] {
  const withPlanned = opts.today !== undefined;
  const buckets = subPeriods(range, type).map((sp): PeriodBucket<K> => ({
    period: sp.period,
    range: sp.clipped,
    partial: sp.partial,
    ...emptyBucket(opts.fields, withPlanned),
  }));
  for (const item of items) {
    const date = opts.getDateKey(item);
    if (date < range.start || date > range.end) continue;
    // Teil-Zeiträume sind aufsteigend und lückenlos → binäre Suche.
    let lo = 0;
    let hi = buckets.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const b = buckets[mid]!;
      if (date < b.range.start) hi = mid - 1;
      else if (date > b.range.end) lo = mid + 1;
      else {
        addItem(b, item, date, opts);
        break;
      }
    }
  }
  return buckets;
}

/**
 * Gruppierung nach beliebigem Schlüssel (Job, Objekt, Kunde …). Reihenfolge =
 * erstes Auftreten. Fehlende Zuordnung muss der Aufrufer auf einen eigenen
 * Schlüssel abbilden (z. B. `shift.objectId ?? "none"`), damit
 * Σ Gruppen = Gesamtsumme bleibt. Optional nur Einträge im `range`.
 */
export function groupBy<T, K extends string>(
  items: readonly T[],
  getGroupKey: (item: T) => string,
  opts: AggregateOptions<T, K> & { range?: DateRange },
): GroupBucket<K>[] {
  const withPlanned = opts.today !== undefined;
  const groups = new Map<string, GroupBucket<K>>();
  for (const item of items) {
    const date = opts.getDateKey(item);
    if (opts.range && (date < opts.range.start || date > opts.range.end)) continue;
    const key = getGroupKey(item);
    let g = groups.get(key);
    if (!g) {
      g = { key, ...emptyBucket(opts.fields, withPlanned) };
      groups.set(key, g);
    }
    addItem(g, item, date, opts);
  }
  return [...groups.values()];
}

/**
 * Anzahl verschiedener Kalendertage mit mindestens einem Eintrag
 * `kind === "arbeit"` (freigegeben: Abwesenheiten sind keine Arbeitstage).
 * Optional nur innerhalb von `range`. Geplante Einträge zählen mit; für
 * "bis heute" den Bereich entsprechend begrenzen (`elapsedRange`).
 */
export function countWorkDays(
  shifts: readonly Pick<Shift, "date" | "kind">[],
  range?: DateRange,
): number {
  const days = new Set<DateKey>();
  for (const s of shifts) {
    if (s.kind !== "arbeit") continue;
    if (range && (s.date < range.start || s.date > range.end)) continue;
    days.add(s.date);
  }
  return days.size;
}

export interface ValueComparison {
  current: number;
  previous: number;
  /** current − previous */
  delta: number;
  /**
   * Relative Änderung in Prozent (z. B. 23.68 für +23,68 %).
   * `null`, wenn `previous === 0` (kein sinnvoller Prozentwert, nie ±Infinity/NaN).
   */
  percent: number | null;
}

/** Absolute und relative Veränderung zweier Summen. */
export function compareValues(current: number, previous: number): ValueComparison {
  const delta = current - previous;
  const percent = previous === 0 ? null : (delta / Math.abs(previous)) * 100;
  return { current, previous, delta, percent };
}
