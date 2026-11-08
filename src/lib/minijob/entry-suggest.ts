/**
 * Vorschläge für den Eintrags-Editor (Paket A).
 *
 * Reine Funktionen über dem gespeicherten Bestand: sie LESEN Schichten und schreiben nie.
 * Gespeicherte Einträge bleiben unverändert. Der Editor übernimmt einen Vorschlag nur in ein
 * unberührtes Feld oder auf eine ausdrückliche Aktion ("Letzten Eintrag übernehmen").
 *
 * Zeitachse: `Shift.date` ist das BEGINN-Datum. Liegt `end` vor `start`, endet der Eintrag am
 * Folgetag (dieselbe Regel wie `calc.shiftHours`, damit Vorschlag und Berechnung nie auseinanderlaufen).
 */
import { toMinutes } from "./calc";
import { normalizeTaskCompare } from "./catalog";
import type { Shift, WorkObject } from "./types";
import { applyObjectToFormFields } from "./work-objects";

export const DAY_MINUTES = 24 * 60;
const MS_PER_DAY = 86_400_000;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Gültige Uhrzeit HH:mm? Leere oder kaputte Werte dürfen nie zu einem Vorschlag führen. */
export function isTimeValue(value: string | undefined | null): boolean {
  return typeof value === "string" && TIME_RE.test(value.trim());
}

/** Tagesindex einer ISO-Datumsangabe (yyyy-MM-dd); reine Arithmetik, keine Zeitzone. */
export function dayIndex(iso: string): number {
  const [y, m, d] = (iso ?? "").split("-").map(Number);
  if (!y || !m || !d) return Number.NaN;
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** Umkehrung von `dayIndex`. */
export function isoFromDayIndex(index: number): string {
  const date = new Date(index * MS_PER_DAY);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function minutesToTime(minutes: number): string {
  const normalized = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Ende in Minuten seit Mitternacht des Eintragsdatums (über Mitternacht: > 1440). */
export function shiftEndMinutes(shift: Pick<Shift, "start" | "end">): number {
  const start = toMinutes(shift.start);
  const end = toMinutes(shift.end);
  // end === start ist Dauer 0 (wie shiftHours) und NICHT 24 h.
  return end < start ? end + DAY_MINUTES : end;
}

/** Absolutes Intervall auf einer gemeinsamen Minutenachse (tagesübergreifend vergleichbar). */
export function absoluteRange(shift: Pick<Shift, "date" | "start" | "end">): {
  from: number;
  to: number;
} {
  const base = dayIndex(shift.date) * DAY_MINUTES;
  return { from: base + toMinutes(shift.start), to: base + shiftEndMinutes(shift) };
}

type JobScoped = Pick<Shift, "jobId">;

/** Gleicher Job – ein Eintrag ohne Job gehört zu "kein Job", nicht zu jedem Job. */
function sameJob(shift: JobScoped, jobId: string | undefined): boolean {
  return (shift.jobId ?? "") === (jobId ?? "");
}

function isUsableWork(shift: Shift, jobId: string | undefined, excludeId?: string): boolean {
  if (shift.kind !== "arbeit") return false;
  if (excludeId && shift.id === excludeId) return false;
  if (!sameJob(shift, jobId)) return false;
  return isTimeValue(shift.start) && isTimeValue(shift.end);
}

/* ------------------------------------------------------------------ A1: Zeit-Anschluss */

export interface ContinuationSuggestion {
  /** Vorgeschlagener Beginn (HH:mm). */
  start: string;
  /** Datum, auf das dieser Beginn fällt: der angefragte Tag oder der Folgetag. */
  date: string;
  /** Nur bei `true` darf der Editor den Beginn automatisch setzen. */
  sameDay: boolean;
  sourceId: string;
  sourceStart: string;
  sourceEnd: string;
}

/**
 * Chronologisch letztes Ende der Arbeitseinträge DIESES Jobs, die auf `date` enden.
 * Berücksichtigt auch einen Eintrag des Vortags, der über Mitternacht in `date` hineinreicht.
 *
 * Endet der letzte Eintrag erst nach Mitternacht, fällt der Anschluss auf den Folgetag:
 * dann `sameDay: false` – der Editor schlägt ihn nur als ausdrücklich antippbare Aktion vor,
 * weil sonst das Eintragsdatum still wechseln würde.
 *
 * Weil das MAXIMALE Ende gewählt wird, kann der neue Eintrag keinen bestehenden Eintrag
 * desselben Jobs überschneiden (alle anderen enden früher).
 */
export function continuationStart(
  shifts: readonly Shift[],
  args: { jobId?: string; date: string; excludeId?: string },
): ContinuationSuggestion | null {
  const target = dayIndex(args.date);
  if (!Number.isFinite(target)) return null;
  let best: { shift: Shift; endAbs: number; startAbs: number } | null = null;
  for (const shift of shifts) {
    if (!isUsableWork(shift, args.jobId, args.excludeId)) continue;
    const index = dayIndex(shift.date);
    if (!Number.isFinite(index)) continue;
    let endAbs: number;
    if (index === target) {
      endAbs = shiftEndMinutes(shift);
    } else if (index === target - 1 && toMinutes(shift.end) < toMinutes(shift.start)) {
      // Eintrag des Vortags, der über Mitternacht reicht: sein Ende liegt auf `date`.
      endAbs = toMinutes(shift.end);
    } else {
      continue;
    }
    const startAbs =
      index === target ? toMinutes(shift.start) : toMinutes(shift.start) - DAY_MINUTES;
    if (
      !best ||
      endAbs > best.endAbs ||
      (endAbs === best.endAbs &&
        (startAbs > best.startAbs || (startAbs === best.startAbs && shift.id > best.shift.id)))
    ) {
      best = { shift, endAbs, startAbs };
    }
  }
  if (!best) return null;
  const sameDay = best.endAbs < DAY_MINUTES;
  return {
    start: minutesToTime(best.endAbs),
    date: sameDay ? args.date : isoFromDayIndex(target + 1),
    sameDay,
    sourceId: best.shift.id,
    sourceStart: best.shift.start,
    sourceEnd: best.shift.end,
  };
}

/* ------------------------------------------- A3/A4: letzter Eintrag und Tätigkeiten je Job */

/** Zuletzt gespeicherter Arbeitseintrag dieses Jobs (nach Datum, dann Ende). */
export function lastJobEntry(
  shifts: readonly Shift[],
  args: { jobId?: string; excludeId?: string },
): Shift | null {
  let best: { shift: Shift; key: number } | null = null;
  for (const shift of shifts) {
    if (!isUsableWork(shift, args.jobId, args.excludeId)) continue;
    const index = dayIndex(shift.date);
    if (!Number.isFinite(index)) continue;
    const key = index * DAY_MINUTES + shiftEndMinutes(shift);
    if (!best || key > best.key || (key === best.key && shift.id > best.shift.id)) {
      best = { shift, key };
    }
  }
  return best?.shift ?? null;
}

/**
 * Nicht-zeitliche Werte des letzten Eintrags. **Ohne** `rate`, `note`, `photos`, `gps`,
 * `overtime`, `sickCaseId`, `id` und `date`: Lohn gilt stichtagsbezogen (`suggestedRate`),
 * alles andere ist eintragsspezifisch.
 */
export interface LastJobValues {
  sourceId: string;
  sourceDate: string;
  objectId?: string;
  workplace?: string;
  street?: string;
  houseNo?: string;
  zip?: string;
  city?: string;
  floor?: string;
  doorSide?: string;
  workCode?: string;
  workCodeLabel?: string;
  workCodeNote?: string;
  tasks: string[];
  breakMinutes: number;
  customerId?: string;
  projectId?: string;
}

function valuesOf(shift: Shift): LastJobValues {
  const out: LastJobValues = {
    sourceId: shift.id,
    sourceDate: shift.date,
    tasks: [...(shift.tasks ?? [])],
    breakMinutes: Math.max(0, shift.breakMinutes || 0),
  };
  if (shift.objectId) out.objectId = shift.objectId;
  if (shift.workplace) out.workplace = shift.workplace;
  if (shift.street) out.street = shift.street;
  if (shift.houseNo) out.houseNo = shift.houseNo;
  if (shift.zip) out.zip = shift.zip;
  if (shift.city) out.city = shift.city;
  if (shift.floor) out.floor = shift.floor;
  if (shift.doorSide) out.doorSide = shift.doorSide;
  if (shift.workCode) out.workCode = shift.workCode;
  if (shift.workCodeLabel) out.workCodeLabel = shift.workCodeLabel;
  if (shift.workCodeNote) out.workCodeNote = shift.workCodeNote;
  if (shift.customerId) out.customerId = shift.customerId;
  if (shift.projectId) out.projectId = shift.projectId;
  return out;
}

export function lastJobValues(
  shifts: readonly Shift[],
  args: { jobId?: string; excludeId?: string },
): LastJobValues | null {
  const shift = lastJobEntry(shifts, args);
  return shift ? valuesOf(shift) : null;
}

/**
 * A4 "Letzten Eintrag übernehmen": wie `lastJobValues`, aber die Adresse kommt aus dem
 * HEUTE gespeicherten Objekt, falls die Verknüpfung noch existiert. Ein umgezogenes Objekt
 * wird so nicht mit einer veralteten Adresse kopiert; der historische Eintrag selbst bleibt
 * unverändert (er behält seinen eigenen Adress-Schnappschuss).
 */
export function repeatPayload(args: {
  shifts: readonly Shift[];
  objects?: readonly WorkObject[];
  jobId?: string;
  excludeId?: string;
}): LastJobValues | null {
  const base = lastJobValues(args.shifts, {
    ...(args.jobId !== undefined ? { jobId: args.jobId } : {}),
    ...(args.excludeId ? { excludeId: args.excludeId } : {}),
  });
  if (!base) return null;
  const live = base.objectId ? (args.objects ?? []).find((o) => o.id === base.objectId) : undefined;
  if (!live) return base;
  const fields = applyObjectToFormFields(live);
  return {
    ...base,
    objectId: fields.objectId,
    workplace: fields.workplace,
    street: fields.street,
    houseNo: fields.houseNo,
    floor: fields.floor,
    doorSide: fields.doorSide,
    zip: fields.zip,
    city: fields.city,
  };
}

export interface TaskSuggestionGroups {
  /** Tätigkeiten des letzten Eintrags dieses Jobs. */
  last: string[];
  /** Häufig genutzte Tätigkeiten dieses Jobs (ohne die aus `last`). */
  frequent: string[];
}

/**
 * A3: Tätigkeits-Vorschläge aus der Historie DIESES Jobs. Nichts wird erzwungen und nichts
 * gespeichert; der eigene Katalog (`settings.customTasks`) wird vom Editor ergänzt.
 * Dubletten werden über `normalizeTaskCompare` entfernt, Vorlagen ("#key") bleiben erhalten.
 */
export function taskSuggestionsFromHistory(args: {
  shifts: readonly Shift[];
  jobId?: string;
  exclude?: readonly string[];
  excludeId?: string;
  limit?: number;
}): TaskSuggestionGroups {
  const limit = args.limit ?? 6;
  const seen = new Set<string>();
  for (const value of args.exclude ?? []) seen.add(normalizeTaskCompare(value));

  const lastEntry = lastJobEntry(args.shifts, {
    ...(args.jobId !== undefined ? { jobId: args.jobId } : {}),
    ...(args.excludeId ? { excludeId: args.excludeId } : {}),
  });
  const last: string[] = [];
  for (const value of lastEntry?.tasks ?? []) {
    const key = normalizeTaskCompare(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    last.push(value);
  }

  // Häufigkeit über alle Arbeitseinträge des Jobs; bei Gleichstand gewinnt der jüngere Eintrag.
  const counts = new Map<string, { value: string; count: number; recency: number }>();
  for (const shift of args.shifts) {
    if (!isUsableWork(shift, args.jobId, args.excludeId)) continue;
    const index = dayIndex(shift.date);
    const recency = Number.isFinite(index) ? index : 0;
    for (const value of shift.tasks ?? []) {
      const key = normalizeTaskCompare(value);
      if (!key) continue;
      const hit = counts.get(key);
      if (hit) {
        hit.count += 1;
        if (recency > hit.recency) {
          hit.recency = recency;
          hit.value = value;
        }
      } else {
        counts.set(key, { value, count: 1, recency });
      }
    }
  }
  const frequent = [...counts.entries()]
    .filter(([key]) => !seen.has(key))
    .sort((a, b) => b[1].count - a[1].count || b[1].recency - a[1].recency)
    .slice(0, limit)
    .map(([, hit]) => hit.value);

  return { last, frequent };
}
