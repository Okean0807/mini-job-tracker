import { useSyncExternalStore } from "react";

import { t } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

import { markBackup } from "./notify";

import { getData, onDataChange, replaceAll } from "./store";
import type { AppData } from "./types";

/* ---------- Sync-Metadaten (pro Gerät, lokal) ---------- */

const META_KEY = "minijob-sync-meta-v1";

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
 */
export function metaForUser(current: SyncMeta, userId: string | null): SyncMeta {
  if (current.userId === userId) return current;
  return {
    userId,
    localChangedAt: current.localChangedAt ?? Date.now(),
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

export type SyncDecisionInput = {
  /** Enthält das Gerät überhaupt eigene Daten (Schichten/Jobs)? */
  hasLocalData: boolean;
  /** Existiert überhaupt ein Cloud-Stand? */
  hasRemote: boolean;
  localChangedAt: number | null;
  lastSyncedAt: number | null;
  remoteUpdatedAt: number | null;
};

/**
 * Konfliktauflösung über Zeitstempel statt der alten Heuristik „leer → laden".
 *
 * - Kein Cloud-Stand → hochladen (sofern lokale Daten existieren).
 * - Kein lokaler Datenbestand → Cloud laden.
 * - Cloud unverändert seit letztem Abgleich → lokale Änderungen hochladen.
 * - Cloud neuer als letzter Abgleich UND lokal seither geändert → Konflikt,
 *   Entscheidung trifft der Nutzer (kein stilles Überschreiben).
 */
export function decideSync(input: SyncDecisionInput): SyncDecision {
  const { hasLocalData, hasRemote, localChangedAt, lastSyncedAt, remoteUpdatedAt } = input;

  const remoteAt = remoteUpdatedAt ?? 0;
  const syncedAt = lastSyncedAt ?? 0;
  const remoteIsNew = remoteAt > syncedAt;
  const localIsNew = (localChangedAt ?? 0) > syncedAt;

  if (!hasRemote) return hasLocalData || localIsNew ? "push" : "none";
  // Leeres Gerät: Cloud laden – außer der leere Stand ist selbst eine
  // bewusste lokale Änderung (z. B. alles gelöscht), die nicht still
  // rückgängig gemacht werden darf.
  if (!hasLocalData && !localIsNew) return "restore";
  if (!hasLocalData) return remoteIsNew ? "conflict" : "push";

  if (remoteIsNew && localIsNew) return "conflict";
  if (remoteIsNew) return "restore";
  if (localIsNew) return "push";
  return "none";

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

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return t("error.sync");
}

function payloadOf(data: AppData) {
  return JSON.parse(JSON.stringify({ ...data, timer: null })) as AppData;
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
  return {
    payload: data.payload as unknown as AppData,
    updatedAt: data.updated_at ? new Date(data.updated_at).getTime() : 0,
  };
}

function applyRemote(remote: { payload: AppData; updatedAt: number }) {
  replaceAll(remote.payload);
  saveMeta({
    lastSyncedAt: Date.now(),
    remoteSeenAt: remote.updatedAt,
    localChangedAt: null,
  });
}

/* ---------- Öffentliche Aktionen ---------- */

export async function backupNow(): Promise<void> {
  if (!userId) throw new Error(t("error.notSignedIn"));
  setState({ status: "syncing", message: null });
  try {
    await push(getData());
    setState({ status: "synced", pending: false, message: null, lastSyncedAt: meta.lastSyncedAt });
  } catch (error) {
    failed(error);
    throw error;
  }
}

export async function restoreNow(): Promise<boolean> {
  if (!userId) throw new Error(t("error.notSignedIn"));
  setState({ status: "syncing", message: null });
  try {
    const remote = await fetchRemote();
    if (!remote) {
      setState({ status: "idle", message: null });
      return false;
    }
    applyRemote(remote);
    setState({ status: "synced", pending: false, message: null, lastSyncedAt: meta.lastSyncedAt });
    return true;
  } catch (error) {
    failed(error);
    throw error;
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

async function autoSync(): Promise<void> {
  if (!userId) return;
  if (isOffline()) {
    setState({ status: "offline", pending: true });
    return;
  }
  setState({ status: "syncing", message: null });
  try {
    const local = getData();
    const remote = await fetchRemote();
    const decision = decideSync({
      hasLocalData: local.shifts.length > 0 || local.jobs.length > 0,
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
    if (decision === "push") await push(local);
    setState({ status: "synced", pending: false, message: null, lastSyncedAt: meta.lastSyncedAt });
  } catch (error) {
    failed(error);
  }
}

/** Debouncedes automatisches Cloud-Backup mit Offline-Queue. */
function scheduleBackup(data: AppData) {
  saveMeta({ localChangedAt: Date.now() });
  if (!userId || !data.settings.autoBackup) return;
  if (state.status === "conflict") {
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
  const next = metaForUser(meta, id);
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

  supabase.auth.getSession().then(({ data }) => {
    if (data.session) {
      userId = data.session.user.id;
      adoptUser(userId);
      setState({ signedIn: true });
      void autoSync();
    }
  });

  supabase.auth.onAuthStateChange((event, session) => {
    userId = session?.user.id ?? null;
    setState({ signedIn: userId !== null });
    if (event === "SIGNED_IN" && userId) {
      adoptUser(userId);
      void autoSync();
    }
    if (event === "SIGNED_OUT") {
      // Geplanten Push abbrechen: er würde sonst ohne Konto laufen bzw.
      // nach einem Kontowechsel in den falschen Cloud-Stand schreiben.
      if (timeout) clearTimeout(timeout);
      timeout = null;
      setState({ status: "idle", pending: false, message: null, lastSyncedAt: null });
    }
  });
}
