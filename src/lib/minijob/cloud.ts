/**
 * Cloud sync for MiniJob Companion.
 *
 * ## SYNC_SEMANTICS
 *
 * Decisions use a shared `lastSyncedAt` baseline when both sides have changed
 * after a successful sync. Before the first sync, **shifts** are local work data.
 * Jobs without shifts on first sync are a competing version → conflict (user chooses).
 * Settings-only (no jobs, no shifts) still restores from cloud.
 *
 * | Situation | Result |
 * |---|---|
 * | FIRST_SYNC / NEW_DEVICE / EMPTY_DEVICE (no shifts, no jobs) + cloud | **restore** |
 * | Never synced + has jobs (no shifts) + remote | **conflict** (jobs-only survival) |
 * | DEVICE_CHANGED only (cloud unchanged since baseline) | **push** |
 * | CLOUD_CHANGED only (device unchanged since baseline) | **restore** |
 * | BOTH_CHANGED after shared lastSyncedAt baseline | **conflict** |
 * | Never synced + has shifts + remote exists | **conflict** (data-safe; user chooses) |
 * | Settings-only without jobs/shifts before first sync | → restore |
 *
 * Labels from `classifySyncSituation`: NO_CHANGE | PUSH | RESTORE | CONFLICT | FIRST_SYNC_RESTORE
 */
import { useSyncExternalStore } from "react";

import { t } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

import { markBackup } from "./notify";

import { mergeDeviceAuthFromLocal, stripDeviceAuthForCloud } from "./device-auth";
import { isValidPayload } from "./payload";
import { getData, onDataChange, replaceAll } from "./store";
import type { AppData } from "./types";

export { isValidPayload };

/* ---------- Sync-Metadaten (pro Gerät, lokal) ---------- */

const META_KEY = "minijob-sync-meta-v1";

/** Max wait for a single cloud fetch/push before surfacing error/offline (not stuck syncing). */
export const SYNC_TIMEOUT_MS = 15_000;

export type SyncMeta = {
  /** Konto, zu dem diese Metadaten gehören (Gerät kann mehrfach genutzt werden). */
  userId: string | null;
  /** Zeitpunkt der letzten lokalen Datenänderung (ms). */
  localChangedAt: number | null;
  /** Zeitpunkt des letzten erfolgreichen Abgleichs mit der Cloud (ms). */
  lastSyncedAt: number | null;
  /** `updated_at` des zuletzt gesehenen Cloud-Standes (ms). */
  remoteSeenAt: number | null;
};

const EMPTY_META: SyncMeta = {
  userId: null,
  localChangedAt: null,
  lastSyncedAt: null,
  remoteSeenAt: null,
};

/**
 * Metadaten für das jetzt angemeldete Konto.
 *
 * Gehören die gespeicherten Stände zu einem anderen Konto, dürfen sie nicht
 * weiterverwendet werden: sonst gilt fremdes `lastSyncedAt` und der Abgleich
 * könnte den Cloud-Stand des neuen Kontos still überschreiben. Die lokale
 * Änderungsmarke bleibt erhalten, damit vorhandene Gerätedaten nicht als
 * "nie geändert" gelten und stillschweigend ersetzt werden.
 *
 * `hasLocalWorkData = false` bedeutet: das Gerät hat keine Schichten zu verlieren
 * (frische Installation, Erstlogin, Jobs/Einstellungen allein). Dann darf keine
 * Änderungsmarke erfunden werden – sonst meldet der Abgleich einen Konflikt,
 * statt die vorhandene Cloud-Sicherung einfach wiederherzustellen.
 */
export function metaForUser(
  current: SyncMeta,
  userId: string | null,
  hasLocalWorkData = true,
): SyncMeta {
  if (current.userId === userId) return current;
  return {
    userId,
    localChangedAt: hasLocalWorkData ? (current.localChangedAt ?? Date.now()) : current.localChangedAt,
    lastSyncedAt: null,
    remoteSeenAt: null,
  };
}


let meta: SyncMeta = EMPTY_META;

function loadMeta(): SyncMeta {
  if (typeof window === "undefined") return EMPTY_META;
  try {
    const raw = window.localStorage.getItem(META_KEY);
    if (!raw) return EMPTY_META;
    return { ...EMPTY_META, ...(JSON.parse(raw) as Partial<SyncMeta>) };
  } catch {
    return EMPTY_META;
  }
}

function saveMeta(patch: Partial<SyncMeta>) {
  meta = { ...meta, ...patch };
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* Speicher blockiert – Sync funktioniert dann nur ohne Verlaufswissen */
  }
}


/* ---------- Konfliktentscheidung (rein, testbar) ---------- */

export type SyncDecision = "push" | "restore" | "conflict" | "none";

/** Human-readable situation labels for tests/docs (see SYNC_SEMANTICS above). */
export type SyncSituation =
  | "NO_CHANGE"
  | "PUSH"
  | "RESTORE"
  | "CONFLICT"
  | "FIRST_SYNC_RESTORE";

export type SyncDecisionInput = {
  /**
   * Local *work* data = shifts only.
   * Settings alone before first sync are not a competing work version.
   */
  hasLocalWorkData: boolean;
  /**
   * Local jobs exist (even without shifts). On first sync with remote,
   * jobs-only devices conflict so the user can keep local vs cloud.
   */
  hasLocalJobs?: boolean;
  /** Existiert überhaupt ein Cloud-Stand? */
  hasRemote: boolean;
  localChangedAt: number | null;
  lastSyncedAt: number | null;
  remoteUpdatedAt: number | null;
};

/**
 * Konfliktauflösung über Zeitstempel statt der alten Heuristik „leer → laden".
 *
 * - Kein Cloud-Stand → hochladen (sofern lokale Arbeit/Änderungen existieren).
 * - FIRST_SYNC / NEW_DEVICE / EMPTY_DEVICE (keine Schichten, keine Jobs) + Cloud → restore
 *   (Einstellungen allein zählen nicht als lokale Arbeitsversion).
 * - Nie synchronisiert, Jobs ohne Schichten + Cloud → conflict (jobs-only survival).
 * - Nie synchronisiert, aber lokale Schichten + Cloud → conflict (datensicher).
 * - Cloud unverändert seit letztem Abgleich → lokale Änderungen hochladen.
 * - Cloud neuer als letzter Abgleich UND lokal seither geändert → Konflikt.
 */
export function decideSync(input: SyncDecisionInput): SyncDecision {
  const { hasLocalWorkData, hasRemote, localChangedAt, lastSyncedAt, remoteUpdatedAt } = input;
  const hasLocalJobs = Boolean(input.hasLocalJobs);

  const remoteAt = remoteUpdatedAt ?? 0;
  const syncedAt = lastSyncedAt ?? 0;
  const remoteIsNew = remoteAt > syncedAt;
  const localIsNew = (localChangedAt ?? 0) > syncedAt;

  if (!hasRemote) return hasLocalWorkData || localIsNew ? "push" : "none";

  // FIRST_SYNC: never synced, no shifts, cloud exists.
  // Jobs-only → conflict (user chooses keep local vs cloud). Settings-only → restore.
  if (lastSyncedAt == null && !hasLocalWorkData && hasRemote) {
    if (hasLocalJobs) return "conflict";
    return "restore";
  }

  // Leeres Gerät nach bekanntem Baseline: Cloud laden – außer der leere Stand
  // ist selbst eine bewusste lokale Änderung (z. B. alles gelöscht).
  if (!hasLocalWorkData && !localIsNew) return "restore";
  if (!hasLocalWorkData) return remoteIsNew ? "conflict" : "push";

  // Has shifts: never-synced + remote → both sides "new" → conflict (data-safe).
  if (remoteIsNew && localIsNew) return "conflict";
  if (remoteIsNew) return "restore";
  if (localIsNew) return "push";
  return "none";
}

/** Maps decideSync input to situation labels for tests and documentation. */
export function classifySyncSituation(input: SyncDecisionInput): SyncSituation {
  const decision = decideSync(input);
  if (
    decision === "restore" &&
    input.lastSyncedAt == null &&
    !input.hasLocalWorkData &&
    input.hasRemote
  ) {
    return "FIRST_SYNC_RESTORE";
  }
  switch (decision) {
    case "none":
      return "NO_CHANGE";
    case "push":
      return "PUSH";
    case "restore":
      return "RESTORE";
    case "conflict":
      return "CONFLICT";
  }
}

/* ---------- Sync-Status (für UI) ---------- */

export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "error" | "conflict";

export type SyncState = {
  status: SyncStatus;
  /** Ausstehende Änderung, die noch nicht in der Cloud liegt. */
  pending: boolean;
  message: string | null;
  lastSyncedAt: number | null;
  signedIn: boolean;
};

let state: SyncState = {
  status: "idle",
  pending: false,
  message: null,
  lastSyncedAt: null,
  signedIn: false,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getSyncState(): SyncState {
  return state;
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/* ---------- Cloud-Zugriff ---------- */

let userId: string | null = null;
let timeout: ReturnType<typeof setTimeout> | null = null;

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isSyncTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return name === "TimeoutError" || /sync timed out/i.test(message);
}

function errorMessage(error: unknown): string {
  if (isSyncTimeoutError(error)) return t("error.syncTimeout");
  if (error instanceof Error && error.message) return error.message;
  return t("error.sync");
}

function payloadOf(data: AppData) {
  // Never upload plaintext PIN or platform-bound WebAuthn ids.
  return stripDeviceAuthForCloud(data);
}

/**
 * Race a cloud I/O promise against SYNC_TIMEOUT_MS so a hung network never
 * leaves UI status stuck on "syncing".
 */
async function withSyncTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new DOMException("Sync timed out", "TimeoutError"));
        }, SYNC_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function push(data: AppData): Promise<void> {
  if (!userId) throw new Error(t("error.notSignedIn"));
  const updatedAt = new Date();
  const { error } = await supabase.from("backups").upsert({
    user_id: userId,
    payload: payloadOf(data) as never,
    updated_at: updatedAt.toISOString(),
  });
  if (error) throw error;
  saveMeta({ lastSyncedAt: updatedAt.getTime(), remoteSeenAt: updatedAt.getTime() });
  // Auch automatische Backups als frisch markieren, sonst meldet die
  // Backup-Erinnerung fälschlich einen veralteten Stand.
  markBackup();
}

async function fetchRemote(): Promise<{ payload: AppData; updatedAt: number } | null> {
  if (!userId) throw new Error(t("error.notSignedIn"));
  const { data, error } = await supabase
    .from("backups")
    .select("payload, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.payload) return null;
  if (!isValidPayload(data.payload)) throw new Error(t("error.syncPayload"));
  return {
    payload: data.payload as unknown as AppData,
    updatedAt: data.updated_at ? new Date(data.updated_at).getTime() : 0,
  };
}


let applyingRemote = false;

function applyRemote(remote: { payload: AppData; updatedAt: number }) {
  // Der laufende Timer wird bewusst nie in die Cloud geschrieben (`payloadOf`).
  // Beim Wiederherstellen darf er deshalb auch nicht gelöscht werden – sonst
  // verliert der Nutzer die bereits laufende, noch nicht gespeicherte Zeit.
  // PIN / WebAuthn bleiben gerätelokal (`mergeDeviceAuthFromLocal`).
  const local = getData();
  const runningTimer = local.timer ?? null;
  const merged = mergeDeviceAuthFromLocal(remote.payload, local);
  applyingRemote = true;
  try {
    replaceAll({ ...merged, timer: runningTimer });
  } finally {
    applyingRemote = false;
  }
  saveMeta({
    lastSyncedAt: Date.now(),
    remoteSeenAt: remote.updatedAt,
    localChangedAt: null,
  });
}


/* ---------- Öffentliche Aktionen ---------- */

export async function backupNow(): Promise<void> {
  if (!userId) throw new Error(t("error.notSignedIn"));
  // Mutex: do not overlap forever with autoSync / another manual sync.
  if (syncing) throw new Error(t("error.sync"));
  syncing = true;
  const epoch = ++syncEpoch;
  setState({ status: "syncing", message: null });
  armSyncWatchdog(epoch);
  try {
    await withSyncTimeout(push(getData()));
    if (epoch !== syncEpoch) return;
    setState({ status: "synced", pending: false, message: null, lastSyncedAt: meta.lastSyncedAt });
  } catch (error) {
    abandonSyncEpoch(epoch, error);
    throw error;
  } finally {
    if (epoch === syncEpoch) {
      clearSyncWatchdog();
      syncing = false;
    }
  }
}

export async function restoreNow(): Promise<boolean> {
  if (!userId) throw new Error(t("error.notSignedIn"));
  if (syncing) throw new Error(t("error.sync"));
  syncing = true;
  const epoch = ++syncEpoch;
  setState({ status: "syncing", message: null });
  armSyncWatchdog(epoch);
  try {
    const remote = await withSyncTimeout(fetchRemote());
    if (epoch !== syncEpoch) return false;
    if (!remote) {
      setState({ status: "idle", message: null });
      return false;
    }
    applyRemote(remote);
    setState({ status: "synced", pending: false, message: null, lastSyncedAt: meta.lastSyncedAt });
    return true;
  } catch (error) {
    abandonSyncEpoch(epoch, error);
    throw error;
  } finally {
    if (epoch === syncEpoch) {
      clearSyncWatchdog();
      syncing = false;
    }
  }
}

/** Nutzerentscheidung bei einem Konflikt. */
export async function resolveConflict(keep: "local" | "cloud"): Promise<void> {
  if (keep === "local") await backupNow();
  else await restoreNow();
}

function failed(error: unknown) {
  const offline = isOffline();
  setState({
    status: offline ? "offline" : "error",
    pending: true,
    message: offline ? null : errorMessage(error),
  });
}

/* ---------- Automatischer Abgleich ---------- */

/**
 * Nur ein Abgleich gleichzeitig: „online"-Event, Retry und der debouncete
 * Push können sonst parallel laufen, denselben Cloud-Stand doppelt schreiben
 * und mit ihren Metadaten überkreuz landen.
 */
let syncing = false;
/** Bumped whenever a sync attempt starts (or is force-failed) so stale timers cannot clobber a newer run. */
let syncEpoch = 0;
let syncWatchdog: ReturnType<typeof setTimeout> | null = null;

function clearSyncWatchdog() {
  if (syncWatchdog !== null) {
    globalThis.clearTimeout(syncWatchdog);
    syncWatchdog = null;
  }
}

/**
 * Invalidate this sync run so late Promise.race losers cannot mutate or overwrite UI.
 * Bumps syncEpoch (same as forceFailStuckSync) and surfaces error/offline.
 */
function abandonSyncEpoch(epoch: number, error: unknown): void {
  if (epoch !== syncEpoch) return;
  clearSyncWatchdog();
  syncing = false;
  syncEpoch += 1;
  failed(error);
}

/**
 * Hard wall-clock failsafe: if status is still "syncing" after SYNC_TIMEOUT_MS for
 * this epoch, force error/offline. Independent of Promise.race (which alone left
 * prod UI stuck past 15s when I/O hung or sync restarted).
 */
function armSyncWatchdog(epoch: number) {
  clearSyncWatchdog();
  syncWatchdog = globalThis.setTimeout(() => {
    syncWatchdog = null;
    if (epoch !== syncEpoch) return;
    if (getSyncState().status !== "syncing") return;
    abandonSyncEpoch(epoch, new DOMException("Sync timed out", "TimeoutError"));
  }, SYNC_TIMEOUT_MS);
}

/** UI failsafe: clear a stuck "syncing" status (e.g. if Promise.race did not land). */
export function forceFailStuckSync(): void {
  if (getSyncState().status !== "syncing") return;
  clearSyncWatchdog();
  syncing = false;
  syncEpoch += 1;
  failed(new DOMException("Sync timed out", "TimeoutError"));
}

async function autoSync(): Promise<void> {
  if (!userId) return;
  if (isOffline()) {
    setState({ status: "offline", pending: true });
    return;
  }
  if (syncing) {
    // Läuft bereits – der laufende Durchgang erkennt die neue Änderung selbst.
    setState({ pending: true });
    return;
  }
  syncing = true;
  const epoch = ++syncEpoch;
  // Änderungsmarke zu Beginn: Änderungen *während* des Abgleichs dürfen nicht
  // als "gesichert" gelten, sonst landen sie nie in der Cloud.
  const changedAtStart = meta.localChangedAt;
  setState({ status: "syncing", message: null });
  armSyncWatchdog(epoch);
  try {
    // Single wall-clock race for fetch+decide+push (not per-call clocks that can stack).
    await withSyncTimeout((async () => {
      const local = getData();
      const remote = await fetchRemote();
      // After forceFail / watchdog / timeout abandon, late fetch must not mutate.
      if (epoch !== syncEpoch) return;
      const decision = decideSync({
        hasLocalWorkData: local.shifts.length > 0,
        hasLocalJobs: local.jobs.length > 0,
        hasRemote: remote !== null,
        localChangedAt: meta.localChangedAt,
        lastSyncedAt: meta.lastSyncedAt,
        remoteUpdatedAt: remote?.updatedAt ?? null,
      });

      if (decision === "conflict") {
        setState({ status: "conflict", pending: true, message: null });
        return;
      }
      if (decision === "restore" && remote) applyRemote(remote);
      if (epoch !== syncEpoch) return;
      if (decision === "push") await push(local);
      if (epoch !== syncEpoch) return;
      const changedDuringSync =
        decision !== "restore" && meta.localChangedAt !== null && meta.localChangedAt !== changedAtStart;
      setState({
        status: "synced",
        pending: changedDuringSync,
        message: null,
        lastSyncedAt: meta.lastSyncedAt,
      });
    })());
  } catch (error) {
    abandonSyncEpoch(epoch, error);
  } finally {
    if (epoch === syncEpoch) {
      clearSyncWatchdog();
      syncing = false;
    }
  }
  // Local edits during sync left pending=true without a timer — push after debounce.
  if (state.pending && state.status === "synced" && userId && !applyingRemote) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (isOffline()) {
        setState({ status: "offline", pending: true });
        return;
      }
      void autoSync();
    }, 2500);
  }
}


/** Debouncedes automatisches Cloud-Backup mit Offline-Queue. */
function scheduleBackup(data: AppData) {
  // Remote restore must not look like a local edit (would re-enter autoSync).
  if (applyingRemote) return;
  saveMeta({ localChangedAt: Date.now() });
  if (!userId || !data.settings.autoBackup) return;
  if (state.status === "conflict") {
    setState({ pending: true });
    return;
  }
  // Mid-sync local edits: stamp change + pending, but do not stack another timer.
  if (state.status === "syncing") {
    setState({ pending: true });
    return;
  }
  if (timeout) clearTimeout(timeout);
  timeout = setTimeout(() => {
    if (isOffline()) {
      setState({ status: "offline", pending: true });
      return;
    }
    // Kein blindes Überschreiben: der Abgleich prüft zuerst den Cloud-Stand
    // (updated_at) und meldet einen Konflikt, statt fremde Änderungen zu verlieren.
    void autoSync();
  }, 2500);

}

/** Wartende Änderung erneut senden (nach Offline-Phase oder Fehler). */
export function retryPending(): void {
  if (!userId || !state.pending || state.status === "conflict") return;
  void autoSync();
}

/** Metadaten an das aktuell angemeldete Konto binden. */
function adoptUser(id: string) {
  const local = getData();
  // Jobs alone are not local work — only shifts invent a change mark on account bind.
  const hasLocalWorkData = local.shifts.length > 0;
  const next = metaForUser(meta, id, hasLocalWorkData);
  if (next === meta) return;

  meta = next;
  saveMeta({});
  setState({ lastSyncedAt: meta.lastSyncedAt });
}

let initialized = false;

export function initCloudSync() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  meta = loadMeta();
  setState({ lastSyncedAt: meta.lastSyncedAt });

  onDataChange((data) => scheduleBackup(data));

  window.addEventListener("online", () => {
    if (state.status === "offline" || state.pending) retryPending();
  });
  window.addEventListener("offline", () => {
    if (state.pending) setState({ status: "offline" });
  });

  // Missing VITE_SUPABASE_* makes the lazy client throw on first property
  // access. Must not escape: callers (root ready-gate) would never set ready.
  /** Coalesce getSession + SIGNED_IN so init does not stack two autoSyncs. */
  let initSyncQueued = false;
  function requestInitSync() {
    if (syncing || initSyncQueued) {
      if (syncing) setState({ pending: true });
      return;
    }
    initSyncQueued = true;
    void autoSync().finally(() => {
      initSyncQueued = false;
    });
  }

  try {
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data.session) {
          userId = data.session.user.id;
          adoptUser(userId);
          setState({ signedIn: true });
          requestInitSync();
        }
      })
      .catch((error) => {
        console.error("[cloud] getSession failed; cloud sync disabled", error);
      });

    supabase.auth.onAuthStateChange((event, session) => {
      userId = session?.user.id ?? null;
      setState({ signedIn: userId !== null });
      if (event === "SIGNED_IN" && userId) {
        adoptUser(userId);
        requestInitSync();
      }
      if (event === "SIGNED_OUT") {
        // Geplanten Push abbrechen: er würde sonst ohne Konto laufen bzw.
        // nach einem Kontowechsel in den falschen Cloud-Stand schreiben.
        if (timeout) clearTimeout(timeout);
        timeout = null;
        initSyncQueued = false;
        clearSyncWatchdog();
        syncing = false;
        syncEpoch += 1;
        setState({ status: "idle", pending: false, message: null, lastSyncedAt: null });
      }
    });
  } catch (error) {
    console.error("[cloud] Supabase auth unavailable; cloud sync disabled", error);
  }
}
