/**
 * Data-safety Phase 1: reine Vergleichs- und Prüflogik für Sicherungen.
 *
 * Kein Store-, Netzwerk- oder Storage-Zugriff, keine Mutation der Eingaben, keine Zeitstempel und
 * keine Zufallswerte. Alle acht Nutzerdaten-Sammlungen und die Nicht-Geräte-Einstellungen sind
 * erfasst – anders als `cloud.workFingerprint`, das nur Schichten und Jobs kennt.
 *
 * Bewusst NICHT enthalten (nie Teil eines Vergleichs, einer Prüfsumme oder eines Manifests):
 * - Geräte-Anmeldedaten: `settings.pin`, `pinEnabled`, `biometric`, `biometricCredentialId`
 *   (entspricht `device-auth.stripDeviceAuthForCloud`),
 * - der laufende Timer (`timer`, wird nie in die Cloud geschrieben).
 *
 * Es gibt KEIN ID-basiertes Zusammenführen: `diffBackups` beschreibt nur Unterschiede.
 */
import {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_SETTINGS,
  DEFAULT_SUPPLEMENTS,
  type AppData,
} from "./types";

export const COLLECTION_NAMES = [
  "shifts",
  "jobs",
  "customers",
  "projects",
  "payments",
  "goals",
  "orders",
  "objects",
] as const;

export type CollectionName = (typeof COLLECTION_NAMES)[number];

/** Einstellungen, die nur zu diesem Gerät gehören und nie verglichen/exportiert werden. */
export const DEVICE_AUTH_SETTING_KEYS = [
  "pin",
  "pinEnabled",
  "biometric",
  "biometricCredentialId",
] as const;

/** Schlüssel für Datensätze ohne verwertbare Id (damit sie nicht unbemerkt verschwinden). */
export const NO_ID_KEY = "(no-id)";

type Rec = Record<string, unknown>;
export type BackupLike = Partial<Record<CollectionName, unknown>> & {
  settings?: unknown;
  timer?: unknown;
};

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Datensätze einer Sammlung; fehlend/kaputt → leer, Nicht-Objekte werden ignoriert. */
function recordsOf(data: BackupLike | null | undefined, name: CollectionName): Rec[] {
  const raw = data?.[name];
  return Array.isArray(raw) ? raw.filter(isRec) : [];
}

function idOf(rec: Rec): string {
  const id = rec["id"];
  if (typeof id === "string" && id !== "") return id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return NO_ID_KEY;
}

/**
 * Gleiche Vorgaben wie `store.normalize`, damit rohes Cloud-JSON und lokale Daten nicht wegen
 * Standardwerten abweichen: Schichten ohne `kind`/`breakMinutes`, Job-Satz 0 = "nicht gesetzt".
 */
function normalizeRecord(name: CollectionName, rec: Rec): Rec {
  if (name === "shifts") {
    return { ...rec, kind: rec["kind"] ?? "arbeit", breakMinutes: rec["breakMinutes"] ?? 0 };
  }
  if (name === "jobs" && rec["rate"] === 0) {
    const { rate: _legacyZero, ...rest } = rec;
    return rest;
  }
  return rec;
}

/** Stabile JSON-Darstellung: sortierte Schlüssel, `undefined` wie fehlend, Arrays in Ordnung. */
export function canonicalize(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  const obj = value as Rec;
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort(compareText);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`).join(",")}}`;
}

/** Sprachunabhängiger Textvergleich (kein localeCompare → deterministisch). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Einstellungen ohne Geräte-Anmeldedaten, mit Standardwerten aufgefüllt (stabiler Vergleich). */
export function settingsView(settings: unknown): Rec {
  const source = isRec(settings) ? settings : {};
  const merged: Rec = {
    ...(DEFAULT_SETTINGS as unknown as Rec),
    ...source,
    supplements: {
      ...(DEFAULT_SUPPLEMENTS as unknown as Rec),
      ...(isRec(source["supplements"]) ? source["supplements"] : {}),
    },
    notifications: {
      ...(DEFAULT_NOTIFICATIONS as unknown as Rec),
      ...(isRec(source["notifications"]) ? source["notifications"] : {}),
    },
  };
  for (const key of DEVICE_AUTH_SETTING_KEYS) delete merged[key];
  return merged;
}

/* ------------------------------------------------------------------ Manifest */

export interface BackupManifest {
  counts: Record<CollectionName, number>;
  /** Sortierte, eindeutige Ids je Sammlung (Ids sind zufällig, keine Personendaten). */
  ids: Record<CollectionName, string[]>;
  /** Mehrfach vorkommende Ids je Sammlung. */
  duplicateIds: Record<CollectionName, string[]>;
  /** Datensätze ohne Id je Sammlung. */
  missingIdCount: Record<CollectionName, number>;
  totalRecords: number;
  shiftDateRange: { earliest: string; latest: string } | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function emptyRecord<T>(make: () => T): Record<CollectionName, T> {
  return Object.fromEntries(COLLECTION_NAMES.map((name) => [name, make()])) as Record<
    CollectionName,
    T
  >;
}

export function buildManifest(data: BackupLike | null | undefined): BackupManifest {
  const counts = emptyRecord(() => 0);
  const ids = emptyRecord<string[]>(() => []);
  const duplicateIds = emptyRecord<string[]>(() => []);
  const missingIdCount = emptyRecord(() => 0);
  let total = 0;
  for (const name of COLLECTION_NAMES) {
    const records = recordsOf(data, name);
    counts[name] = records.length;
    total += records.length;
    const seen = new Map<string, number>();
    for (const rec of records) {
      const id = idOf(rec);
      if (id === NO_ID_KEY) missingIdCount[name] += 1;
      else seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    ids[name] = [...seen.keys()].sort(compareText);
    duplicateIds[name] = [...seen.entries()]
      .filter(([, n]) => n > 1)
      .map(([id]) => id)
      .sort(compareText);
  }
  const dates = recordsOf(data, "shifts")
    .map((s) => s["date"])
    .filter((d): d is string => typeof d === "string" && ISO_DATE.test(d))
    .sort(compareText);
  return {
    counts,
    ids,
    duplicateIds,
    missingIdCount,
    totalRecords: total,
    shiftDateRange:
      dates.length > 0 ? { earliest: dates[0]!, latest: dates[dates.length - 1]! } : null,
  };
}

/* ---------------------------------------------------------------------- Diff */

export interface RecordChange {
  id: string;
  /** Namen der abweichenden Felder (nie Werte). */
  fields: string[];
}

export interface CollectionDiff {
  onlyLocal: string[];
  onlyOther: string[];
  changed: RecordChange[];
  unchangedCount: number;
}

export interface BackupDiff {
  collections: Record<CollectionName, CollectionDiff>;
  /** Abweichende Einstellungen (Schlüsselnamen), getrennt von den Datensätzen. */
  settings: { changedKeys: string[] };
  /** Mindestens eine Seite hat Datensätze, die der anderen fehlen. */
  hasLocalOnly: boolean;
  hasOtherOnly: boolean;
  hasChanged: boolean;
  /** Alle Sammlungen UND Einstellungen gleich. */
  identical: boolean;
}

type Grouped = Map<string, { canon: string[]; first: Rec }>;

function group(data: BackupLike | null | undefined, name: CollectionName): Grouped {
  const out: Grouped = new Map();
  for (const rec of recordsOf(data, name)) {
    const normalized = normalizeRecord(name, rec);
    const id = idOf(normalized);
    const canon = canonicalize(normalized);
    const entry = out.get(id);
    if (entry) entry.canon.push(canon);
    else out.set(id, { canon: [canon], first: normalized });
  }
  for (const entry of out.values()) entry.canon.sort(compareText);
  return out;
}

function differingFields(a: Rec, b: Rec): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => canonicalize(a[key]) !== canonicalize(b[key])).sort(compareText);
}

export function diffBackups(
  local: BackupLike | null | undefined,
  other: BackupLike | null | undefined,
): BackupDiff {
  const collections = emptyRecord<CollectionDiff>(() => ({
    onlyLocal: [],
    onlyOther: [],
    changed: [],
    unchangedCount: 0,
  }));
  for (const name of COLLECTION_NAMES) {
    const a = group(local, name);
    const b = group(other, name);
    const diff = collections[name];
    for (const [id, entry] of a) {
      const match = b.get(id);
      if (!match) {
        diff.onlyLocal.push(id);
      } else if (entry.canon.join("\n") === match.canon.join("\n")) {
        diff.unchangedCount += 1;
      } else {
        const fields = differingFields(entry.first, match.first);
        const duplicateMismatch = entry.canon.length !== match.canon.length;
        diff.changed.push({
          id,
          fields: fields.length > 0 || !duplicateMismatch ? fields : ["(duplicate-count)"],
        });
      }
    }
    for (const id of b.keys()) if (!a.has(id)) diff.onlyOther.push(id);
    diff.onlyLocal.sort(compareText);
    diff.onlyOther.sort(compareText);
    diff.changed.sort((x, y) => compareText(x.id, y.id));
  }
  const sa = settingsView(local?.settings);
  const sb = settingsView(isRec(other) ? other["settings"] : undefined);
  const changedKeys = [...new Set([...Object.keys(sa), ...Object.keys(sb)])]
    .filter((key) => canonicalize(sa[key]) !== canonicalize(sb[key]))
    .sort(compareText);
  const all = COLLECTION_NAMES.map((n) => collections[n]);
  const hasLocalOnly = all.some((c) => c.onlyLocal.length > 0);
  const hasOtherOnly = all.some((c) => c.onlyOther.length > 0);
  const hasChanged = all.some((c) => c.changed.length > 0);
  return {
    collections,
    settings: { changedKeys },
    hasLocalOnly,
    hasOtherOnly,
    hasChanged,
    identical: !hasLocalOnly && !hasOtherOnly && !hasChanged && changedKeys.length === 0,
  };
}

/* --------------------------------------------------------------- Fingerprint */

/** Zwei unabhängige 53-Bit-Hashes (cyrb53): nur zur Änderungserkennung, nicht kryptografisch. */
function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function collectionsCanon(data: BackupLike | null | undefined): Record<string, string[]> {
  const collections: Record<string, string[]> = {};
  for (const name of COLLECTION_NAMES) {
    collections[name] = recordsOf(data, name)
      .map((rec) => normalizeRecord(name, rec))
      .map((rec) => ({ id: idOf(rec), canon: canonicalize(rec) }))
      .sort((x, y) => compareText(x.id, y.id) || compareText(x.canon, y.canon))
      .map((entry) => entry.canon);
  }
  return collections;
}

function hashCanon(canon: string, prefix: string): string {
  const a = cyrb53(canon, 0x9e3779b9).toString(16).padStart(14, "0");
  const b = cyrb53(canon, 0x7f4a7c15).toString(16).padStart(14, "0");
  return `${prefix}-${canon.length}-${a}${b}`;
}

/**
 * Deterministische Prüfsumme über alle acht Sammlungen und die Nicht-Geräte-Einstellungen.
 * Unabhängig von Schlüssel- und Listenreihenfolge der Sammlungen; ohne Zeit und Zufall.
 */
export function fullFingerprint(data: BackupLike | null | undefined): string {
  const canon = canonicalize({
    v: 1,
    collections: collectionsCanon(data),
    settings: settingsView(data?.settings),
  });
  return hashCanon(canon, "fp1");
}

/**
 * Wie `fullFingerprint`, aber NUR über die acht Nutzerdaten-Sammlungen (ohne Einstellungen).
 * Grundlage der Änderungsmarke "Nutzerdaten geändert": Einstellungen allein zählen nicht als
 * Datenänderung (Phase-2-Vertrag), alle acht Sammlungen schon.
 */
export function userDataFingerprint(data: BackupLike | null | undefined): string {
  return hashCanon(canonicalize({ v: 1, collections: collectionsCanon(data) }), "ud1");
}

/* ----------------------------------------------------------------- Integrität */

export type IntegrityCode =
  | "payment-job-missing"
  | "shift-job-missing"
  | "shift-object-missing"
  | "goal-job-missing"
  | "duplicate-id"
  | "activeJob-missing"
  | "missing-id";

export interface IntegrityIssue {
  code: IntegrityCode;
  collection: CollectionName | "settings";
  /** Id des betroffenen Datensatzes (nicht bei Einstellungen). */
  id?: string;
  /** Die ins Leere zeigende Referenz. */
  reference?: string;
}

function idSet(data: BackupLike, name: CollectionName): Set<string> {
  const out = new Set<string>();
  for (const rec of recordsOf(data, name)) {
    const id = idOf(rec);
    if (id !== NO_ID_KEY) out.add(id);
  }
  return out;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * Meldet Unstimmigkeiten, repariert nichts und verändert nichts. Eine fehlende Referenz macht die
 * Sicherung nicht ungültig (Daten bleiben erhalten), sie wird nur sichtbar gemacht.
 */
export function validateIntegrity(data: BackupLike | null | undefined): IntegrityIssue[] {
  if (!data) return [];
  const issues: IntegrityIssue[] = [];
  const jobs = idSet(data, "jobs");
  const objects = idSet(data, "objects");

  for (const rec of recordsOf(data, "payments")) {
    const ref = rec["jobId"];
    if (!hasText(ref) || !jobs.has(ref)) {
      issues.push({
        code: "payment-job-missing",
        collection: "payments",
        id: idOf(rec),
        ...(hasText(ref) ? { reference: ref } : {}),
      });
    }
  }
  for (const rec of recordsOf(data, "shifts")) {
    const jobRef = rec["jobId"];
    if (hasText(jobRef) && !jobs.has(jobRef)) {
      issues.push({
        code: "shift-job-missing",
        collection: "shifts",
        id: idOf(rec),
        reference: jobRef,
      });
    }
    const objectRef = rec["objectId"];
    if (hasText(objectRef) && !objects.has(objectRef)) {
      issues.push({
        code: "shift-object-missing",
        collection: "shifts",
        id: idOf(rec),
        reference: objectRef,
      });
    }
  }
  for (const rec of recordsOf(data, "goals")) {
    const ref = rec["jobId"];
    if (hasText(ref) && !jobs.has(ref)) {
      issues.push({ code: "goal-job-missing", collection: "goals", id: idOf(rec), reference: ref });
    }
  }
  const manifest = buildManifest(data);
  for (const name of COLLECTION_NAMES) {
    for (const id of manifest.duplicateIds[name]) {
      issues.push({ code: "duplicate-id", collection: name, id });
    }
    if (manifest.missingIdCount[name] > 0) {
      issues.push({ code: "missing-id", collection: name });
    }
  }
  const activeJobId = isRec(data.settings) ? data.settings["activeJobId"] : undefined;
  if (hasText(activeJobId) && !jobs.has(activeJobId)) {
    issues.push({ code: "activeJob-missing", collection: "settings", reference: activeJobId });
  }
  return issues;
}

/* --------------------------------------------------------------- Leer-Prüfung */

/**
 * `true` nur, wenn ALLE acht Nutzerdaten-Sammlungen nachweislich leer sind. Einstellungen zählen
 * nicht als Nutzerdaten, ein vom Assistenten angelegter Job schon. Eine vorhandene, aber kaputte
 * Sammlung (kein Array) gilt NICHT als leer – "nachweislich leer" statt "vermutlich leer".
 * Ersetzt die Schichten-only-Logik `hasLocalWorkData` nicht, sondern ist strenger.
 */
export function isUserDataEmpty(data: BackupLike | null | undefined): boolean {
  if (!data || typeof data !== "object") return false;
  return COLLECTION_NAMES.every((name) => {
    const raw = data[name];
    if (raw === undefined || raw === null) return true;
    return Array.isArray(raw) && raw.length === 0;
  });
}

/** Typ-Hilfe für Aufrufer mit vollständigen `AppData`. */
export function asBackupLike(data: AppData): BackupLike {
  return data as unknown as BackupLike;
}
