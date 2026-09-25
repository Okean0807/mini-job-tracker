/**
 * Cloud sync for MiniJob Companion.
 *
 * ## SYNC_SEMANTICS
 *
 * Decisions use a shared `lastSyncedAt` baseline. **Work** changes (shifts/jobs
 * fingerprint) are tracked separately from any store write (`localChangedAt`,
 * including settings). Conflict ONLY when local WORK and cloud both changed
 * after the baseline — settings-only must not create a false work conflict.
 *
 * | Situation | Result |
 * |---|---|
 * | FIRST_SYNC / NEW_DEVICE / EMPTY_DEVICE (no shifts, no jobs) + cloud | **restore** |
 * | Never synced + has jobs (no shifts) + remote | **conflict** (jobs-only survival; not during onboarding / wizard-pending-first-sync) |
 * | Onboarding incomplete or wizardPendingFirstSync + jobs + remote | **restore** (wizard jobs are not competing) |
 * | DEVICE_CHANGED only (cloud unchanged since baseline) | **push** |
 * | CLOUD_CHANGED only (local work unchanged since baseline) | **restore** |
 * | BOTH work+cloud changed after shared lastSyncedAt | **conflict** |
 * | Settings-only local change + cloud unchanged | **push** (not conflict) |
 * | Settings-only local change + cloud new, work unchanged | **restore** |
 * | Never synced + has shifts/jobs + remote, work fingerprint equal (after normalize) | **synced** (re-establish baseline; no UI) |
 * | Baseline set + both sides "new" but work fingerprint equal (after normalize) | **synced** (stale marks; quiet re-baseline) |
 * | Work fingerprint differs | **conflict** (data-safe; user chooses) |
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
import {
  activateScope,
  getActiveScope,
  getActiveScopeOwner,
  getData,
  normalize,
  onDataChange,
  readStoredData,
  replaceAll,
  seedDeviceLock,
  updateSettings,
} from "./store";
import { clearOnboardingDraft, handoffOnboardingDraft } from "./onboarding-draft";
import {
  DEMO_SCOPE,
  GUEST_SCOPE,
  LEGACY_KEYS,
  clearOAuthPending,
  readOAuthPending,
  scopedKey,
  userScope,
  type StorageScope,
} from "./storage-scope";
import { flagDemoImportOffer } from "./import-offers";
import { isWizardComplete } from "./wizard-flow";
import type { AppData } from "./types";

export { isValidPayload };

/**
 * Defense in depth: a real account scope must never carry the Testmodus flag.
 * Runs AFTER the store switched to the account namespace, so it only touches
 * the account's own data – the Testmodus namespace (`demo`) keeps its flag and
 * data untouched (no carry-over of onboarded/wizardCompletedAt, no auto-import).
 */
function exitLocalDemoMode(): void {
  try {
    if (getActiveScope().kind === "user" && getData().settings.localDemoMode === true) {
      updateSettings({ localDemoMode: false });
    }
  } catch {
    /* store may be mid-init */
  }
}


/* ---------- Sync-Metadaten (pro Gerät, lokal) ---------- */

/**
 * Basis-Schlüssel; Metadaten liegen pro Scope (`<base>:u:<userId>` …), genau wie
 * die Daten selbst. Der globale Legacy-Schlüssel wird nicht mehr verwendet.
 */
export const META_KEY_BASE = "minijob-sync-meta-v1";

function metaKeyFor(scope: StorageScope): string {
  return scopedKey(META_KEY_BASE, scope);
}

/** Schlüssel, zu dem das In-Memory-`meta` gehört (folgt dem Store-Scope). */
let metaKey: string = metaKeyFor(GUEST_SCOPE);

/** Max wait for a single cloud fetch/push before surfacing error/offline (not stuck syncing). */
export const SYNC_TIMEOUT_MS = 15_000;

export type SyncMeta = {
  /** Konto, zu dem diese Metadaten gehören (Gerät kann mehrfach genutzt werden). */
  userId: string | null;
  /** Zeitpunkt der letzten lokalen Datenänderung (ms) — any store write incl. settings. */
  localChangedAt: number | null;
  /**
   * Zeitpunkt der letzten lokalen *Arbeits*-Änderung (Schichten/Jobs-Fingerprint).
   * Settings-only writes bump `localChangedAt` but not this mark.
   */
  localWorkChangedAt?: number | null;
  /** Last observed fingerprint of shifts+jobs (local-only). */
  localWorkFingerprint?: string | null;
  /** Zeitpunkt des letzten erfolgreichen Abgleichs mit der Cloud (ms). */
  lastSyncedAt: number | null;
  /** `updated_at` des zuletzt gesehenen Cloud-Standes (ms). */
  remoteSeenAt: number | null;
  /**
   * Wizard just finished (or still incomplete): first sync must restore cloud
   * instead of treating the wizard-created job as a competing jobs-only version.
   * Cleared after a successful first sync. Local-only — not part of cloud payload.
   */
  wizardPendingFirstSync?: boolean;
};

const EMPTY_META: SyncMeta = {
  userId: null,
  localChangedAt: null,
  localWorkChangedAt: null,
  localWorkFingerprint: null,
  lastSyncedAt: null,
  remoteSeenAt: null,
  wizardPendingFirstSync: false,
};

/**
 * Metadaten für das jetzt angemeldete Konto.
 *
 * Gehören die gespeicherten Stände zu einem *anderen* Konto (a→b), dürfen sie
 * nicht weiterverwendet werden: sonst gilt fremdes `lastSyncedAt` und der
 * Abgleich könnte den Cloud-Stand des neuen Kontos still überschreiben.
 *
 * Erste Bindung `userId: null → id` behält `lastSyncedAt` / `remoteSeenAt`
 * (kein Fake-Erstsync): sonst entstehen Dauer-Konflikte nach Settings-Änderungen.
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

  const localChangedAt = hasLocalWorkData
    ? (current.localChangedAt ?? Date.now())
    : current.localChangedAt;

  // First bind (null → userId): keep sync baseline; do NOT promote settings-only
  // localChangedAt into localWorkChangedAt (that caused false conflicts).
  if (current.userId == null && userId != null) {
    return {
      ...current,
      userId,
      localChangedAt,
      localWorkChangedAt: current.localWorkChangedAt ?? null,
      wizardPendingFirstSync: Boolean(current.wizardPendingFirstSync),
    };
  }

  // Real account switch (a→b) or leaving an account: drop foreign baseline.
  // Invent a work mark when shifts exist so we conflict instead of silent overwrite.
  return {
    userId,
    localChangedAt,
    localWorkChangedAt: hasLocalWorkData
      ? (current.localWorkChangedAt ?? Date.now())
      : (current.localWorkChangedAt ?? null),
    localWorkFingerprint: current.localWorkFingerprint ?? null,
    lastSyncedAt: null,
    remoteSeenAt: null,
    // Keep wizard flag across account bind so finish→sign-in race still restores.
    wizardPendingFirstSync: Boolean(current.wizardPendingFirstSync),
  };
}


let meta: SyncMeta = EMPTY_META;

function loadMeta(): SyncMeta {
  if (typeof window === "undefined") return EMPTY_META;
  try {
    const raw = window.localStorage.getItem(metaKey);
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
    window.localStorage.setItem(metaKey, JSON.stringify(meta));
  } catch {
    /* Speicher blockiert – Sync funktioniert dann nur ohne Verlaufswissen */
  }
}

/** Mark that the onboarding wizard just created a job — first sync should restore cloud. */
export function markWizardPendingFirstSync(): void {
  saveMeta({ wizardPendingFirstSync: true });
}

/** Clear after a successful first sync (push or restore). */
export function clearWizardPendingFirstSync(): void {
  if (!meta.wizardPendingFirstSync) return;
  saveMeta({ wizardPendingFirstSync: false });
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
  /**
   * When true, ignore hasLocalJobs on first sync (onboarding / wizard pending).
   * Outside onboarding keep false so leftover jobs still conflict (#78).
   */
  ignoreLocalJobsOnFirstSync?: boolean;
  /** Existiert überhaupt ein Cloud-Stand? */
  hasRemote: boolean;
  localChangedAt: number | null;
  /** When shifts/jobs fingerprint last changed (settings-only must not set this). */
  localWorkChangedAt?: number | null;
  lastSyncedAt: number | null;
  remoteUpdatedAt: number | null;
};

/**
 * Konfliktauflösung über Zeitstempel statt der alten Heuristik „leer → laden".
 *
 * - Kein Cloud-Stand → hochladen (sofern lokale Arbeit/Änderungen existieren).
 * - FIRST_SYNC / NEW_DEVICE / EMPTY_DEVICE (keine Schichten, keine Jobs) + Cloud → restore
 *   (Einstellungen allein zählen nicht als lokale Arbeitsversion).
 * - Nie synchronisiert, Jobs ohne Schichten + Cloud → conflict (jobs-only survival),
 *   außer ignoreLocalJobsOnFirstSync (Onboarding / Wizard pending).
 * - Nie synchronisiert, aber lokale Schichten + Cloud → conflict (datensicher).
 * - Cloud unverändert seit letztem Abgleich → lokale Änderungen hochladen.
 * - Cloud neuer UND lokale *Arbeit* seither geändert → Konflikt.
 * - Cloud neuer, lokal nur Settings (kein Work-Bump) → restore.
 */
export function decideSync(input: SyncDecisionInput): SyncDecision {
  const { hasLocalWorkData, hasRemote, localChangedAt, lastSyncedAt, remoteUpdatedAt } = input;
  const hasLocalJobs = Boolean(input.hasLocalJobs);

  const remoteAt = remoteUpdatedAt ?? 0;
  const syncedAt = lastSyncedAt ?? 0;
  const remoteIsNew = remoteAt > syncedAt;
  const localIsNew = (localChangedAt ?? 0) > syncedAt;
  const localWorkIsNew = (input.localWorkChangedAt ?? 0) > syncedAt;

  if (!hasRemote) return hasLocalWorkData || localIsNew ? "push" : "none";

  // FIRST_SYNC: never synced, no shifts, cloud exists.
  // Jobs-only → conflict (user chooses keep local vs cloud), unless onboarding ignores
  // wizard-created jobs. Settings-only → restore.
  if (lastSyncedAt == null && !hasLocalWorkData && hasRemote) {
    if (hasLocalJobs && !input.ignoreLocalJobsOnFirstSync) return "conflict";
    return "restore";
  }

  // Leeres Gerät nach bekanntem Baseline: Cloud laden – außer der leere Stand
  // ist selbst eine bewusste lokale Änderung (z. B. alles gelöscht).
  if (!hasLocalWorkData && !localIsNew) return "restore";
  if (!hasLocalWorkData) return remoteIsNew ? "conflict" : "push";

  // Has shifts, never-synced + remote: conflict when local claims a change mark
  // (legacy localChangedAt or work). No marks → restore (empty change history).
  if (lastSyncedAt == null && hasRemote) {
    if (localWorkIsNew || localIsNew) return "conflict";
    return "restore";
  }

  // Work conflict only when BOTH cloud and local *work* changed after baseline.
  // Settings-only (localIsNew, !localWorkIsNew) + remoteIsNew → restore.
  if (remoteIsNew && localWorkIsNew) return "conflict";
  if (remoteIsNew) return "restore";
  if (localIsNew) return "push";
  return "none";
}

/** Diagnostics for tests/DEV — decision plus computed flags (no secrets). */
export function explainSyncDecision(input: SyncDecisionInput): {
  decision: SyncDecision;
  remoteIsNew: boolean;
  localIsNew: boolean;
  localWorkIsNew: boolean;
  syncedAt: number;
  remoteAt: number;
  hasLocalWorkData: boolean;
  hasRemote: boolean;
  hasLocalJobs: boolean;
  ignoreLocalJobsOnFirstSync: boolean;
} {
  const remoteAt = input.remoteUpdatedAt ?? 0;
  const syncedAt = input.lastSyncedAt ?? 0;
  return {
    decision: decideSync(input),
    remoteIsNew: remoteAt > syncedAt,
    localIsNew: (input.localChangedAt ?? 0) > syncedAt,
    localWorkIsNew: (input.localWorkChangedAt ?? 0) > syncedAt,
    syncedAt,
    remoteAt,
    hasLocalWorkData: input.hasLocalWorkData,
    hasRemote: input.hasRemote,
    hasLocalJobs: Boolean(input.hasLocalJobs),
    ignoreLocalJobsOnFirstSync: Boolean(input.ignoreLocalJobsOnFirstSync),
  };
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

/**
 * Owner guard (defense in depth): the locally loaded data belongs to the
 * signed-in account only if the store's namespace owner equals the session user.
 * Without that, nothing may be pushed, kept ("Lokal behalten") or restored.
 */
function ownsLoadedData(): boolean {
  return userId !== null && getActiveScopeOwner() === userId;
}

/**
 * Scope-Epoche: wird bei JEDEM Namensraum-Wechsel erhöht. Jeder await-Pfad, der
 * danach Meta/State schreibt, hält vorher {metaKey, Konto, Store-Besitzer,
 * Epoche} fest und schreibt nur, wenn sich nichts davon geändert hat.
 */
let scopeEpoch = 0;

type OwnerSnapshot = {
  key: string;
  owner: string | null;
  storeOwner: string | null;
  scope: number;
};

function snapshotOwner(): OwnerSnapshot {
  return { key: metaKey, owner: userId, storeOwner: getActiveScopeOwner(), scope: scopeEpoch };
}

function stillOwner(snap: OwnerSnapshot): boolean {
  return (
    snap.key === metaKey &&
    snap.owner === userId &&
    snap.storeOwner === getActiveScopeOwner() &&
    snap.scope === scopeEpoch &&
    ownsLoadedData()
  );
}

/** Konto/Scope hat während eines laufenden Cloud-Zugriffs gewechselt. */
export class StaleSyncError extends Error {
  constructor() {
    super(t("error.accountMismatch"));
    this.name = "StaleSyncError";
  }
}

/** Angemeldete Konto-Id laut Sync-Schicht (null = abgemeldet). */
export function getCloudUserId(): string | null {
  return userId;
}

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

/**
 * Recursively stringify with sorted object keys so key-order differences in
 * cloud JSON do not look like different work.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

/**
 * Stable fingerprint of work (shifts + jobs). Settings are excluded.
 *
 * Both sides are run through `normalize` first so local defaults
 * (`kind`/`breakMinutes`, stripped job `rate:0`) match raw cloud JSON.
 * Arrays are sorted by id; object keys are sorted for stable stringify.
 */
export function workFingerprint(data: Pick<AppData, "shifts" | "jobs">): string {
  const { shifts, jobs } = normalize({
    shifts: data.shifts ?? [],
    jobs: data.jobs ?? [],
  });
  const byId = (a: { id: string }, b: { id: string }) =>
    String(a.id).localeCompare(String(b.id));
  return stableStringify({
    shifts: [...shifts].sort(byId),
    jobs: [...jobs].sort(byId),
  });
}

/**
 * Push local payload. Clears change marks after success.
 * When `preserveIfNewerThan` is set (autoSync), marks that were bumped *during*
 * the sync (≠ watermark) are kept so pending retry still runs.
 */
async function push(
  data: AppData,
  preserveIfNewerThan?: { local: number | null; work: number | null },
): Promise<void> {
  if (!userId) throw new Error(t("error.notSignedIn"));
  // Owner guard: only ever upload data that was loaded from THIS account's namespace.
  if (!ownsLoadedData()) throw new Error(t("error.accountMismatch"));
  // Vor dem await festhalten: wohin die Metadaten gehören.
  const snap = snapshotOwner();
  const updatedAt = new Date();
  const { error } = await supabase.from("backups").upsert({
    user_id: userId,
    payload: payloadOf(data) as never,
    updated_at: updatedAt.toISOString(),
  });
  // Post-await-Guard: Konto/Scope gewechselt → keine Meta, kein markBackup, kein "synced".
  if (!stillOwner(snap)) throw new StaleSyncError();
  if (error) throw error;
  const ts = updatedAt.getTime();
  let nextLocal: number | null = null;
  let nextWork: number | null = null;
  if (preserveIfNewerThan) {
    if (meta.localChangedAt !== null && meta.localChangedAt !== preserveIfNewerThan.local) {
      nextLocal = meta.localChangedAt;
    }
    const workNow = meta.localWorkChangedAt ?? null;
    if (workNow !== null && workNow !== preserveIfNewerThan.work) {
      nextWork = workNow;
    }
  }
  saveMeta({
    lastSyncedAt: ts,
    remoteSeenAt: ts,
    localChangedAt: nextLocal,
    localWorkChangedAt: nextWork,
    localWorkFingerprint: workFingerprint(data),
    wizardPendingFirstSync: false,
  });
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
  // Empty/partial / Skip-era cloud backups must not complete onboarding.
  // Only isWizardComplete (onboarded + jobs|wizardCompletedAt) may close the wizard.
  // Incomplete remotes force onboarded:false but KEEP jobs/shifts (no silent deletes).
  const remoteComplete = isWizardComplete(merged.settings, merged.jobs);
  const safePayload = remoteComplete
    ? merged
    : {
        ...merged,
        settings: { ...merged.settings, onboarded: false },
      };
  applyingRemote = true;
  try {
    replaceAll({ ...safePayload, timer: runningTimer });
  } finally {
    applyingRemote = false;
  }
  if (remoteComplete) {
    clearOnboardingDraft();
  }
  saveMeta({
    lastSyncedAt: Date.now(),
    remoteSeenAt: remote.updatedAt,
    localChangedAt: null,
    localWorkChangedAt: null,
    localWorkFingerprint: workFingerprint(safePayload),
    wizardPendingFirstSync: false,
  });
}


/* ---------- Öffentliche Aktionen ---------- */

export async function backupNow(): Promise<void> {
  if (!userId) throw new Error(t("error.notSignedIn"));
  if (!ownsLoadedData()) throw new Error(t("error.accountMismatch"));
  // Mutex: do not overlap forever with autoSync / another manual sync.
  if (syncing) throw new Error(t("error.sync"));
  syncing = true;
  const epoch = ++syncEpoch;
  setState({ status: "syncing", message: null });
  armSyncWatchdog(epoch);
  const snap = snapshotOwner();
  try {
    await withSyncTimeout(push(getData()));
    // Lauf wurde abgebrochen (Kontowechsel/Timeout): nie als Erfolg melden.
    if (epoch !== syncEpoch) throw new StaleSyncError();
    if (!stillOwner(snap)) throw new StaleSyncError();
    setState({ status: "synced", pending: false, message: null, lastSyncedAt: meta.lastSyncedAt });
  } catch (error) {
    if (error instanceof StaleSyncError) abandonStaleEpoch(epoch);
    else abandonSyncEpoch(epoch, error);
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
  if (!ownsLoadedData()) throw new Error(t("error.accountMismatch"));
  if (syncing) throw new Error(t("error.sync"));
  syncing = true;
  const epoch = ++syncEpoch;
  const snap = snapshotOwner();
  setState({ status: "syncing", message: null });
  armSyncWatchdog(epoch);
  try {
    const remote = await withSyncTimeout(fetchRemote());
    // Abgebrochen (z. B. Kontowechsel per Auth-Event): still beenden statt
    // „keine Cloud-Sicherung gefunden“ (false ist echtes „nicht gefunden“).
    if (epoch !== syncEpoch) throw new StaleSyncError();
    // Post-await-Guard: kein applyRemote/saveMeta in einen anderen Namensraum.
    if (!stillOwner(snap)) throw new StaleSyncError();
    if (!remote) {
      setState({ status: "idle", message: null });
      return false;
    }
    applyRemote(remote);
    setState({ status: "synced", pending: false, message: null, lastSyncedAt: meta.lastSyncedAt });
    return true;
  } catch (error) {
    if (error instanceof StaleSyncError) abandonStaleEpoch(epoch);
    else abandonSyncEpoch(epoch, error);
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
 * Konto/Scope hat während eines manuellen Abgleichs gewechselt: Lauf still
 * beenden – kein Fehlerstatus (der neue Namensraum hat seinen eigenen Stand).
 */
function abandonStaleEpoch(epoch: number): void {
  if (epoch !== syncEpoch) return;
  clearSyncWatchdog();
  syncing = false;
  syncEpoch += 1;
  setState({ status: "idle", message: null });
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
  // Owner guard: never sync data of another namespace (guest/demo/other account).
  if (!ownsLoadedData()) return;
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
  const workChangedAtStart = meta.localWorkChangedAt ?? null;
  const snap = snapshotOwner();
  setState({ status: "syncing", message: null });
  armSyncWatchdog(epoch);
  try {
    // Single wall-clock race for fetch+decide+push (not per-call clocks that can stack).
    await withSyncTimeout((async () => {
      const local = getData();
      const remote = await fetchRemote();
      // After forceFail / watchdog / timeout abandon, late fetch must not mutate.
      if (epoch !== syncEpoch) return;
      // Mid-flight-Guard: Namensraum/Konto während des Fetch gewechselt → weder
      // Re-Baseline, Konfliktstatus, Restore noch Push (alles würde fremde Meta treffen).
      if (!stillOwner(snap)) return;
      const hasLocalWorkData = local.shifts.length > 0;
      const hasLocalJobs = local.jobs.length > 0;
      const localFp = workFingerprint(local);
      const remoteFp = remote ? workFingerprint(remote.payload) : null;
      const workEqual = remote !== null && localFp === remoteFp;

      // Quiet re-baseline when work is semantically identical (normalize-safe FP).
      // Covers lost baseline (lastSyncedAt=null) and stale marks that would
      // otherwise false-conflict (remoteIsNew && localWorkIsNew with equal work).
      // No replaceAll / upsert — settings drift can wait for a later push.
      const quietRebaseline = () => {
        if (!remote) return;
        saveMeta({
          lastSyncedAt: remote.updatedAt,
          remoteSeenAt: remote.updatedAt,
          localChangedAt: null,
          localWorkChangedAt: null,
          localWorkFingerprint: localFp,
          wizardPendingFirstSync: false,
        });
        setState({
          status: "synced",
          pending: false,
          message: null,
          lastSyncedAt: meta.lastSyncedAt,
        });
      };

      if (workEqual && meta.lastSyncedAt == null && (hasLocalWorkData || hasLocalJobs)) {
        quietRebaseline();
        return;
      }

      const ignoreLocalJobsOnFirstSync =
        !local.settings.onboarded || Boolean(meta.wizardPendingFirstSync);
      const decisionInput = {
        hasLocalWorkData,
        hasLocalJobs,
        ignoreLocalJobsOnFirstSync,
        hasRemote: remote !== null,
        localChangedAt: meta.localChangedAt,
        localWorkChangedAt: meta.localWorkChangedAt ?? null,
        lastSyncedAt: meta.lastSyncedAt,
        remoteUpdatedAt: remote?.updatedAt ?? null,
      };
      const decision = decideSync(decisionInput);
      if (decision === "conflict" && import.meta.env.DEV) {
        console.debug("[cloud] sync conflict", explainSyncDecision(decisionInput));
      }

      if (decision === "conflict") {
        if (workEqual) {
          quietRebaseline();
          return;
        }
        setState({ status: "conflict", pending: true, message: null });
        return;
      }
      if (decision === "restore" && remote) applyRemote(remote);
      if (epoch !== syncEpoch) return;
      if (decision === "push") {
        await push(local, {
          local: changedAtStart,
          work: workChangedAtStart,
        });
      }
      if (epoch !== syncEpoch) return;
      const changedDuringSync =
        decision !== "restore" &&
        ((meta.localChangedAt !== null && meta.localChangedAt !== changedAtStart) ||
          ((meta.localWorkChangedAt ?? null) !== null &&
            (meta.localWorkChangedAt ?? null) !== workChangedAtStart));
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
  const now = Date.now();
  const fp = workFingerprint(data);
  const prevFp = meta.localWorkFingerprint ?? null;
  const patch: Partial<SyncMeta> = {
    localChangedAt: now,
    localWorkFingerprint: fp,
  };
  // Only bump work mark when shifts/jobs fingerprint actually changes.
  // Null prevFp is seeded without bump (initCloudSync / post-sync seed).
  if (prevFp !== null && prevFp !== fp) {
    patch.localWorkChangedAt = now;
  }
  saveMeta(patch);
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

/** Geplante/laufende Abgleiche verwerfen (Konto- oder Scope-Wechsel). */
function cancelPendingSync(): void {
  if (timeout) clearTimeout(timeout);
  timeout = null;
  clearSyncWatchdog();
  syncing = false;
  syncEpoch += 1;
}

/** Sync-Metadaten des aktiven Store-Scopes laden (nach jedem Scope-Wechsel). */
function loadMetaForActiveScope(): void {
  metaKey = metaKeyFor(getActiveScope());
  meta = loadMeta();
  // Seed work fingerprint once so settings-only writes after upgrade do not
  // look like first-ever work changes.
  if (meta.localWorkFingerprint == null) {
    meta = { ...meta, localWorkFingerprint: workFingerprint(getData()) };
    saveMeta({});
  }
}

/**
 * Store + Sync-Metadaten gemeinsam auf einen Namensraum umschalten – immer
 * BEVOR ein autoSync für das neue Konto laufen kann. Der bisherige Scope bleibt
 * gespeichert (nichts wird gelöscht), ist aber nicht mehr im Speicher.
 */
function switchLocalScope(scope: StorageScope): void {
  const changed = activateScope(scope);
  if (!changed && metaKey === metaKeyFor(scope)) return;
  scopeEpoch += 1;
  cancelPendingSync();
  loadMetaForActiveScope();
  setState({ status: "idle", pending: false, message: null, lastSyncedAt: meta.lastSyncedAt });
}

/**
 * Auth-Event ohne Session (nicht nur SIGNED_OUT): Konto-Bindung konsistent
 * lösen – wie beim Logout per switchLocalScope (Epoch-Bump, Timer/laufende
 * Abgleiche abbrechen). Ausnahme INITIAL_SESSION: auth-js meldet dort auch bei
 * Netzfehlern (offline, Refresh nicht möglich) null – dann bleibt der
 * Namensraum wie beim getSession-Fehlerpfad erhalten, laufende Abgleiche des
 * bisherigen Kontos werden aber ebenfalls ungültig.
 */
function releaseSession(event: string): void {
  const hadUser = userId !== null;
  userId = null;
  if (event !== "INITIAL_SESSION" && getActiveScope().kind === "user") {
    leaveAccountScope();
  } else if (hadUser) {
    scopeEpoch += 1;
    cancelPendingSync();
  }
}

/** Nach Logout: Kontodaten aus dem Speicher nehmen, Gast-Namensraum laden. */
export function leaveAccountScope(): void {
  if (getActiveScope().kind !== "user") return;
  switchLocalScope(GUEST_SCOPE);
}

/**
 * Abmelden mit Ergebnisprüfung. Nur wenn Supabase die Abmeldung bestätigt,
 * wird der Konto-Namensraum verlassen (Daten bleiben für dieses Konto auf dem
 * Gerät gespeichert, sind aber nicht mehr geladen). Bei Fehler bleibt die
 * Session – und damit der Konto-Namensraum – unverändert.
 */
export async function performSignOut(): Promise<{
  ok: boolean;
  error: unknown;
  /** Server-Abmeldung fehlgeschlagen, lokale Session aber entfernt. */
  localOnly?: boolean;
}> {
  let signOutError: unknown = null;
  try {
    const { error } = await supabase.auth.signOut();
    signOutError = error ?? null;
  } catch (error) {
    signOutError = error;
  }
  if (signOutError) {
    // auth-js entfernt die lokale Session auch bei Netzfehlern (und feuert
    // SIGNED_OUT). Maßgeblich ist daher der tatsächliche Session-Stand.
    let stillSignedIn = true;
    try {
      const { data } = await supabase.auth.getSession();
      stillSignedIn = Boolean(data.session);
    } catch {
      stillSignedIn = true;
    }
    if (stillSignedIn) return { ok: false, error: signOutError };
    userId = null;
    leaveAccountScope();
    setState({ signedIn: false });
    return { ok: true, error: signOutError, localOnly: true };
  }
  leaveAccountScope();
  return { ok: true, error: null };
}

/**
 * Testmodus betreten (nur ohne Anmeldung): eigener Namensraum `demo`.
 * Liefert false, wenn ein Konto angemeldet ist.
 */
export function enterTestModeScope(): boolean {
  if (userId !== null) return false;
  switchLocalScope(DEMO_SCOPE);
  return true;
}

/**
 * Nach explizitem Import (Legacy-/Testdaten → Konto): Baseline verwerfen und
 * lokale Arbeit als geändert markieren. `decideSync` entscheidet dann wie immer:
 * kein Cloud-Stand → push; Cloud-Stand vorhanden → Konflikt (bzw. stiller
 * Re-Baseline bei identischer Arbeit). Ein bestehendes Backup wird so nie still
 * überschrieben.
 */
export function markExplicitImportForSync(): void {
  if (!ownsLoadedData()) throw new Error(t("error.accountMismatch"));
  cancelPendingSync();
  const now = Date.now();
  saveMeta({
    userId,
    lastSyncedAt: null,
    remoteSeenAt: null,
    localChangedAt: now,
    localWorkChangedAt: now,
    localWorkFingerprint: workFingerprint(getData()),
    wizardPendingFirstSync: false,
  });
  setState({ status: "idle", pending: true, message: null, lastSyncedAt: null });
  void autoSync();
}

/** Liegen lokale, noch nicht gesicherte Änderungen im aktiven Konto-Scope vor? */
export function hasUnsyncedLocalChanges(): boolean {
  return (
    meta.lastSyncedAt == null || meta.localChangedAt != null || meta.localWorkChangedAt != null
  );
}

/** OAuth-Rückkehr: Marker verbrauchen; aus dem Testmodus → Import nur anbieten. */
function consumeOAuthPending(id: string): void {
  const marker = readOAuthPending();
  clearOAuthPending();
  if (marker?.from === "demo") flagDemoImportOffer(id);
}

/**
 * Upgrade-Schutz: War das Gerät vor der Namensraum-Umstellung per PIN gesperrt
 * und belegen die alten Sync-Metadaten genau dieses Konto, wird nur die
 * Gerätesperre (nicht die Daten!) in den Konto-Namensraum übernommen.
 */
function seedDeviceLockFromLegacy(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const rawMeta = window.localStorage.getItem(LEGACY_KEYS.syncMeta);
    const legacyOwner = rawMeta ? (JSON.parse(rawMeta) as { userId?: unknown }).userId : null;
    if (legacyOwner !== id) return;
    const legacy = readStoredData(LEGACY_KEYS.data);
    if (legacy) seedDeviceLock(legacy.settings);
  } catch {
    /* ignore */
  }
}

/** Session bestätigt: in den Namensraum dieses Kontos wechseln. */
function bindSession(id: string): void {
  userId = id;
  if (getActiveScope().kind !== "user") {
    // Wizard-Fortschritt (nur Schritt/Arbeitsart) über den OAuth-Redirect retten.
    const marker = readOAuthPending();
    if (marker) {
      handoffOnboardingDraft(marker.from === "demo" ? DEMO_SCOPE : GUEST_SCOPE, userScope(id));
    }
  }
  switchLocalScope(userScope(id));
  seedDeviceLockFromLegacy(id);
}

let initialized = false;

export function initCloudSync() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  loadMetaForActiveScope();
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
      .then(({ data, error }) => {
        if (data.session) {
          bindSession(data.session.user.id);
          exitLocalDemoMode();
          adoptUser(data.session.user.id);
          consumeOAuthPending(data.session.user.id);
          setState({ signedIn: true });
          requestInitSync();
        } else if (!error) {
          // Verifiziert keine Session (abgelaufen / OAuth abgebrochen): Kontodaten
          // nicht weiter anzeigen. Bei Fehler (z. B. offline) bleibt der Scope.
          clearOAuthPending();
          if (userId === null) leaveAccountScope();
        }
      })
      .catch((error: unknown) => {
        console.error("[cloud] getSession failed; cloud sync disabled", error);
      });

    supabase.auth.onAuthStateChange((event, session) => {
      const nextId = session?.user.id ?? null;
      if (nextId) bindSession(nextId);
      else {
        // Wie SIGNED_OUT: keinen Init-Abgleich des alten Kontos mehr koaleszieren.
        initSyncQueued = false;
        releaseSession(event);
      }
      setState({ signedIn: userId !== null });
      if (event === "SIGNED_IN" && userId) {
        exitLocalDemoMode();
        adoptUser(userId);
        consumeOAuthPending(userId);
        requestInitSync();
      }
      if (event === "SIGNED_OUT") {
        // Geplanten Push abbrechen: er würde sonst ohne Konto laufen bzw.
        // nach einem Kontowechsel in den falschen Cloud-Stand schreiben.
        initSyncQueued = false;
        // Kontodaten aus dem Speicher nehmen (bleiben für dieses Konto gespeichert);
        // switchLocalScope bricht dabei Timer/laufende Abgleiche ab (Epoch-Bump).
        if (getActiveScope().kind === "user") leaveAccountScope();
        else cancelPendingSync();
        setState({ status: "idle", pending: false, message: null, lastSyncedAt: null });
      }
    });
  } catch (error) {
    console.error("[cloud] Supabase auth unavailable; cloud sync disabled", error);
  }
}
