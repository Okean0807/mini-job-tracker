/**
 * Data-safety Phase 3: Wiederherstellungspunkte (Snapshots) in IndexedDB.
 *
 * Dieses Modul sichert den Stand EINER Seite eines zerstörerischen Vorgangs, bevor er stattfindet
 * (Phase 4 ruft es auf). Hier gibt es bewusst KEINE Wiederherstellung in die App-Daten, keinen
 * Cloud-Zugriff, keine Premium-Abhängigkeit und keinen localStorage-Rückfall der Snapshot-Daten.
 *
 * Aufbau: Datenbank `minijob-safety-v1`, Store `snapshots` (keyPath `id`), Indizes `byScope`
 * (`scope`) und `byScopeKind` (`[scope, kind]`). `scope` ist das Scope-Suffix aus
 * `storage-scope.ts` (`u:<id>`, `demo`, `guest`); jede Abfrage verlangt genau diesen Wert.
 *
 * Lebenszyklus je Snapshot: pending schreiben → in einer ANDEREN Transaktion zurücklesen →
 * Nutzlast, SHA-256 und Manifest prüfen → als verified markieren → erst DANN ältere Snapshots
 * derselben Art und desselben Scopes entfernen (nie der einzige verifizierte). Ein fehlgeschlagener
 * Snapshot löscht nur sich selbst, nie einen verifizierten.
 *
 * Datenschutz: Snapshots enthalten KEINE Gerätesperre (PIN, Biometrie-Id; wie der Cloud-Upload).
 * Es wird nichts geloggt; Fehler tragen nur einen Code.
 */
import {
  buildManifest,
  COLLECTION_NAMES,
  type BackupLike,
  type CollectionName,
} from "./backup-compare";
import { stripDeviceAuthForCloud } from "./device-auth";
import { isValidPayload } from "./payload";
import { scopeSuffix, type StorageScope } from "./storage-scope";
import type { AppData } from "./types";

export const SAFETY_DB_NAME = "minijob-safety-v1";
export const SAFETY_DB_VERSION = 1;
export const SNAPSHOT_STORE = "snapshots";
export const SNAPSHOT_KINDS = [
  "local_pre_restore",
  "cloud_pre_overwrite",
  "local_pre_import",
] as const;
export type SnapshotKind = (typeof SNAPSHOT_KINDS)[number];

/** Pro Scope und Art bleiben höchstens so viele verifizierte Snapshots erhalten. */
export const MAX_VERIFIED_PER_KIND = 2;
/** Ein pending-Snapshot, der älter ist und in diesem Tab nicht läuft, gilt als unterbrochen. */
export const PENDING_TTL_MS = 10 * 60 * 1000;
/** Ablageort der noch offenen Konto-Bereinigungen (nur Scope-Suffixe, keine Daten). */
export const PURGE_MARKER_KEY = "minijob-snapshot-purge-v1";

/* ------------------------------------------------------------------- Fehler */

export type SnapshotErrorCode =
  | "unavailable"
  | "quota"
  | "aborted"
  | "io-error"
  | "verification-failed"
  | "invalid-payload"
  | "scope-changed"
  | "not-found"
  | "crypto-unavailable";

export type SnapshotFailureReason =
  | "sha256-mismatch"
  | "manifest-mismatch"
  | "credentials-present"
  | "bytes-mismatch"
  | "record-mismatch"
  | "missing-record";

export class SnapshotError extends Error {
  readonly code: SnapshotErrorCode;
  readonly reason: SnapshotFailureReason | undefined;
  constructor(code: SnapshotErrorCode, reason?: SnapshotFailureReason) {
    super(reason ? `${code}:${reason}` : code);
    this.name = "SnapshotError";
    this.code = code;
    this.reason = reason;
  }
}

/** DOMException/Fehlerobjekt → typisierter Fehler (ohne Nutzdaten in der Meldung). */
export function mapIdbError(
  error: unknown,
  fallback: SnapshotErrorCode = "io-error",
): SnapshotError {
  if (error instanceof SnapshotError) return error;
  const name =
    typeof error === "object" && error !== null ? String((error as { name?: unknown }).name) : "";
  if (name === "QuotaExceededError") return new SnapshotError("quota");
  if (name === "AbortError" || name === "TransactionInactiveError")
    return new SnapshotError("aborted");
  if (
    name === "InvalidStateError" ||
    name === "SecurityError" ||
    name === "NotSupportedError" ||
    name === "VersionError"
  ) {
    return new SnapshotError("unavailable");
  }
  return new SnapshotError(fallback);
}

/* ------------------------------------------------------------------ Typen */

export type SnapshotState = "pending" | "verified";

export interface SnapshotRecord {
  id: string;
  /** Scope-Suffix (`u:<id>`, `demo`, `guest`). */
  scope: string;
  kind: SnapshotKind;
  createdAt: number;
  state: SnapshotState;
  verifiedAt?: number;
  counts: Record<CollectionName, number>;
  totalRecords: number;
  shiftDateRange: { earliest: string; latest: string } | null;
  bytes: number;
  sha256: string;
  /** Kanonischer JSON-Text der Daten OHNE Gerätesperre. */
  payload: string;
}

/** Ein Datensatz ohne Nutzlast (für Listen). */
export type SnapshotMeta = Omit<SnapshotRecord, "payload">;

/** Was die Oberfläche sehen darf: nur verifizierte, ohne Scope und ohne Nutzlast. */
export type SnapshotSummary = Omit<SnapshotRecord, "payload" | "scope" | "state" | "verifiedAt"> & {
  verifiedAt: number;
};

/** Austauschbare Ablage (IndexedDB in der App, In-Memory-Double in Tests). */
export interface SnapshotStorage {
  put(record: SnapshotRecord): Promise<void>;
  get(id: string): Promise<SnapshotRecord | undefined>;
  markVerified(id: string, verifiedAt: number): Promise<void>;
  listByScope(scope: string): Promise<SnapshotMeta[]>;
  listByScopeKind(scope: string, kind: SnapshotKind): Promise<SnapshotMeta[]>;
  listPending(): Promise<SnapshotMeta[]>;
  delete(id: string): Promise<void>;
  deleteMany(ids: string[]): Promise<void>;
  /** Löscht genau diesen Scope (kein Präfix-Treffer); liefert die Anzahl. */
  deleteByScope(scope: string): Promise<number>;
}

export interface PurgeMarkerStore {
  read(): string[];
  write(scopes: string[]): void;
}

export interface SnapshotDeps {
  backend: SnapshotStorage;
  /** SHA-256 über Bytes; Standard: `crypto.subtle`. */
  digest?: (bytes: Uint8Array) => Promise<ArrayBuffer>;
  now?: () => number;
  newId?: () => string;
  /** `false`, sobald Konto/Scope des Vorgangs nicht mehr der aktive ist. */
  isScopeCurrent?: () => boolean;
}

/* ---------------------------------------------------------------- Hilfsfunktionen */

const encoder = new TextEncoder();

async function defaultDigest(bytes: Uint8Array): Promise<ArrayBuffer> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) throw new SnapshotError("crypto-unavailable");
  return subtle.digest("SHA-256", bytes as BufferSource);
}

export async function sha256Hex(
  text: string,
  digest: (bytes: Uint8Array) => Promise<ArrayBuffer> = defaultDigest,
): Promise<string> {
  const buffer = await digest(encoder.encode(text));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newSnapshotId(): string {
  const random = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
  return random ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isKind(value: unknown): value is SnapshotKind {
  return typeof value === "string" && (SNAPSHOT_KINDS as readonly string[]).includes(value);
}

/** Tab-lokal: laufende Snapshots (gehören nicht zu "unterbrochen"). */
const inFlight = new Set<string>();

function toMeta(record: SnapshotRecord): SnapshotMeta {
  const { payload: _payload, ...meta } = record;
  return meta;
}

function toSummary(meta: SnapshotMeta): SnapshotSummary {
  return {
    id: meta.id,
    kind: meta.kind,
    createdAt: meta.createdAt,
    verifiedAt: meta.verifiedAt ?? meta.createdAt,
    counts: meta.counts,
    totalRecords: meta.totalRecords,
    shiftDateRange: meta.shiftDateRange,
    bytes: meta.bytes,
    sha256: meta.sha256,
  };
}

function newestFirst(a: SnapshotMeta, b: SnapshotMeta): number {
  const ta = a.verifiedAt ?? a.createdAt;
  const tb = b.verifiedAt ?? b.createdAt;
  if (ta !== tb) return tb - ta;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/* ------------------------------------------------------------ Verifikation */

function sameManifest(a: SnapshotMeta, expected: ReturnType<typeof buildManifest>): boolean {
  if (a.totalRecords !== expected.totalRecords) return false;
  for (const name of COLLECTION_NAMES) if (a.counts[name] !== expected.counts[name]) return false;
  const x = a.shiftDateRange;
  const y = expected.shiftDateRange;
  return x === null || y === null ? x === y : x.earliest === y.earliest && x.latest === y.latest;
}

/** Prüft einen gelesenen Datensatz gegen seine eigenen Angaben und (optional) den erwarteten. */
export async function verifySnapshotRecord(
  stored: SnapshotRecord | undefined,
  deps: Pick<SnapshotDeps, "digest">,
  expected?: Pick<SnapshotRecord, "id" | "scope" | "kind" | "sha256">,
): Promise<void> {
  if (!stored) throw new SnapshotError("verification-failed", "missing-record");
  if (
    expected &&
    (stored.id !== expected.id ||
      stored.scope !== expected.scope ||
      stored.kind !== expected.kind ||
      stored.sha256 !== expected.sha256)
  ) {
    throw new SnapshotError("verification-failed", "record-mismatch");
  }
  if (typeof stored.payload !== "string") throw new SnapshotError("invalid-payload");
  const hash = await sha256Hex(stored.payload, deps.digest);
  if (hash !== stored.sha256) throw new SnapshotError("verification-failed", "sha256-mismatch");
  if (encoder.encode(stored.payload).length !== stored.bytes) {
    throw new SnapshotError("verification-failed", "bytes-mismatch");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored.payload);
  } catch {
    throw new SnapshotError("invalid-payload");
  }
  if (!isValidPayload(parsed)) throw new SnapshotError("invalid-payload");
  if (!sameManifest(stored, buildManifest(parsed as unknown as BackupLike))) {
    throw new SnapshotError("verification-failed", "manifest-mismatch");
  }
  const settings = (parsed as unknown as { settings?: Record<string, unknown> }).settings;
  if (
    settings &&
    (settings["pin"] !== undefined ||
      settings["biometricCredentialId"] !== undefined ||
      settings["pinEnabled"] === true ||
      settings["biometric"] === true)
  ) {
    throw new SnapshotError("verification-failed", "credentials-present");
  }
}

/* ------------------------------------------------------------- Erstellen */

/** Snapshots verifizierter Art/Scope über das Limit hinaus entfernen (nie den einzigen/neuesten). */
async function pruneVerified(
  backend: SnapshotStorage,
  scope: string,
  kind: SnapshotKind,
): Promise<void> {
  const verified = (await backend.listByScopeKind(scope, kind))
    .filter((m) => m.state === "verified")
    .sort(newestFirst);
  if (verified.length <= MAX_VERIFIED_PER_KIND) return;
  const drop = verified.slice(MAX_VERIFIED_PER_KIND);
  await backend.deleteMany(drop.map((m) => m.id));
}

export interface CreateSnapshotArgs {
  kind: SnapshotKind;
  scope: StorageScope;
  /** Die zu sichernde Seite (Gerätesperre wird entfernt). */
  data: AppData;
}

export interface CreatedSnapshot {
  summary: SnapshotSummary;
  /** `true`, wenn das Aufräumen älterer Snapshots fehlschlug (der neue ist trotzdem verifiziert). */
  pruneFailed: boolean;
}

export async function createSnapshot(
  args: CreateSnapshotArgs,
  deps: SnapshotDeps,
): Promise<CreatedSnapshot> {
  if (!isKind(args.kind)) throw new SnapshotError("invalid-payload");
  const { backend } = deps;
  const now = deps.now ?? Date.now;
  const assertCurrent = () => {
    if (deps.isScopeCurrent && !deps.isScopeCurrent()) throw new SnapshotError("scope-changed");
  };
  assertCurrent();

  let payload: string;
  let manifest: ReturnType<typeof buildManifest>;
  try {
    payload = JSON.stringify(stripDeviceAuthForCloud(args.data));
    const parsed = JSON.parse(payload) as unknown;
    if (!isValidPayload(parsed)) throw new SnapshotError("invalid-payload");
    manifest = buildManifest(parsed as unknown as BackupLike);
  } catch (error) {
    throw error instanceof SnapshotError ? error : new SnapshotError("invalid-payload");
  }
  const sha256 = await sha256Hex(payload, deps.digest);
  const record: SnapshotRecord = {
    id: (deps.newId ?? newSnapshotId)(),
    scope: scopeSuffix(args.scope),
    kind: args.kind,
    createdAt: now(),
    state: "pending",
    counts: manifest.counts,
    totalRecords: manifest.totalRecords,
    shiftDateRange: manifest.shiftDateRange,
    bytes: encoder.encode(payload).length,
    sha256,
    payload,
  };

  inFlight.add(record.id);
  try {
    assertCurrent();
    await backend.put(record); // 1. pending schreiben
    assertCurrent();
    const stored = await backend.get(record.id); // 2. in anderer Transaktion zurücklesen
    await verifySnapshotRecord(stored, deps, record); // 3. Nutzlast, SHA-256, Manifest
    assertCurrent();
    const verifiedAt = now();
    await backend.markVerified(record.id, verifiedAt); // 4. verifiziert
    let pruneFailed = false;
    try {
      await pruneVerified(backend, record.scope, record.kind); // 5. erst jetzt aufräumen
    } catch {
      pruneFailed = true;
    }
    return {
      summary: toSummary({ ...toMeta(record), state: "verified", verifiedAt }),
      pruneFailed,
    };
  } catch (error) {
    // Nur der EIGENE (neue) Datensatz wird entfernt, nie ein anderer, bereits verifizierter.
    // Lässt sich sein Zustand nicht lesen, gilt er als nicht verifiziert (Operation ist gescheitert).
    try {
      let current: SnapshotRecord | undefined;
      try {
        current = await backend.get(record.id);
      } catch {
        current = undefined;
      }
      if (!current || current.state !== "verified") await backend.delete(record.id);
    } catch {
      /* Die Bereinigung beim nächsten Start räumt ihn auf. */
    }
    throw error instanceof SnapshotError ? error : mapIdbError(error);
  } finally {
    inFlight.delete(record.id);
  }
}

/* ------------------------------------------------ Unterbrochene pending-Snapshots */

/** Entfernt unterbrochene pending-Snapshots (alt genug, nicht in diesem Tab aktiv). */
export async function recoverPendingSnapshots(
  deps: Pick<SnapshotDeps, "backend" | "now">,
  ttlMs: number = PENDING_TTL_MS,
): Promise<number> {
  const now = (deps.now ?? Date.now)();
  const pending = await deps.backend.listPending();
  const stale = pending.filter(
    (m) => m.state === "pending" && !inFlight.has(m.id) && now - m.createdAt >= ttlMs,
  );
  if (stale.length === 0) return 0;
  await deps.backend.deleteMany(stale.map((m) => m.id));
  return stale.length;
}

/* ------------------------------------------------ Scope-sichere Abfragen und Löschen */

/** Verifizierte Snapshots GENAU dieses Scopes, neueste zuerst. */
export async function listSnapshots(
  scope: StorageScope,
  deps: SnapshotDeps,
): Promise<SnapshotSummary[]> {
  const metas = await deps.backend.listByScope(scopeSuffix(scope));
  return metas
    .filter((m) => m.state === "verified" && m.scope === scopeSuffix(scope))
    .sort(newestFirst)
    .map(toSummary);
}

async function loadOwned(
  id: string,
  scope: StorageScope,
  deps: SnapshotDeps,
): Promise<SnapshotRecord> {
  const record = await deps.backend.get(id);
  // Ein fremder Scope verhält sich wie "nicht vorhanden" (kein Hinweis auf fremde Snapshots).
  if (!record || record.scope !== scopeSuffix(scope) || record.state !== "verified") {
    throw new SnapshotError("not-found");
  }
  return record;
}

export interface SnapshotFile {
  filename: string;
  mime: "application/json";
  text: string;
  bytes: number;
}

/** Datei zum Herunterladen; vorher wird die Integrität erneut geprüft. */
export async function getSnapshotFile(
  id: string,
  scope: StorageScope,
  deps: SnapshotDeps,
): Promise<SnapshotFile> {
  const record = await loadOwned(id, scope, deps);
  await verifySnapshotRecord(record, deps);
  const day = new Date(record.createdAt).toISOString().slice(0, 10);
  return {
    filename: `minijob-snapshot-${record.kind}-${day}.json`,
    mime: "application/json",
    text: record.payload,
    bytes: record.bytes,
  };
}

export async function deleteSnapshot(
  id: string,
  scope: StorageScope,
  deps: SnapshotDeps,
): Promise<void> {
  const record = await deps.backend.get(id);
  if (!record || record.scope !== scopeSuffix(scope)) throw new SnapshotError("not-found");
  await deps.backend.delete(id);
}

/** Alle Snapshots dieses (aktiven) Scopes löschen; andere Scopes bleiben unberührt. */
export async function deleteAllSnapshots(scope: StorageScope, deps: SnapshotDeps): Promise<number> {
  return deps.backend.deleteByScope(scopeSuffix(scope));
}

/* ------------------------------------------------------ Konto-Löschung (lokal) */

export function createLocalStoragePurgeMarkers(key: string = PURGE_MARKER_KEY): PurgeMarkerStore {
  return {
    read() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed)
          ? parsed.filter((x): x is string => typeof x === "string")
          : [];
      } catch {
        return [];
      }
    },
    write(scopes) {
      try {
        if (scopes.length === 0) globalThis.localStorage?.removeItem(key);
        else globalThis.localStorage?.setItem(key, JSON.stringify([...new Set(scopes)]));
      } catch {
        /* blockiert: die Bereinigung läuft dann nur im aktuellen Versuch */
      }
    },
  };
}

/**
 * Löscht alle Snapshots genau dieses Kontos (nach erfolgreicher serverseitiger Löschung).
 * Der Marker wird VOR dem Löschen gesetzt und erst nach Erfolg entfernt: ein Abbruch bleibt
 * wiederholbar (`runPendingScopePurges`). Abmelden löscht nie Snapshots.
 */
export async function purgeScopeSnapshots(
  scope: StorageScope,
  deps: Pick<SnapshotDeps, "backend">,
  markers: PurgeMarkerStore = createLocalStoragePurgeMarkers(),
): Promise<void> {
  const key = scopeSuffix(scope);
  markers.write([...markers.read(), key]);
  await deps.backend.deleteByScope(key);
  markers.write(markers.read().filter((s) => s !== key));
}

/** Offene Bereinigungen wiederholen; liefert die Anzahl der abgeschlossenen. */
export async function runPendingScopePurges(
  deps: Pick<SnapshotDeps, "backend">,
  markers: PurgeMarkerStore = createLocalStoragePurgeMarkers(),
): Promise<number> {
  let done = 0;
  for (const key of markers.read()) {
    try {
      await deps.backend.deleteByScope(key);
      markers.write(markers.read().filter((s) => s !== key));
      done += 1;
    } catch {
      /* bleibt für den nächsten Start markiert */
    }
  }
  return done;
}

/* ------------------------------------------------------------- IndexedDB */

interface TxContext {
  setResult(value: unknown): void;
  fail(error: SnapshotError): void;
}

/** Echte IndexedDB-Ablage. Ohne `indexedDB` schlägt jede Operation mit `unavailable` fehl. */
export function createIndexedDbStorage(
  factory: IDBFactory | null | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB,
): SnapshotStorage {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function getDb(): Promise<IDBDatabase> {
    if (!factory) return Promise.reject(new SnapshotError("unavailable"));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(SAFETY_DB_NAME, SAFETY_DB_VERSION);
      } catch {
        reject(new SnapshotError("unavailable"));
        return;
      }
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
        store.createIndex("byScope", "scope");
        store.createIndex("byScopeKind", ["scope", "kind"]);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(mapIdbError(request.error, "unavailable"));
      request.onblocked = () => reject(new SnapshotError("unavailable"));
    }).catch((error: unknown) => {
      dbPromise = null;
      throw error instanceof SnapshotError ? error : new SnapshotError("unavailable");
    });
    return dbPromise;
  }

  async function run<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore, ctx: TxContext) => void,
  ): Promise<T> {
    const db = await getDb();
    return new Promise<T>((resolve, reject) => {
      let result: unknown;
      let failure: SnapshotError | null = null;
      let tx: IDBTransaction;
      try {
        tx = db.transaction(SNAPSHOT_STORE, mode);
      } catch (error) {
        reject(mapIdbError(error, "unavailable"));
        return;
      }
      tx.oncomplete = () => resolve(result as T);
      tx.onabort = () => reject(failure ?? mapIdbError(tx.error ?? { name: "AbortError" }));
      const ctx: TxContext = {
        setResult: (value) => {
          result = value;
        },
        fail: (error) => {
          failure = error;
          try {
            tx.abort();
          } catch {
            /* bereits beendet */
          }
        },
      };
      try {
        work(tx.objectStore(SNAPSHOT_STORE), ctx);
      } catch (error) {
        failure = mapIdbError(error);
        try {
          tx.abort();
        } catch {
          /* bereits beendet */
        }
      }
    });
  }

  function collectMetas(
    source: IDBObjectStore | IDBIndex,
    range: IDBKeyRange | undefined,
    keep: (record: SnapshotRecord) => boolean,
    ctx: TxContext,
  ): void {
    const out: SnapshotMeta[] = [];
    const request = source.openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        ctx.setResult(out);
        return;
      }
      const record = cursor.value as SnapshotRecord;
      if (keep(record)) out.push(toMeta(record));
      cursor.continue();
    };
  }

  return {
    put: (record) => run<void>("readwrite", (store) => void store.put(record)),
    get: (id) =>
      run<SnapshotRecord | undefined>("readonly", (store, ctx) => {
        const request = store.get(id);
        request.onsuccess = () => ctx.setResult(request.result as SnapshotRecord | undefined);
      }),
    markVerified: (id, verifiedAt) =>
      run<void>("readwrite", (store, ctx) => {
        const request = store.get(id);
        request.onsuccess = () => {
          const record = request.result as SnapshotRecord | undefined;
          if (!record) {
            ctx.fail(new SnapshotError("not-found"));
            return;
          }
          store.put({ ...record, state: "verified", verifiedAt });
        };
      }),
    listByScope: (scope) =>
      run<SnapshotMeta[]>("readonly", (store, ctx) =>
        collectMetas(store.index("byScope"), IDBKeyRange.only(scope), () => true, ctx),
      ),
    listByScopeKind: (scope, kind) =>
      run<SnapshotMeta[]>("readonly", (store, ctx) =>
        collectMetas(store.index("byScopeKind"), IDBKeyRange.only([scope, kind]), () => true, ctx),
      ),
    listPending: () =>
      run<SnapshotMeta[]>("readonly", (store, ctx) =>
        collectMetas(store, undefined, (r) => r.state === "pending", ctx),
      ),
    delete: (id) => run<void>("readwrite", (store) => void store.delete(id)),
    deleteMany: (ids) =>
      run<void>("readwrite", (store) => {
        for (const id of ids) store.delete(id);
      }),
    deleteByScope: (scope) =>
      run<number>("readwrite", (store, ctx) => {
        let count = 0;
        const request = store.index("byScope").openCursor(IDBKeyRange.only(scope));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            ctx.setResult(count);
            return;
          }
          cursor.delete();
          count += 1;
          cursor.continue();
        };
      }),
  };
}

/* --------------------------------------------------- Standard-Ablage (App) */

let defaultStorage: SnapshotStorage | null = null;
let initializedStorage: SnapshotStorage | null = null;

export function getDefaultSnapshotStorage(): SnapshotStorage {
  if (!defaultStorage) defaultStorage = createIndexedDbStorage();
  return defaultStorage;
}

/** Nur für Tests: andere Ablage einsetzen (`null` = zurücksetzen). */
export function setDefaultSnapshotStorageForTests(backend: SnapshotStorage | null): void {
  defaultStorage = backend;
  initializedStorage = null;
}

/**
 * Einmal je Seitenaufruf und Ablage: unterbrochene pending-Snapshots und offene Konto-
 * Bereinigungen aufräumen. Fehler verhindern die eigentliche Operation nie.
 */
export async function ensureBackupSafetyReady(
  backend: SnapshotStorage = getDefaultSnapshotStorage(),
): Promise<void> {
  if (initializedStorage === backend) return;
  initializedStorage = backend;
  try {
    await recoverPendingSnapshots({ backend });
    await runPendingScopePurges({ backend });
  } catch {
    /* beim nächsten Start erneut */
  }
}
