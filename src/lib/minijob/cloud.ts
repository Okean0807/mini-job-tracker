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
 *
 * ## PHASE 2 (data-safety) – gilt, sobald `decideSync` mit `hasLocalUserData` aufgerufen wird
 *
 * - **Cloud-Änderung = Token-Gleichheit.** Der exakte `updated_at`-String des Servers
 *   (`remoteToken`) wird nur auf Gleichheit verglichen; `lastSyncedAt` ist kein Konkurrenz-Token.
 *   Altbestand ohne Token: konservativ über `remoteSeenAt` (Millisekunden-Gleichheit).
 * - **Alle acht Sammlungen** (shifts, jobs, customers, projects, payments, goals, orders, objects)
 *   zählen als Nutzerdaten (`userDataFingerprint`, `isUserDataEmpty`). Nur Einstellungen sind
 *   ausgenommen. Ein vom Assistenten angelegter Job ist Nutzerdaten.
 * - **Erstabgleich:** automatisch wiederhergestellt wird nur ein nachweislich leeres Gerät (zweimal
 *   geprüft: bei der Inspektion und unmittelbar vor dem Anwenden). Mit Daten → `conflict`.
 * - **`dirty`** stammt aus den Änderungsmarken, unabhängig von Auto-Backup und von `pending`; er
 *   wird nur gelöscht, wenn der JETZIGE lokale Fingerprint dem hochgeladenen entspricht.
 * - **Auto-Backup AUS:** `autoSync` ist reine Inspektion (kein Upload, keine Überschreibung
 *   vorhandener Nutzerdaten). Einzige Ausnahme: die Leer-Gerät-Erstwiederherstellung. Auch ein
 *   bestätigter Import lädt nicht hoch – das tut nur die ausdrückliche Aktion `backupNow`.
 * - **Phase 4 – Schreiben:** jeder Cloud-Schreibzugriff ist bedingt (`cloud-cas.ts`: Update auf
 *   `user_id` + exakt beobachteten `updated_at`, genau eine Zeile = Erfolg; ohne Zeile `insert`;
 *   nie `upsert`). Nicht geschützt bleiben ältere App-Versionen und Service-Role-Zugriffe, die
 *   blind schreiben können – das braucht eine serverseitige Erzwingung (eigene Freigabe).
 *   Ein Schreibversuch mit unbekanntem Ergebnis (`pendingWrite`) wird bei der nächsten Inspektion
 *   geklärt (übernehmen / nicht angekommen / Konflikt) und nie blind wiederholt.
 * - **Phase 4 – Zerstörerische Aktionen** (`backupNow`, `restoreNow`, `resolveConflict`) laufen
 *   durch `runGuardedOperation` (Vergleich, Bestätigung, Snapshot der verlierenden Seite,
 *   erneute Prüfung von Konto/Scope/lokalem Stand/Remote-Token, erst dann Commit). Der
 *   automatische Abgleich übernimmt weiterhin einen neueren Cloud-Stand nur dann lokal, wenn
 *   lokal seit dem letzten Abgleich nichts geändert wurde (Auto-Backup AN) bzw. auf einem
 *   nachweislich leeren Gerät.
 */
import { useSyncExternalStore } from "react";

import { t } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

import { markBackup } from "./notify";
import {
  asBackupLike,
  fullFingerprint,
  isUserDataEmpty,
  userDataFingerprint,
} from "./backup-compare";
import { computeDirty, type BackupHealthInput } from "./backup-status";
import type { OriginClass } from "./origin-check";

import { mergeDeviceAuthFromLocal, stripDeviceAuthForCloud } from "./device-auth";
import { isValidPayload } from "./payload";
import { createActivePorts } from "./guarded-ports";
import {
  GuardedAbort,
  runGuardedOperation,
  type GuardedOperation,
  type GuardedResult,
  type Prepared,
} from "./guarded-operation";
import {
  casWrite,
  isMissingRevColumnError,
  nextToken,
  parseRev,
  resolvePendingWrite,
  type BackupsTable,
  type PendingWrite,
} from "./cloud-cas";
import { recordSyncEvent } from "./sync-diagnostics";
import {
  activateScope,
  getActiveScope,
  getActiveScopeOwner,
  getData,
  normalize,
  onDataChange,
  readStoredData,
  refreshStateFromStorage,
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
  /**
   * Exakter, vom Server gelieferter `updated_at`-String des zuletzt bekannten Cloud-Standes
   * (Phase 2). Wird NUR auf Gleichheit verglichen – nie als Zeitordnung und nicht über
   * `lastSyncedAt`. Fehlt bei Altbestand (dann gilt `remoteSeenAt`, siehe `remoteChangedSince`).
   */
  remoteToken?: string | null;
  /**
   * Stage 1: serverseitige Revision des zuletzt bekannten Cloud-Standes (Sequenz + Trigger; jede
   * Änderung durch jeden Schreiber erhöht sie). `null`/fehlt, solange das Schema keine hat.
   */
  remoteRev?: string | null;
  /** Fingerprint der acht Nutzerdaten-Sammlungen beim letzten Beobachten (nur lokal). */
  localDataFingerprint?: string | null;
  /** Zeitpunkt der letzten verifizierten Übereinstimmung (nur Erfolgspfade setzen ihn). */
  lastVerifiedAt?: number | null;
  /**
   * Phase 4: Schreibversuch mit unbekanntem Ergebnis (Timeout/Netzwerk). Wird VOR dem Senden
   * gesetzt und erst nach geklärtem Ergebnis entfernt (siehe `reconcilePendingWrite`).
   */
  pendingWrite?: PendingWrite | null;
};

const EMPTY_META: SyncMeta = {
  userId: null,
  localChangedAt: null,
  localWorkChangedAt: null,
  localWorkFingerprint: null,
  lastSyncedAt: null,
  remoteSeenAt: null,
  wizardPendingFirstSync: false,
  remoteToken: null,
  remoteRev: null,
  localDataFingerprint: null,
  lastVerifiedAt: null,
  pendingWrite: null,
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
    localDataFingerprint: current.localDataFingerprint ?? null,
    lastSyncedAt: null,
    remoteSeenAt: null,
    remoteToken: null,
    remoteRev: null,
    lastVerifiedAt: null,
    pendingWrite: null,
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
  refreshDirty();
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
export type SyncSituation = "NO_CHANGE" | "PUSH" | "RESTORE" | "CONFLICT" | "FIRST_SYNC_RESTORE";

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
  /**
   * Phase 2: hat sich die Cloud seit dem letzten bekannten Stand geändert? Wird aus dem exakten
   * Server-Token (`remoteChangedSince`) abgeleitet. Fehlt das Feld (reine Alt-Aufrufer/Tests), gilt
   * die alte Zeitstempel-Heuristik `remoteUpdatedAt > lastSyncedAt`.
   */
  remoteChanged?: boolean;
  /**
   * Phase 2: lokale Nutzerdaten in IRGENDEINER der acht Sammlungen (`!isUserDataEmpty`). Wenn
   * gesetzt, ersetzt es `hasLocalWorkData`/`hasLocalJobs`: Wizard-Jobs, Zahlungen, Ziele, Objekte,
   * Kunden, Projekte und Aufträge zählen als Daten, ein Erstabgleich mit Daten wird nie still
   * wiederhergestellt.
   */
  hasLocalUserData?: boolean;
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
  if (input.hasLocalUserData !== undefined) return decideSyncV2(input);
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

/**
 * Phase-2-Entscheidung (alle acht Sammlungen, Server-Token). Gilt, sobald `hasLocalUserData`
 * gesetzt ist. "Arbeit" bedeutet hier: Änderung in irgendeiner Nutzerdaten-Sammlung; nur
 * Einstellungen sind ausgenommen.
 */
function decideSyncV2(input: SyncDecisionInput): SyncDecision {
  const { hasRemote, localChangedAt, lastSyncedAt, remoteUpdatedAt } = input;
  const hasLocalUserData = input.hasLocalUserData === true;
  const syncedAt = lastSyncedAt ?? 0;
  // Die Cloud-Änderung kommt vom Token-Vergleich; nur ohne Token-Info die alte Heuristik.
  const remoteIsNew = input.remoteChanged ?? (remoteUpdatedAt ?? 0) > syncedAt;
  // Lokale Marken vergleichen nur lokale Uhrzeiten untereinander (keine Cloud-Aktualität).
  const localIsNew = (localChangedAt ?? 0) > syncedAt;
  const localWorkIsNew = (input.localWorkChangedAt ?? 0) > syncedAt;

  if (!hasRemote) return hasLocalUserData || localIsNew ? "push" : "none";

  // Nie abgeglichen: nur ein nachweislich leeres Gerät darf automatisch wiederherstellen.
  // Sobald irgendeine Sammlung (auch ein Wizard-Job) Daten enthält, entscheidet die Nutzerin.
  if (lastSyncedAt == null) return hasLocalUserData ? "conflict" : "restore";

  // Leeres Gerät nach bekanntem Stand: Cloud laden – außer das Leeren war eine bewusste Änderung.
  if (!hasLocalUserData && !localIsNew) return "restore";
  if (!hasLocalUserData) return remoteIsNew ? "conflict" : "push";

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
  /**
   * Ungesicherte lokale Änderungen laut Änderungsmarken – UNABHÄNGIG von Auto-Backup und von
   * `pending` (`pending === false` beweist nie, dass etwas gesichert ist).
   */
  dirty: boolean;
  /** Letzte verifizierte Übereinstimmung mit der Cloud; Fehlschläge setzen sie nie. */
  lastVerifiedAt: number | null;
  /** Die Cloud ist weiter, wurde aber (Auto-Backup aus / nicht leer) nicht automatisch geladen. */
  remoteAhead: boolean;
};

let state: SyncState = {
  status: "idle",
  pending: false,
  message: null,
  lastSyncedAt: null,
  signedIn: false,
  dirty: false,
  lastVerifiedAt: null,
  remoteAhead: false,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** `dirty` aus den Änderungsmarken neu berechnen (nie aus `pending`). */
function refreshDirty(): void {
  let hasData = false;
  try {
    hasData = !isUserDataEmpty(getData());
  } catch {
    hasData = false;
  }
  const dirty = computeDirty({
    localChangedAt: meta.localChangedAt,
    localWorkChangedAt: meta.localWorkChangedAt ?? null,
    lastSyncedAt: meta.lastSyncedAt,
    hasData,
  });
  const verified = meta.lastVerifiedAt ?? null;
  if (dirty !== state.dirty || verified !== state.lastVerifiedAt) {
    setState({ dirty, lastVerifiedAt: verified });
  }
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

/** Null Zeilen / Zeile erschien parallel: die Cloud hat sich seit der Vorbereitung verändert. */
export class CasStaleError extends Error {
  constructor() {
    super(t("error.cas.stale"));
    this.name = "CasStaleError";
  }
}

/** Das Konto existiert serverseitig nicht mehr (23503). */
export class CloudAccountGoneError extends Error {
  constructor() {
    super(t("error.cas.accountGone"));
    this.name = "CloudAccountGoneError";
  }
}

/** Auth/RLS verweigert (42501): sichere Meldung, keine Details. */
export class CloudAuthError extends Error {
  constructor() {
    super(t("error.cas.auth"));
    this.name = "CloudAuthError";
  }
}

/** Ergebnis des Schreibzugriffs unbekannt: beim nächsten Abgleich wird geprüft, nie blind wiederholt. */
export class AmbiguousWriteError extends Error {
  constructor() {
    super(t("error.cas.ambiguous"));
    this.name = "AmbiguousWriteError";
  }
}

/**
 * Eingabe für `deriveBackupHealth` aus dem Sync-Zustand. Die Herkunft (`origin`) wird VON AUSSEN
 * übergeben und ist unabhängig vom Sicherungszustand (sie verdeckt keine Daten-/Fehlerzustände).
 */
export function getBackupHealthInput(
  origin: OriginClass,
  now: number = Date.now(),
): BackupHealthInput {
  const data = getData();
  return {
    signedIn: userId !== null,
    scopeKind: getActiveScope().kind,
    origin,
    hasData: !isUserDataEmpty(data),
    autoBackup: data.settings.autoBackup !== false,
    online: !isOffline(),
    syncStatus: state.status,
    dirty: state.dirty,
    lastVerifiedAt: state.lastVerifiedAt,
    now,
  };
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
 * Kennt das Cloud-Schema die serverseitige Revision `rev` (Stage 1)? Gilt je Seitenaufruf:
 *  - `unknown`: noch nicht festgestellt – die erste Anfrage fragt `rev` mit an;
 *  - `yes`: die Cloud hat `rev` geliefert;
 *  - `no`: ein BESTÄTIGTER Fehler "Spalte rev fehlt" (42703/PGRST204, Meldung nennt `rev`) – ab dann
 *    wird `rev` in dieser Sitzung nicht mehr angefragt (kein wiederholtes Probieren); es gilt der
 *    exakte `updated_at`-CAS. Ein neuer Seitenaufruf prüft einmal erneut (z. B. nach der Migration).
 */
let revSupport: "unknown" | "yes" | "no" = "unknown";

function markRevUnsupported(): void {
  if (revSupport === "no") return;
  revSupport = "no";
  recordSyncEvent(getActiveScope(), "rev-fallback");
  // Eine veraltete Revision darf nach einer späteren erneuten Migration nichts Falsches vergleichen.
  saveMeta({ remoteRev: null });
}

/**
 * Push local payload per Compare-and-Swap (kein `upsert`). Clears change marks after success.
 * `observedToken` ist der zuvor gesehene `updated_at` der Cloud (`null` = es gab keine Zeile).
 * When `preserveIfNewerThan` is set (autoSync), marks that were bumped *during*
 * the sync (≠ watermark) are kept so pending retry still runs.
 */
async function push(
  data: AppData,
  preserveIfNewerThan: { local: number | null; work: number | null } | undefined,
  isCurrent: (() => boolean) | undefined,
  observedToken: string | null,
  observedRev: string | null,
): Promise<void> {
  if (!userId) throw new Error(t("error.notSignedIn"));
  // Owner guard: only ever upload data that was loaded from THIS account's namespace.
  if (!ownsLoadedData()) throw new Error(t("error.accountMismatch"));
  // Vor dem await festhalten: wohin die Metadaten gehören.
  const snap = snapshotOwner();
  const uid = userId;
  const payload = payloadOf(data);
  const token = nextToken(observedToken);
  // Vor dem Senden festhalten: bei unklarem Ergebnis (Timeout) entscheidet die nächste Inspektion.
  saveMeta({
    pendingWrite: {
      observedToken,
      observedRev,
      attemptedToken: token,
      fingerprint: fullFingerprint(asBackupLike(payload)),
      at: Date.now(),
    },
  });
  const table = supabase.from("backups") as unknown as BackupsTable;
  let outcome = await casWrite({
    table,
    userId: uid,
    observedToken,
    observedRev,
    payload,
    token,
    useRev: revSupport !== "no",
  });
  if (outcome.kind === "rev-unsupported") {
    // BESTÄTIGT: das Schema hat keine Spalte `rev` – die Anfrage hat nichts geschrieben. Für den Rest
    // der Sitzung wird `rev` nicht mehr angefragt; genau EINE Wiederholung mit dem exakten
    // `updated_at`-Filter (gleicher beobachteter Token → weiterhin bedingt, nie blind).
    markRevUnsupported();
    outcome = await casWrite({ table, userId: uid, observedToken, payload, token, useRev: false });
  }
  // Post-await-Guard: Konto/Scope gewechselt oder der Sync-Lauf wurde bereits
  // abgebrochen (z. B. Timeout) → keine Meta, kein markBackup, kein "synced". Ein gesetzter
  // `pendingWrite` bleibt und wird in diesem Namensraum bei der nächsten Inspektion geklärt.
  if (!stillOwner(snap) || (isCurrent && !isCurrent())) throw new StaleSyncError();
  if (outcome.kind !== "written") {
    if (outcome.kind === "ambiguous") {
      recordSyncEvent(getActiveScope(), "ambiguous-write");
      throw new AmbiguousWriteError();
    }
    saveMeta({ pendingWrite: null }); // eindeutig NICHT geschrieben
    if (outcome.kind === "stale") {
      recordSyncEvent(getActiveScope(), "cas-stale");
      throw new CasStaleError();
    }
    if (outcome.kind === "account-gone") throw new CloudAccountGoneError();
    if (outcome.kind === "forbidden") throw new CloudAuthError();
    throw new Error(t("error.sync"));
  }
  if (outcome.rev !== null) revSupport = "yes";
  if (outcome.rev !== null) revSupport = "yes";
  const ts = outcome.updatedAtMs;
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
  // "Sauber" nur, wenn der JETZIGE lokale Stand dem hochgeladenen entspricht: Änderungen, die
  // nach dem Bau des Payloads entstanden sind (auch ohne Marken-Wechsel), bleiben ungesichert.
  const current = getData();
  if (fullFingerprint(current) !== fullFingerprint(data)) {
    const now = Date.now();
    nextLocal = nextLocal ?? meta.localChangedAt ?? now;
    if (userDataFingerprint(current) !== userDataFingerprint(data)) {
      nextWork = nextWork ?? meta.localWorkChangedAt ?? now;
    }
  }
  saveMeta({
    lastSyncedAt: ts,
    remoteSeenAt: ts,
    // Exakter, vom Server zurückgegebener Token des soeben geschriebenen Standes.
    remoteToken: outcome.token,
    remoteRev: outcome.rev,
    pendingWrite: null,
    lastVerifiedAt: ts,
    localChangedAt: nextLocal,
    localWorkChangedAt: nextWork,
    localWorkFingerprint: workFingerprint(data),
    localDataFingerprint: userDataFingerprint(current),
    wizardPendingFirstSync: false,
  });
  if (state.remoteAhead) setState({ remoteAhead: false });
  // Auch automatische Backups als frisch markieren, sonst meldet die
  // Backup-Erinnerung fälschlich einen veralteten Stand.
  markBackup();
}

/**
 * Unklares Ergebnis eines früheren Schreibversuchs klären (nächste Inspektion):
 * gleicher Token + gleicher Inhalt → übernehmen; beobachteter Token unverändert → nicht
 * angekommen (neu vorbereiten, kein blindes Wiederholen); sonst → Konflikt.
 */
function reconcilePendingWrite(remote: RemoteSnapshot | null): void {
  const pending = meta.pendingWrite;
  if (!pending) return;
  const resolution = resolvePendingWrite(
    pending,
    remote
      ? {
          token: remote.token,
          fingerprint: fullFingerprint(asBackupLike(remote.payload)),
          rev: remote.rev ?? null,
        }
      : null,
  );
  const now = Date.now();
  if (resolution === "adopt" && remote) {
    const current = getData();
    const same = fullFingerprint(current) === pending.fingerprint;
    saveMeta({
      pendingWrite: null,
      lastSyncedAt: remote.updatedAt,
      remoteSeenAt: remote.updatedAt,
      remoteToken: remote.token,
      remoteRev: remote.rev ?? null,
      lastVerifiedAt: now,
      localChangedAt: same ? null : (meta.localChangedAt ?? now),
      localWorkChangedAt:
        userDataFingerprint(current) === userDataFingerprint(remote.payload)
          ? null
          : (meta.localWorkChangedAt ?? now),
      localWorkFingerprint: workFingerprint(current),
      localDataFingerprint: userDataFingerprint(current),
      wizardPendingFirstSync: false,
    });
    markBackup();
    return;
  }
  if (resolution === "not-landed") {
    saveMeta({ pendingWrite: null });
    return;
  }
  // Konflikt: lokale Änderungsmarken sicherstellen, damit die Entscheidung nie "kein Konflikt" ergibt.
  saveMeta({
    pendingWrite: null,
    localChangedAt: meta.localChangedAt ?? now,
    localWorkChangedAt: meta.localWorkChangedAt ?? now,
  });
}

type RemoteSnapshot = {
  payload: AppData;
  updatedAt: number;
  token: string;
  /** Serverrevision (exakt, als Zeichenkette); `null`, wenn das Schema keine hat. */
  rev?: string | null;
};

/**
 * Hat sich die Cloud seit dem zuletzt bekannten Stand geändert? NUR Gleichheit des exakten
 * Server-Tokens (`updated_at` als String), keine Zeitordnung und kein `lastSyncedAt`.
 *
 * Altbestand ohne Token: konservativ über das numerische `remoteSeenAt` (Millisekunden-Gleichheit
 * mit dem Server-Wert). Ohne jedes bekannte Token gilt die Cloud als geändert.
 */
export function remoteChangedSince(
  remote: { token: string; updatedAt: number; rev?: string | null } | null,
  known: {
    remoteToken?: string | null;
    remoteSeenAt?: number | null;
    remoteRev?: string | null;
  },
): boolean {
  if (!remote) return false;
  // Stage 1: eine geänderte Revision ist IMMER eine Änderung – auch wenn der Token gleich blieb
  // (Schreiber, der `updated_at` nicht fortschreibt).
  if (remote.rev != null && known.remoteRev != null && remote.rev !== known.remoteRev) return true;
  if (typeof known.remoteToken === "string" && known.remoteToken !== "") {
    return remote.token !== known.remoteToken;
  }
  if (typeof known.remoteSeenAt === "number") return remote.updatedAt !== known.remoteSeenAt;
  return true;
}

async function fetchRemote(): Promise<RemoteSnapshot | null> {
  if (!userId) throw new Error(t("error.notSignedIn"));
  const table = supabase.from("backups") as unknown as BackupsTable;
  const read = (columns: string) => table.select(columns).eq("user_id", userId!).maybeSingle();
  let result = await read(revSupport === "no" ? "payload, updated_at" : "payload, updated_at, rev");
  if (
    revSupport !== "no" &&
    isMissingRevColumnError(result.error as { code?: string; message?: string } | null)
  ) {
    // Bestätigt: kein `rev` im Schema. Lesen schreibt nichts → genau eine Wiederholung ohne `rev`.
    markRevUnsupported();
    result = await read("payload, updated_at");
  }
  const { data: raw, error } = result;
  if (error) throw error;
  const data = raw as { payload?: unknown; updated_at?: string | null; rev?: unknown } | null;
  if (!data?.payload) return null;
  if (!isValidPayload(data.payload)) throw new Error(t("error.syncPayload"));
  const rev = parseRev(data.rev);
  if (rev !== null) revSupport = "yes";
  return {
    payload: data.payload as unknown as AppData,
    updatedAt: data.updated_at ? new Date(data.updated_at).getTime() : 0,
    token: data.updated_at ? String(data.updated_at) : "",
    rev,
  };
}

/** Zuletzt gezählte Cloud-Revision (je Seitenaufruf): jede Revision wird höchstens EINMAL gezählt. */
let lastCountedRemoteRev: string | null = null;

/**
 * Beobachtbarkeit (nur Zähler, siehe `sync-diagnostics.ts`): ist die Cloud-Revision seit dem letzten
 * Stand dieses Geräts gestiegen, ohne dass dieses Gerät geschrieben hat?
 *  - Token ebenfalls gestiegen → üblicher Schreiber (aktueller oder älterer Client);
 *  - Token gleich oder älter → ein Schreiber, der den Token nicht fortschreibt (aktuelle Clients
 *    tun das immer): älterer Client mit falscher Uhr, direkter API-Aufruf, Betrieb.
 */
function observeRemoteAdvance(remote: RemoteSnapshot | null): void {
  if (!remote || remote.rev == null || meta.remoteRev == null) return;
  if (remote.rev === meta.remoteRev || remote.rev === lastCountedRemoteRev) return;
  lastCountedRemoteRev = remote.rev;
  const scope = getActiveScope();
  if (remote.updatedAt > (meta.remoteSeenAt ?? 0)) recordSyncEvent(scope, "remote-advanced");
  else recordSyncEvent(scope, "remote-advanced-token-flat");
}

/**
 * Mehrere Tabs: ein anderer Tab desselben Browsers kann Daten UND Sync-Metadaten dieses Scopes
 * geschrieben haben (`localStorage` ist gemeinsam, der Arbeitsspeicher nicht). Dieser Tab übernimmt
 * dann deren Stand. Liefert `true`, wenn etwas übernommen wurde – ein laufender Abgleich verwirft
 * dann seine (veraltete) Entscheidung und beginnt neu, statt auf Basis alter Marken zu überschreiben.
 */
function adoptOtherTabChanges(): boolean {
  const dataChanged = refreshStateFromStorage();
  let changed = dataChanged;
  let metaChanged = false;
  if (typeof window === "undefined") return changed;
  try {
    const raw = window.localStorage.getItem(metaKey);
    if (raw) {
      const stored = { ...EMPTY_META, ...(JSON.parse(raw) as Partial<SyncMeta>) };
      const mine = JSON.parse(JSON.stringify(meta)) as SyncMeta;
      if (stableStringify(stored) !== stableStringify(mine)) {
        meta = stored;
        refreshDirty();
        changed = true;
        metaChanged = true;
      }
    }
  } catch {
    /* unlesbare Metadaten: wie bisher mit dem Arbeitsspeicher weiterarbeiten */
  }
  // Fremde Datenänderung OHNE passende Änderungsmarken (Schreiber, der nicht mitgezählt hat):
  // konservativ als ungesicherte lokale Änderung behandeln – nie als "unverändert".
  if (dataChanged && !metaChanged) {
    const now = Date.now();
    saveMeta({
      localChangedAt: meta.localChangedAt ?? now,
      localWorkChangedAt: meta.localWorkChangedAt ?? now,
    });
  }
  return changed;
}

let applyingRemote = false;
/** Gesetzt, wenn ein Abgleich wegen Änderungen eines anderen Tabs verworfen wurde (einmalige Wiederholung). */
let rerunAfterOtherTab = false;

function applyRemote(
  remote: { payload: AppData; updatedAt: number; token?: string; rev?: string | null },
  options: { adoptLegacyPin: boolean } = { adoptLegacyPin: false },
) {
  // Der laufende Timer wird bewusst nie in die Cloud geschrieben (`payloadOf`).
  // Beim Wiederherstellen darf er deshalb auch nicht gelöscht werden – sonst
  // verliert der Nutzer die bereits laufende, noch nicht gespeicherte Zeit.
  // PIN / WebAuthn bleiben gerätelokal. Option C (Stage 1): eine ALTE Klartext-PIN im Cloud-Stand
  // darf NUR bei einer ausdrücklich bestätigten, manuellen Wiederherstellung übernommen werden
  // (`adoptLegacyPin`); die beiden automatischen Wege entfernen sie vorher.
  const local = getData();
  const runningTimer = local.timer ?? null;
  const merged = mergeDeviceAuthFromLocal(
    options.adoptLegacyPin ? remote.payload : stripDeviceAuthForCloud(remote.payload),
    local,
  );
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
  // Das echte Server-Token des wiederhergestellten Standes merken (nicht `lastSyncedAt`).
  saveMeta({
    lastSyncedAt: Date.now(),
    remoteSeenAt: remote.updatedAt,
    remoteToken: remote.token ?? null,
    remoteRev: remote.rev ?? null,
    lastVerifiedAt: Date.now(),
    localChangedAt: null,
    localWorkChangedAt: null,
    localWorkFingerprint: workFingerprint(safePayload),
    localDataFingerprint: userDataFingerprint(safePayload),
    wizardPendingFirstSync: false,
  });
  if (state.remoteAhead) setState({ remoteAhead: false });
}

/* ---------- Öffentliche Aktionen ---------- */

/**
 * Ein einzelner Cloud-Zugriff unter dem Sync-Mutex (nie parallel zu autoSync/anderen Aktionen).
 * Gehalten wird er NUR während des Zugriffs, nicht während der Bestätigung durch den Nutzer.
 */
async function cloudIo<T>(
  work: (epoch: number) => Promise<T>,
  finish: (value: T) => void,
): Promise<T> {
  if (syncing) throw new GuardedAbort("lock-busy");
  syncing = true;
  const epoch = ++syncEpoch;
  setState({ status: "syncing", message: null });
  armSyncWatchdog(epoch);
  try {
    const value = await withSyncTimeout(work(epoch));
    // Lauf wurde abgebrochen (Kontowechsel/Timeout): nie als Erfolg melden.
    if (epoch !== syncEpoch) throw new StaleSyncError();
    finish(value);
    return value;
  } catch (error) {
    if (error instanceof StaleSyncError) abandonStaleEpoch(epoch);
    else if (error instanceof CasStaleError) abandonWithConflict(epoch);
    else abandonSyncEpoch(epoch, error);
    throw error;
  } finally {
    if (epoch === syncEpoch) {
      clearSyncWatchdog();
      syncing = false;
    }
  }
}

/** Lesender Zugriff (Vorbereitung/Revalidierung): Status danach wie vorher, nichts wird "synced". */
function inspectCloud(snap: OwnerSnapshot): Promise<RemoteSnapshot | null> {
  const previous = { status: state.status, message: state.message };
  return cloudIo(
    async () => {
      const remote = await fetchRemote();
      if (!stillOwner(snap)) throw new StaleSyncError();
      return remote;
    },
    () =>
      setState({
        status: previous.status === "syncing" ? "idle" : previous.status,
        message: previous.message,
      }),
  );
}

/** Beide Seiten inhaltlich gleich: Basis auf den Cloud-Stand setzen (kein Schreiben, kein Ersetzen). */
function rebaselineToRemote(remote: RemoteSnapshot): void {
  const local = getData();
  const now = Date.now();
  const settingsEqual = fullFingerprint(local) === fullFingerprint(asBackupLike(remote.payload));
  saveMeta({
    lastSyncedAt: remote.updatedAt,
    remoteSeenAt: remote.updatedAt,
    remoteToken: remote.token,
    remoteRev: remote.rev ?? null,
    lastVerifiedAt: now,
    localChangedAt: settingsEqual ? null : now,
    localWorkChangedAt: null,
    localWorkFingerprint: workFingerprint(local),
    localDataFingerprint: userDataFingerprint(local),
    wizardPendingFirstSync: false,
  });
  setState({
    status: "synced",
    pending: !settingsEqual,
    remoteAhead: false,
    message: null,
    lastSyncedAt: meta.lastSyncedAt,
  });
}

/** Würde `mergeDeviceAuthFromLocal` eine (alte) PIN aus dem Cloud-Stand auf dieses Gerät übernehmen? */
function wouldAdoptRemotePin(local: AppData, remote: AppData): boolean {
  const merged = mergeDeviceAuthFromLocal(remote, local).settings;
  return merged.pin !== undefined && merged.pin !== local.settings.pin;
}

/** Token UND (falls bekannt) Revision unverändert? Eine geänderte Revision ist immer eine Änderung. */
function sameRemote(
  remote: RemoteSnapshot | null,
  prepared: { remoteToken?: string | null; remoteRev?: string | null },
): boolean {
  if ((remote?.token ?? null) !== (prepared.remoteToken ?? null)) return false;
  if (remote?.rev != null && prepared.remoteRev != null) return remote.rev === prepared.remoteRev;
  return true;
}

/** Cloud-Sicherung erstellen/überschreiben (auch "Lokal behalten"): Vergleich → Snapshot → CAS. */
function backupOperation(
  kind: "cloud-backup" | "conflict-keep-local",
  snap: OwnerSnapshot,
): GuardedOperation {
  let observed: RemoteSnapshot | null = null;
  return {
    kind,
    async prepare({ local }) {
      observed = await inspectCloud(snap);
      reconcileAfterInspection(observed);
      return {
        incoming: payloadOf(local),
        losing: observed?.payload ?? null,
        snapshotKind: "cloud_pre_overwrite",
        replaces: "cloud",
        remoteToken: observed?.token ?? null,
        remoteRev: observed?.rev ?? null,
      };
    },
    async revalidateRemote(prepared) {
      return sameRemote(await inspectCloud(snap), prepared);
    },
    async commit(prepared, { local }) {
      await cloudIo(
        (epoch) =>
          push(
            local,
            undefined,
            () => epoch === syncEpoch,
            prepared.remoteToken ?? null,
            prepared.remoteRev ?? null,
          ),
        () =>
          setState({
            status: "synced",
            pending: false,
            message: null,
            lastSyncedAt: meta.lastSyncedAt,
          }),
      );
    },
    onIdentical() {
      if (observed) rebaselineToRemote(observed);
    },
  };
}

/** Cloud-Stand lokal übernehmen (auch "Cloud behalten"): Vergleich → Snapshot lokal → Übernahme. */
function restoreOperation(
  kind: "cloud-restore" | "conflict-keep-cloud",
  snap: OwnerSnapshot,
): GuardedOperation {
  let observed: RemoteSnapshot | null = null;
  return {
    kind,
    async prepare({ local }) {
      observed = await inspectCloud(snap);
      reconcileAfterInspection(observed);
      if (!observed) throw new GuardedAbort("remote-missing");
      return {
        incoming: observed.payload,
        losing: local,
        snapshotKind: "local_pre_restore",
        replaces: "local",
        remoteToken: observed.token,
        remoteRev: observed.rev ?? null,
        deviceAuth: wouldAdoptRemotePin(local, observed.payload) ? "adopted" : "kept",
      };
    },
    async revalidateRemote(prepared) {
      return sameRemote(await inspectCloud(snap), prepared);
    },
    commit() {
      if (!observed || !stillOwner(snap)) throw new GuardedAbort("scope-changed");
      // Bestätigte, manuelle Wiederherstellung (Vorschau zeigt die Warnung): Alt-PIN darf übernommen werden.
      applyRemote(observed, { adoptLegacyPin: true }); // behält lokale PIN/Biometrie und den Timer
      setState({
        status: "synced",
        pending: false,
        message: null,
        lastSyncedAt: meta.lastSyncedAt,
      });
    },
    onIdentical() {
      if (observed) rebaselineToRemote(observed);
    },
  };
}

/** Nach jeder Inspektion: unklares früheres Schreibergebnis klären. */
function reconcileAfterInspection(remote: RemoteSnapshot | null): void {
  reconcilePendingWrite(remote);
}

/** Konto/Scope-Wechsel mitten im Cloud-Zugriff ist ein stiller Abbruch ("scope-changed"). */
function mapStaleToAbort(op: GuardedOperation): GuardedOperation {
  const guard = async <T>(work: () => Promise<T> | T): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof StaleSyncError) throw new GuardedAbort("scope-changed");
      throw error;
    }
  };
  return {
    ...op,
    prepare: (ctx) => guard(() => op.prepare(ctx)),
    commit: (prepared, ctx) => guard(() => op.commit(prepared, ctx)),
    ...(op.revalidateRemote
      ? { revalidateRemote: (prepared: Prepared) => guard(() => op.revalidateRemote!(prepared)) }
      : {}),
  };
}

async function runCloudOperation(
  build: (snap: OwnerSnapshot) => GuardedOperation,
): Promise<GuardedResult> {
  if (!userId) throw new Error(t("error.notSignedIn"));
  if (!ownsLoadedData()) throw new Error(t("error.accountMismatch"));
  const snap = snapshotOwner();
  const result = await runGuardedOperation(
    mapStaleToAbort(build(snap)),
    createActivePorts(() => stillOwner(snap)),
  );
  // Ein durch Konto-/Scope-Wechsel überholter Lauf hinterlässt keinen fremden "synced"-Status.
  if (result.status === "aborted" && result.reason === "scope-changed" && !syncing) {
    setState({ status: "idle", message: null });
  }
  return result;
}

/** "Cloud-Backup erstellen": inspizieren, vergleichen, bestätigen, Cloud-Kopie sichern, per CAS schreiben. */
export function backupNow(): Promise<GuardedResult> {
  return runCloudOperation((snap) => backupOperation("cloud-backup", snap));
}

/** Cloud-Sicherung lokal übernehmen: inspizieren, vergleichen, bestätigen, lokalen Stand sichern. */
export function restoreNow(): Promise<GuardedResult> {
  return runCloudOperation((snap) => restoreOperation("cloud-restore", snap));
}

/** Nutzerentscheidung bei einem Konflikt – dieselben geschützten Abläufe, kein blindes Überschreiben. */
export function resolveConflict(keep: "local" | "cloud"): Promise<GuardedResult> {
  return runCloudOperation((snap) =>
    keep === "local"
      ? backupOperation("conflict-keep-local", snap)
      : restoreOperation("conflict-keep-cloud", snap),
  );
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

/** CAS meldete einen parallelen Cloud-Stand: Konfliktstatus (Nutzer vergleicht und entscheidet). */
function abandonWithConflict(epoch: number): void {
  if (epoch !== syncEpoch) return;
  clearSyncWatchdog();
  syncing = false;
  syncEpoch += 1;
  setState({ status: "conflict", pending: true, message: null });
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

/**
 * Automatischer Wiederherstellen-Pfad für ein NACHWEISLICH leeres Gerät (einzige automatische
 * Ausnahme, auch bei Auto-Backup AUS). Zweite Prüfung unmittelbar vor dem Anwenden: alle acht
 * Sammlungen noch leer, dasselbe Konto und derselbe Namensraum, derselbe Sync-Lauf.
 */
function restoreIfVerifiedEmpty(
  remote: RemoteSnapshot,
  snap: OwnerSnapshot,
  epoch: number,
): boolean {
  if (epoch !== syncEpoch) return false;
  if (!stillOwner(snap)) return false;
  if (!isUserDataEmpty(getData())) return false;
  applyRemote(remote);
  return true;
}

/**
 * Abgleich mit der Cloud. Auto-Backup AUS (`settings.autoBackup === false`) bedeutet: absolut kein
 * automatischer Upload und keine automatische Überschreibung vorhandener Nutzerdaten – der Lauf
 * ist dann reine Inspektion (lesen, klassifizieren, Status setzen). Ausnahmen: die nachweislich
 * leere Erst-Wiederherstellung (`restoreIfVerifiedEmpty`). Auch ein bestätigter lokaler Import
 * löst bei Auto-Backup AUS keinen Upload aus; dafür gibt es nur die ausdrückliche, getrennte
 * Aktion `backupNow`.
 */
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
  let changedAtStart = meta.localChangedAt;
  let workChangedAtStart = meta.localWorkChangedAt ?? null;
  const snap = snapshotOwner();
  setState({ status: "syncing", message: null });
  armSyncWatchdog(epoch);
  try {
    // Single wall-clock race for fetch+decide+push (not per-call clocks that can stack).
    await withSyncTimeout(
      (async () => {
        const remote = await fetchRemote();
        // After forceFail / watchdog / timeout abandon, late fetch must not mutate.
        if (epoch !== syncEpoch) return;
        // Mid-flight-Guard: Namensraum/Konto während des Fetch gewechselt → weder
        // Re-Baseline, Konfliktstatus, Restore noch Push (alles würde fremde Meta treffen).
        if (!stillOwner(snap)) return;
        // Anderer Tab hat Daten/Marken geändert: diese Entscheidung wäre veraltet → neu beginnen.
        if (adoptOtherTabChanges()) {
          setState({ status: "idle", pending: true, message: null });
          rerunAfterOtherTab = true;
          return;
        }
        // Unklares früheres Schreibergebnis (Timeout) zuerst klären – nie blind wiederholen.
        reconcilePendingWrite(remote);
        observeRemoteAdvance(remote);
        // Inspektionszeitpunkt: der AKTUELLE lokale Stand (nicht der vor dem Fetch).
        const local = getData();
        const uploadAllowed = local.settings.autoBackup !== false;
        const hasLocalUserData = !isUserDataEmpty(local);
        const dataEqual =
          remote !== null && userDataFingerprint(local) === userDataFingerprint(remote.payload);
        const settingsEqual =
          remote !== null && fullFingerprint(local) === fullFingerprint(remote.payload);
        const remoteChanged = remoteChangedSince(remote, meta);

        // Quiet re-baseline when the user data is semantically identical (all eight collections,
        // normalize-safe). No replaceAll / upsert; a settings-only difference stays marked as a
        // local change so it is neither lost nor shown as "clean".
        const quietRebaseline = () => {
          if (!remote) return;
          const now = Date.now();
          saveMeta({
            lastSyncedAt: remote.updatedAt,
            remoteSeenAt: remote.updatedAt,
            remoteToken: remote.token,
            remoteRev: remote.rev ?? null,
            lastVerifiedAt: now,
            localChangedAt: settingsEqual ? null : now,
            localWorkChangedAt: null,
            localWorkFingerprint: workFingerprint(local),
            localDataFingerprint: userDataFingerprint(local),
            wizardPendingFirstSync: false,
          });
          setState({
            status: "synced",
            pending: !settingsEqual,
            remoteAhead: false,
            message: null,
            lastSyncedAt: meta.lastSyncedAt,
          });
        };

        if (dataEqual && meta.lastSyncedAt == null && hasLocalUserData) {
          quietRebaseline();
          return;
        }

        // Lokale Nutzerdaten weichen ab, obwohl die Cloud seit dem bekannten Stand unverändert ist
        // und keine Änderungsmarke existiert (Altbestand, Import): jetzt als Änderung markieren.
        if (
          remote !== null &&
          !remoteChanged &&
          !dataEqual &&
          meta.lastSyncedAt != null &&
          meta.localWorkChangedAt == null
        ) {
          const now = Date.now();
          saveMeta({ localChangedAt: meta.localChangedAt ?? now, localWorkChangedAt: now });
          changedAtStart = meta.localChangedAt;
          workChangedAtStart = meta.localWorkChangedAt ?? null;
        }

        const decisionInput = {
          hasLocalWorkData: hasLocalUserData,
          hasLocalUserData,
          hasRemote: remote !== null,
          remoteChanged,
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
          if (dataEqual) {
            quietRebaseline();
            return;
          }
          setState({ status: "conflict", pending: true, message: null });
          return;
        }

        if (decision === "restore" && remote) {
          if (!hasLocalUserData) {
            // Erste Prüfung (oben) + zweite unmittelbar vor dem Anwenden.
            if (!restoreIfVerifiedEmpty(remote, snap, epoch)) {
              setState({ status: "idle", message: null });
              return;
            }
          } else if (uploadAllowed && remote.updatedAt < (meta.remoteSeenAt ?? 0)) {
            // Rückschritt: der Cloud-Token ist ÄLTER als der zuletzt gesehene. Mit CAS-Clients wächst
            // der Token nur (nächster Token > beobachteter). Ein Rückschritt deutet auf eine
            // zurückgesetzte Datenbank oder einen Schreiber mit falscher Uhr hin: der lokale Stand
            // kann dann die einzige Kopie der neueren Daten sein → nie automatisch ersetzen.
            recordSyncEvent(getActiveScope(), "token-regression");
            setState({ status: "idle", message: null, remoteAhead: true });
            return;
          } else if (uploadAllowed) {
            // Cloud geändert, lokale Nutzerdaten seit dem Abgleich unverändert.
            applyRemote(remote);
          } else {
            // Auto-Backup AUS: vorhandene Nutzerdaten werden nie automatisch überschrieben.
            setState({ status: "idle", message: null, remoteAhead: true });
            return;
          }
        }
        if (epoch !== syncEpoch) return;

        if (decision === "push") {
          if (!uploadAllowed) {
            // Auto-Backup AUS: kein Upload – die Änderungen bleiben sichtbar ungesichert (dirty).
            setState({ status: "idle", pending: true, message: null });
            return;
          }
          await push(
            local,
            { local: changedAtStart, work: workChangedAtStart },
            () => epoch === syncEpoch,
            remote?.token ?? null,
            remote?.rev ?? null,
          );
        }
        if (epoch !== syncEpoch) return;
        if (decision === "none" && remote && !remoteChanged) {
          // Verifiziert: Cloud-Token unverändert und keine lokale Änderung seit dem Abgleich.
          saveMeta({
            remoteToken: remote.token,
            remoteRev: remote.rev ?? meta.remoteRev ?? null,
            lastVerifiedAt: Date.now(),
          });
        }
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
      })(),
    );
  } catch (error) {
    // Die Cloud hat sich seit der Inspektion verändert: Konflikt (neu vergleichen), kein Fehler.
    if (error instanceof CasStaleError) abandonWithConflict(epoch);
    else abandonSyncEpoch(epoch, error);
  } finally {
    if (epoch === syncEpoch) {
      clearSyncWatchdog();
      syncing = false;
    }
  }
  // Ein anderer Tab hat währenddessen etwas geändert: einmal mit dem übernommenen Stand neu prüfen.
  if (rerunAfterOtherTab) {
    rerunAfterOtherTab = false;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => void autoSync(), 0);
    return;
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
  const dataFp = userDataFingerprint(data);
  const prevDataFp = meta.localDataFingerprint ?? null;
  const patch: Partial<SyncMeta> = {
    localChangedAt: now,
    localWorkFingerprint: fp,
    localDataFingerprint: dataFp,
  };
  // Nutzerdaten-Marke: Änderung in IRGENDEINER der acht Sammlungen (Einstellungen allein nicht).
  // Ein fehlender Vorwert wird ohne Marke gesetzt (Altbestand/Erststart); für Altbestand ohne den
  // neuen Fingerprint gilt weiter der alte Schichten-/Jobs-Vergleich als Rückfall.
  const dataChanged =
    prevDataFp !== null ? prevDataFp !== dataFp : prevFp !== null && prevFp !== fp;
  if (dataChanged) patch.localWorkChangedAt = now;
  // Die Marken werden IMMER gesetzt (auch bei Auto-Backup AUS) → `dirty` bleibt sichtbar.
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
    // (Token), und meldet einen Konflikt, statt fremde Änderungen zu verlieren.
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
  if (meta.localDataFingerprint == null) {
    meta = { ...meta, localDataFingerprint: userDataFingerprint(getData()) };
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
  setState({
    status: "idle",
    pending: false,
    message: null,
    lastSyncedAt: meta.lastSyncedAt,
    remoteAhead: false,
  });
  refreshDirty();
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
  // Kein Sonderrecht für den Import: Auto-Backup AN → normaler Abgleich (wie jede Änderung);
  // Auto-Backup AUS → nur Inspektion, KEIN Upload. Hochladen importierter Daten verlangt dann
  // die getrennte, ausdrückliche Aktion "Cloud-Backup erstellen" (`backupNow`).
  void autoSync();
}

/**
 * Nach einer bestätigten lokalen Ersetzung (JSON-Import, Snapshot-Wiederherstellung): im
 * angemeldeten Konto als geändert markieren – ohne Upload bei Auto-Backup AUS. Ohne Konto
 * (Gast/Testmodus) gibt es keine Cloud-Basis, die zu markieren wäre.
 */
export function markLocalReplacementForSync(): void {
  if (!ownsLoadedData()) return;
  markExplicitImportForSync();
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

  // Ein anderer Tab hat die Sync-Metadaten dieses Scopes geschrieben (Marken, Token): übernehmen.
  window.addEventListener("storage", (event) => {
    if (event.key === metaKey) adoptOtherTabChanges();
  });

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

/** Nur für Tests: interne Bausteine, die sonst nicht erreichbar sind. */
export const __testing = {
  snapshotOwner,
  restoreIfVerifiedEmpty,
  getSyncEpoch: () => syncEpoch,
  getMeta: () => meta,
};
