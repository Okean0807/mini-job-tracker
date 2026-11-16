/**
 * B3: Reine Logik für den Einsatzort-Picker (Letzter / Häufig / Alle, Suche nach Name).
 * Liest nur Bestand und Objektkatalog; nichts wird gesetzt oder gespeichert. Gruppiert wird
 * ausschließlich über Objekt-IDs, die im Katalog (`objects`) noch existieren – ein Eintrag mit
 * einer fehlenden `objectId` bleibt unberührt (sein Adress-Schnappschuss gehört dem Eintrag).
 */
import { dayIndex, DAY_MINUTES, isTimeValue, shiftEndMinutes } from "./entry-suggest";
import type { Shift, WorkObject } from "./types";

export interface ObjectUsage {
  /** Zuletzt genutztes Objekt dieses Jobs (ID), falls es im Katalog noch existiert. */
  last: string | null;
  /** Häufig genutzte Objekte dieses Jobs (IDs, ohne `last`), meistgenutzt zuerst. */
  frequent: string[];
}

export const FREQUENT_MIN_COUNT = 2;
export const FREQUENT_LIMIT = 5;

export function objectUsageFromHistory(args: {
  shifts: readonly Shift[];
  objects: readonly WorkObject[];
  jobId?: string;
  excludeId?: string;
}): ObjectUsage {
  const known = new Set(args.objects.map((o) => o.id));
  const stats = new Map<string, { count: number; recent: number }>();
  let last: { id: string; key: number } | null = null;
  for (const shift of args.shifts) {
    if (shift.kind !== "arbeit") continue;
    if (args.excludeId && shift.id === args.excludeId) continue;
    if ((shift.jobId ?? "") !== (args.jobId ?? "")) continue;
    if (!shift.objectId || !known.has(shift.objectId)) continue;
    if (!isTimeValue(shift.start) || !isTimeValue(shift.end)) continue;
    const index = dayIndex(shift.date);
    if (!Number.isFinite(index)) continue;
    const key = index * DAY_MINUTES + shiftEndMinutes(shift);
    const entry = stats.get(shift.objectId) ?? { count: 0, recent: Number.NEGATIVE_INFINITY };
    entry.count += 1;
    entry.recent = Math.max(entry.recent, key);
    stats.set(shift.objectId, entry);
    if (!last || key > last.key) last = { id: shift.objectId, key };
  }
  const frequent = [...stats.entries()]
    .filter(([id, s]) => id !== last?.id && s.count >= FREQUENT_MIN_COUNT)
    .sort(
      (a, b) => b[1].count - a[1].count || b[1].recent - a[1].recent || a[0].localeCompare(b[0]),
    )
    .slice(0, FREQUENT_LIMIT)
    .map(([id]) => id);
  return { last: last?.id ?? null, frequent };
}

/** Kleinschreibung ohne Akzente, damit "Bürohaus" auch mit "buro" gefunden wird. */
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export interface ObjectPickerGroups {
  last: WorkObject | null;
  frequent: WorkObject[];
  all: WorkObject[];
  /** Flache Reihenfolge für die Tastatur: Letzter, Häufig, Alle. */
  flat: WorkObject[];
}

export function groupObjectsForPicker(args: {
  objects: readonly WorkObject[];
  usage: ObjectUsage;
  query?: string;
}): ObjectPickerGroups {
  const needle = normalizeSearch(args.query ?? "");
  const matches = (o: WorkObject) => !needle || normalizeSearch(o.name ?? "").includes(needle);
  const byId = new Map(args.objects.map((o) => [o.id, o]));
  const lastObj = args.usage.last ? (byId.get(args.usage.last) ?? null) : null;
  const last = lastObj && matches(lastObj) ? lastObj : null;
  const frequent = args.usage.frequent
    .map((id) => byId.get(id))
    .filter((o): o is WorkObject => Boolean(o) && o!.id !== lastObj?.id && matches(o!));
  const shown = new Set<string>([...(last ? [last.id] : []), ...frequent.map((o) => o.id)]);
  // Ein wegen der Suche ausgeblendetes Objekt aus Gruppe 1/2 gehört nicht in "Alle".
  const grouped = new Set<string>([...(lastObj ? [lastObj.id] : []), ...args.usage.frequent]);
  const all = args.objects
    .filter((o) => !shown.has(o.id) && !grouped.has(o.id) && matches(o))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "de"));
  return { last, frequent, all, flat: [...(last ? [last] : []), ...frequent, ...all] };
}
