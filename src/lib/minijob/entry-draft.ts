/**
 * B6: Entwurf eines NEUEN, unvollständigen Arbeitseintrags im Editor.
 *
 * Speicherort: ein Schlüssel pro Namensraum, `minijob-entry-draft-v1:<scope>` (siehe
 * `storage-scope.ts`). Das Scope-Suffix steht am ENDE des Schlüssels – genau darauf stützt sich
 * `clearUserScopeLocalData` (Kontolöschung), damit Entwürfe mit dem Konto verschwinden, ohne dass
 * ein zweites Schlüsselverzeichnis gepflegt wird. Innerhalb des Schlüssels ist der Entwurf nach
 * Job getrennt (höchstens ein Entwurf je Konto und Job).
 *
 * Ein Entwurf ist NIE ein gespeicherter Eintrag: er steht nicht in `shifts`, hat keine Id, wird
 * nicht synchronisiert und enthält weder Fotos noch GPS noch Berechnetes (Verdienst, Summen,
 * Bewertungen). Veraltete, beschädigte oder fremde Daten werden verworfen, nie angewendet.
 */
import { isTimeValue } from "./entry-suggest";
import { scopedKey, type StorageScope } from "./storage-scope";
import { getActiveScope } from "./store";

export const ENTRY_DRAFT_KEY = "minijob-entry-draft-v1";
export const ENTRY_DRAFT_VERSION = 1;
/** Ein Entwurf, der so lange unberührt blieb, gilt als veraltet. */
export const ENTRY_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TEXT = 2000;
const MAX_TASKS = 50;
const NO_JOB_KEY = "~none";

export interface EntryDraftFields {
  date: string;
  start: string;
  end: string;
  /** Wurde Beginn/Ende von der Nutzerin gesetzt (dann überschreibt kein Vorschlag es). */
  startTouched: boolean;
  endTouched: boolean;
  breakMinutes: string;
  /** Nur ein ausdrücklich getippter Lohn; sonst wird er beim Öffnen neu vorgeschlagen. */
  rate?: string;
  note?: string;
  overtime?: boolean;
  customerId?: string;
  projectId?: string;
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
  customTask?: string;
}

interface StoredDraft {
  savedAt: number;
  fields: EntryDraftFields;
}

interface DraftFile {
  v: number;
  drafts: Record<string, StoredDraft>;
}

export function entryDraftStorageKey(scope: StorageScope = getActiveScope()): string {
  return scopedKey(ENTRY_DRAFT_KEY, scope);
}

function jobKey(jobId: string | undefined): string {
  return jobId ? `j:${jobId}` : NO_JOB_KEY;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, MAX_TEXT) : undefined;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function timeOrEmpty(value: unknown): string | null {
  if (value === "") return "";
  return typeof value === "string" && isTimeValue(value) ? value : null;
}

/** Streng prüfen: jedes Feld einzeln; ein unbrauchbares Pflichtfeld verwirft den ganzen Entwurf. */
export function normalizeEntryDraftFields(raw: unknown): EntryDraftFields | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isIsoDate(o["date"])) return null;
  const start = timeOrEmpty(o["start"]);
  const end = timeOrEmpty(o["end"]);
  if (start === null || end === null) return null;
  const breakRaw = o["breakMinutes"];
  const breakNum = typeof breakRaw === "string" && breakRaw.trim() !== "" ? Number(breakRaw) : NaN;
  const breakMinutes =
    Number.isFinite(breakNum) && breakNum >= 0 && breakNum <= 24 * 60 ? String(breakNum) : "30";
  const tasks = Array.isArray(o["tasks"])
    ? o["tasks"]
        .filter((t): t is string => typeof t === "string" && t.length > 0)
        .slice(0, MAX_TASKS)
        .map((t) => t.slice(0, MAX_TEXT))
    : [];
  const out: EntryDraftFields = {
    date: o["date"],
    start,
    end,
    startTouched: o["startTouched"] === true,
    endTouched: o["endTouched"] === true,
    breakMinutes,
    tasks,
  };
  const optional = [
    "rate",
    "note",
    "customerId",
    "projectId",
    "objectId",
    "workplace",
    "street",
    "houseNo",
    "zip",
    "city",
    "floor",
    "doorSide",
    "workCode",
    "workCodeLabel",
    "workCodeNote",
    "customTask",
  ] as const;
  for (const key of optional) {
    const value = text(o[key]);
    if (value !== undefined) out[key] = value;
  }
  if (o["overtime"] === true) out.overtime = true;
  return out;
}

function readFile(key: string, now: number): DraftFile {
  const empty: DraftFile = { v: ENTRY_DRAFT_VERSION, drafts: {} };
  if (typeof window === "undefined") return empty;
  try {
    const rawText = window.localStorage.getItem(key);
    if (!rawText) return empty;
    const parsed = JSON.parse(rawText) as unknown;
    if (!parsed || typeof parsed !== "object") return empty;
    const file = parsed as Record<string, unknown>;
    if (file["v"] !== ENTRY_DRAFT_VERSION) return empty; // andere Fassung: nicht anwenden
    const drafts = file["drafts"];
    if (!drafts || typeof drafts !== "object") return empty;
    const out: DraftFile = { v: ENTRY_DRAFT_VERSION, drafts: {} };
    for (const [k, value] of Object.entries(drafts as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      const savedAt = entry["savedAt"];
      if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) continue;
      if (now - savedAt > ENTRY_DRAFT_MAX_AGE_MS || savedAt - now > 24 * 60 * 60 * 1000) continue;
      const fields = normalizeEntryDraftFields(entry["fields"]);
      if (fields) out.drafts[k] = { savedAt, fields };
    }
    return out;
  } catch {
    return empty;
  }
}

function writeFile(key: string, file: DraftFile): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (Object.keys(file.drafts).length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

interface Options {
  scope?: StorageScope;
  now?: number;
}

/** Entwurf dieses Kontos und Jobs, sonst `null` (nichts, veraltet, beschädigt, anderer Job). */
export function loadEntryDraft(
  jobId: string | undefined,
  options: Options = {},
): EntryDraftFields | null {
  const key = entryDraftStorageKey(options.scope);
  return readFile(key, options.now ?? Date.now()).drafts[jobKey(jobId)]?.fields ?? null;
}

/** Entwurf schreiben (die Entwürfe anderer Jobs bleiben). `false`, wenn der Speicher ablehnt. */
export function saveEntryDraft(
  jobId: string | undefined,
  fields: EntryDraftFields,
  options: Options = {},
): boolean {
  const key = entryDraftStorageKey(options.scope);
  const now = options.now ?? Date.now();
  const clean = normalizeEntryDraftFields(fields);
  if (!clean) return false;
  const file = readFile(key, now);
  file.drafts[jobKey(jobId)] = { savedAt: now, fields: clean };
  return writeFile(key, file);
}

/** Nur den Entwurf dieses Kontos und Jobs löschen. */
export function clearEntryDraft(jobId: string | undefined, options: Options = {}): void {
  const key = entryDraftStorageKey(options.scope);
  const file = readFile(key, options.now ?? Date.now());
  const k = jobKey(jobId);
  if (!(k in file.drafts)) return;
  delete file.drafts[k];
  writeFile(key, file);
}

export function hasEntryDraft(jobId: string | undefined, options: Options = {}): boolean {
  return loadEntryDraft(jobId, options) !== null;
}
