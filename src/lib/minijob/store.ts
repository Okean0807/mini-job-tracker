import { useSyncExternalStore } from "react";

import { LANGUAGES, detectLanguage } from "@/lib/i18n/core";

import { normalizeDashboard } from "./dashboard";
import { isPlainRecord } from "./payload";
import { isValidPin, withConsistentPinSettings } from "./pin";
import { KNOWN_LEGAL_MONTHLY_LIMITS } from "./legal";
import {
  GUEST_SCOPE,
  ownerOfScope,
  persistScopePointer,
  readScopePointer,
  sameScope,
  scopedKey,
  type StorageScope,
} from "./storage-scope";
import { applyAppearance } from "./theme";
import {
  ensureCustomTasksFromShifts,
  ensureWorkCodesFromShifts,
  isBuiltinWorkCode,
  learnSavedValuesFromShift,
  normalizeCatalogText,
  normalizeTaskCompare,
  normalizeWorkCode,
} from "./catalog";
import {
  clearObjectIdFromShifts,
  ensureObjectsFromShifts,
  linkShiftToObject,
  upsertObjectFromShiftAddress,
} from "./work-objects";
import {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_SETTINGS,
  DEFAULT_SUPPLEMENTS,
  JOB_COLORS,
  type AppData,
  type Customer,
  type Goal,
  type Job,
  type Order,
  type Payment,
  type Project,
  type RunningTimer,
  type Settings,
  type Shift,
  type WorkCodeDef,
  type WorkObject,
} from "./types";

/**
 * Basis-Schlüssel. Gespeichert wird immer pro Scope (`<base>:u:<userId>`,
 * `<base>:demo`, `<base>:guest`). Der alte globale Schlüssel ohne Suffix ist
 * Legacy und wird hier weder gelesen noch beschrieben (siehe storage-scope.ts).
 */
export const STORAGE_KEY_BASE = "minijob-tracker-v1";

/* ---------- Aktiver Namensraum (Konto / Testmodus / Gast) ---------- */

let activeScope: StorageScope = GUEST_SCOPE;
const scopeListeners = new Set<(scope: StorageScope) => void>();

export function getActiveScope(): StorageScope {
  return activeScope;
}

/** Besitzer (Supabase user.id) der aktuell geladenen Daten; null = Gast/Testmodus. */
export function getActiveScopeOwner(): string | null {
  return ownerOfScope(activeScope);
}

export function onScopeChange(listener: (scope: StorageScope) => void): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}

let scopeGeneration = 0;

/**
 * Zähler für Namensraum-Wechsel. Async-Schreibpfade (Datei lesen, WebAuthn …)
 * halten ihn vor dem await fest und schreiben danach nur, wenn
 * `isScopeCurrent(snapshot)` – sonst landete der Wert im falschen Konto.
 */
export function getScopeGeneration(): number {
  return scopeGeneration;
}

export function isScopeCurrent(generation: number): boolean {
  return generation === scopeGeneration;
}

function setActiveScopeInternal(scope: StorageScope): void {
  scopeGeneration += 1;
  activeScope = scope;
  persistScopePointer(scope);
  scopeListeners.forEach((l) => l(scope));
}

export function dataStorageKey(scope: StorageScope = getActiveScope()): string {
  return scopedKey(STORAGE_KEY_BASE, scope);
}

export const EMPTY_DATA: AppData = {
  shifts: [],
  jobs: [],
  customers: [],
  projects: [],
  payments: [],
  goals: [],
  orders: [],
  objects: [],
  settings: DEFAULT_SETTINGS,
  timer: null,
};

let state: AppData = EMPTY_DATA;
let loaded = false;
const listeners = new Set<() => void>();
let changeHook: ((data: AppData) => void) | null = null;

export function onDataChange(hook: ((data: AppData) => void) | null) {
  changeHook = hook;
}

function emit(sync = true) {
  listeners.forEach((l) => l());
  if (sync && changeHook) changeHook(state);
}

/**
 * Fehlschlag beim lokalen Speichern (Quota voll, Privatmodus) darf nicht still
 * bleiben: sonst hält der Nutzer die Eingabe für gesichert und verliert sie
 * beim nächsten Neuladen.
 */
let persistFailed = false;
const persistListeners = new Set<(failed: boolean) => void>();

export function onPersistError(listener: (failed: boolean) => void) {
  persistListeners.add(listener);
  return () => persistListeners.delete(listener);
}

export function isPersistFailed(): boolean {
  return persistFailed;
}

function setPersistFailed(failed: boolean) {
  if (persistFailed === failed) return;
  persistFailed = failed;
  persistListeners.forEach((l) => l(failed));
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(dataStorageKey(), JSON.stringify(state));
    setPersistFailed(false);
  } catch {
    /* Speicher voll oder blockiert – sichtbar melden statt still verwerfen */
    setPersistFailed(true);
  }
}

function commit(next: AppData, sync = true) {
  state = next;
  persist();
  emit(sync);
}

/** Alte Datenstände (v1) auf das neue Modell heben. */
export function normalize(input: Partial<AppData>): AppData {
  const raw = input as Partial<AppData> & { settings?: Record<string, unknown> };
  const legacyTheme = raw.settings?.["theme"];
  let settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...(raw.settings as Partial<Settings> | undefined),
    supplements: {
      ...DEFAULT_SUPPLEMENTS,
      ...((raw.settings as Partial<Settings> | undefined)?.supplements ?? {}),
    },
    notifications: {
      ...DEFAULT_NOTIFICATIONS,
      ...((raw.settings as Partial<Settings> | undefined)?.notifications ?? {}),
    },
    dashboard: normalizeDashboard((raw.settings as Partial<Settings> | undefined)?.dashboard),
  };
  if (!raw.settings?.["themeMode"] && (legacyTheme === "dark" || legacyTheme === "light")) {
    settings.themeMode = legacyTheme;
  }
  // Bestandsdaten ohne "limitAuto": Nur wenn die gespeicherte Monatsgrenze einem
  // bekannten gesetzlichen Wert entspricht, gilt sie als nicht bewusst angepasst und
  // wird künftig stichtagsbezogen aus der Rechtsschicht abgeleitet.
  if (raw.settings && (raw.settings as Record<string, unknown>)["limitAuto"] === undefined) {
    settings.limitAuto = KNOWN_LEGAL_MONTHLY_LIMITS.includes(settings.monthlyLimit);
  }
  if (!LANGUAGES.some((l) => l.code === settings.language)) {
    settings.language = detectLanguage();
  }
  // pinEnabled ohne gültige PIN wäre nur UI-Kosmetik (Root sperrt nicht).
  settings = withConsistentPinSettings(settings);
  if (Array.isArray(settings.customTasks)) {
    settings.customTasks = settings.customTasks.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  }
  if (Array.isArray(settings.workCodes)) {
    settings.workCodes = settings.workCodes.filter((item): item is WorkCodeDef =>
      Boolean(
        item &&
        typeof item === "object" &&
        typeof (item as { code?: unknown }).code === "string" &&
        typeof (item as { label?: unknown }).label === "string",
      ),
    );
  }
  // Drop null/primitive/"array" holes so property access (s.kind, j.rate) never
  // throws — a throw in loadFromStorage would wipe local data via its catch.
  const shiftRows = (Array.isArray(raw.shifts) ? raw.shifts : []).filter(isPlainRecord);
  const jobRows = (Array.isArray(raw.jobs) ? raw.jobs : []).filter(isPlainRecord);
  const customerRows = (Array.isArray(raw.customers) ? raw.customers : []).filter(isPlainRecord);
  const projectRows = (Array.isArray(raw.projects) ? raw.projects : []).filter(isPlainRecord);
  const paymentRows = (Array.isArray(raw.payments) ? raw.payments : []).filter(isPlainRecord);
  const goalRows = (Array.isArray(raw.goals) ? raw.goals : []).filter(isPlainRecord);
  const orderRows = (Array.isArray(raw.orders) ? raw.orders : []).filter(isPlainRecord);
  const objectRows = (Array.isArray(raw.objects) ? raw.objects : []).filter(isPlainRecord);

  return {
    shifts: shiftRows.map((s) => ({
      ...(s as unknown as Shift),
      kind: (s as { kind?: Shift["kind"] }).kind ?? "arbeit",
      breakMinutes: (s as { breakMinutes?: number }).breakMinutes ?? 0,
    })),
    // Kompatibilität: Ein gespeicherter Job-Satz 0 stammte bisher aus einem leeren
    // Formularfeld und wurde in der Lohnauflösung schon immer als "nicht gesetzt"
    // behandelt. Er wird daher auf undefined gehoben. Schicht-Sätze bleiben unverändert,
    // weil dort 0 bereits als 0 EUR/h verrechnet wurde.
    jobs: jobRows.map((j) => {
      const job = j as unknown as Job;
      if (job.rate !== 0) return job;
      const { rate: _legacyZero, ...rest } = job;
      return rest as Job;
    }),
    customers: customerRows as unknown as Customer[],
    projects: projectRows as unknown as Project[],
    payments: paymentRows as unknown as Payment[],
    goals: goalRows as unknown as Goal[],
    orders: orderRows as unknown as Order[],
    objects: objectRows as unknown as WorkObject[],
    settings,
    timer: raw.timer ?? null,
  };
}

/** Liest und normalisiert den gespeicherten Stand eines Scopes (null = nichts/ungültig). */
export function readStoredData(key: string): AppData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return normalize(JSON.parse(raw) as Partial<AppData>);
  } catch {
    return null;
  }
}

export function readScopeData(scope: StorageScope): AppData | null {
  return readStoredData(dataStorageKey(scope));
}

/** Enthält der Stand echte Nutzerdaten (nicht nur Standard-Einstellungen)? */
export function hasMeaningfulData(data: AppData | null | undefined): boolean {
  if (!data) return false;
  return (
    data.shifts.length > 0 ||
    data.jobs.length > 0 ||
    data.orders.length > 0 ||
    data.customers.length > 0 ||
    data.projects.length > 0 ||
    data.payments.length > 0 ||
    data.goals.length > 0 ||
    data.objects.length > 0 ||
    data.timer != null ||
    data.settings.onboarded === true
  );
}

/**
 * Stand für einen Scope laden (ohne Sync auszulösen). Unbekannter Scope →
 * frischer Stand; nur die UI-Sprache wird aus dem bisherigen Stand übernommen
 * (keine Nutzerdaten, kein onboarded/wizardCompletedAt, kein PIN).
 */
function loadScopeState(
  scope: StorageScope,
  languageSeed: Settings["language"],
): { data: AppData; filled: boolean } {
  const stored = readScopeData(scope);
  if (stored) {
    // Legacy: fehlende Objekte aus Schicht-Adressen nachziehen (nur ADD/Fill, keine Shift-Mutation)
    const objects = ensureObjectsFromShifts(stored.objects, stored.shifts, {
      newId,
      now: todayIso(),
    });
    // Kataloge (Leistungsarten/Tätigkeiten) ADD-only aus Schichten nachziehen –
    // im Stand dieses Scopes (settings), kein eigener Storage-Key.
    const next = withEnsuredCatalogs(objects !== stored.objects ? { ...stored, objects } : stored);
    return next !== stored ? { data: next, filled: true } : { data: stored, filled: false };
  }
  return {
    data: { ...EMPTY_DATA, settings: { ...EMPTY_DATA.settings, language: languageSeed } },
    filled: false,
  };
}

export function loadFromStorage() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  // Start im zuletzt aktiven Scope; Auth bestätigt/korrigiert ihn danach (cloud.ts).
  const scope = readScopePointer();
  setActiveScopeInternal(scope);
  const stored = readScopeData(scope);
  if (stored) {
    const next = loadScopeState(scope, stored.settings.language);
    state = next.data;
    if (next.filled) persist();
    emit(false);
    return;
  }
  // Erststart: Sprache aus dem Browser übernehmen (später manuell änderbar)
  state = { ...EMPTY_DATA, settings: { ...EMPTY_DATA.settings, language: detectLanguage() } };
  emit(false);
}

/**
 * Namensraum wechseln (Login, Logout, Kontowechsel, Testmodus).
 *
 * Ersetzt die In-Memory-Daten vollständig durch den Stand des Ziel-Scopes,
 * ohne `onDataChange` auszulösen (kein Sync, kein Überschreiben). Der bisherige
 * Scope bleibt unverändert gespeichert. Liefert false, wenn der Scope schon aktiv war.
 */
export function activateScope(scope: StorageScope): boolean {
  if (loaded && sameScope(scope, getActiveScope())) return false;
  loaded = true;
  const languageSeed = state.settings.language ?? detectLanguage();
  const next = loadScopeState(scope, languageSeed);
  state = next.data;
  setActiveScopeInternal(scope);
  if (next.filled) persist();
  emit(false);
  try {
    applyAppearance(state.settings);
  } catch {
    /* DOM nicht verfügbar */
  }
  return true;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppData(): AppData {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY_DATA,
  );
}

export function getData(): AppData {
  return state;
}

/** Kataloge ADD-only aus Schichten nachziehen — analog ensureObjectsFromShifts. */
function withEnsuredCatalogs(data: AppData): AppData {
  const prevCodes = data.settings.workCodes ?? [];
  const prevTasks = data.settings.customTasks ?? [];
  const workCodes = ensureWorkCodesFromShifts(prevCodes, data.shifts);
  const customTasks = ensureCustomTasksFromShifts(prevTasks, data.shifts);
  if (workCodes === prevCodes && customTasks === prevTasks) return data;
  return {
    ...data,
    settings: {
      ...data.settings,
      ...(workCodes !== prevCodes ? { workCodes } : {}),
      ...(customTasks !== prevTasks ? { customTasks } : {}),
    },
  };
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Adresse aus Schicht lernen und objectId setzen; Objekte-Liste ggf. erweitern. */
function learnObjectsFromShift(
  shift: Shift,
  objects: WorkObject[],
): { shift: Shift; objects: WorkObject[] } {
  const result = upsertObjectFromShiftAddress(objects, shift, { newId, now: todayIso() });
  return {
    shift: linkShiftToObject(shift, result.objectId),
    objects: result.objects,
  };
}

function withLearnedCatalogs(settings: Settings, shift: Shift): Settings {
  const prevCodes = settings.workCodes ?? [];
  const prevTasks = settings.customTasks ?? [];
  const learned = learnSavedValuesFromShift(prevCodes, prevTasks, shift);
  if (learned.workCodes === prevCodes && learned.customTasks === prevTasks) return settings;
  return {
    ...settings,
    ...(learned.workCodes !== prevCodes ? { workCodes: learned.workCodes } : {}),
    ...(learned.customTasks !== prevTasks ? { customTasks: learned.customTasks } : {}),
  };
}

function learnObjectsFromShifts(
  list: Shift[],
  objects: WorkObject[],
): { shifts: Shift[]; objects: WorkObject[] } {
  let objs = objects;
  const shifts = list.map((s) => {
    const learned = learnObjectsFromShift(s, objs);
    objs = learned.objects;
    return learned.shift;
  });
  return { shifts, objects: objs };
}

/* ---------- Schichten ---------- */

export function saveShift(shift: Shift) {
  const learned = learnObjectsFromShift(shift, state.objects);
  const exists = state.shifts.some((s) => s.id === learned.shift.id);
  const shifts = exists
    ? state.shifts.map((s) => (s.id === learned.shift.id ? learned.shift : s))
    : [...state.shifts, learned.shift];
  shifts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const settings = withLearnedCatalogs(state.settings, learned.shift);
  commit({ ...state, shifts, objects: learned.objects, settings });
}

export function saveShifts(list: Shift[]) {
  const learned = learnObjectsFromShifts(list, state.objects);
  const map = new Map(state.shifts.map((s) => [s.id, s]));
  for (const s of learned.shifts) map.set(s.id, s);
  const shifts = [...map.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  let settings = state.settings;
  for (const s of learned.shifts) {
    settings = withLearnedCatalogs(settings, s);
  }
  commit({ ...state, shifts, objects: learned.objects, settings });
}

export function deleteShift(id: string) {
  commit({ ...state, shifts: state.shifts.filter((s) => s.id !== id) });
}

/* ---------- Jobs ---------- */

export function saveJob(job: Job) {
  const exists = state.jobs.some((j) => j.id === job.id);
  const jobs = exists ? state.jobs.map((j) => (j.id === job.id ? job : j)) : [...state.jobs, job];
  const settings = state.settings.activeJobId
    ? state.settings
    : withActiveJob(state.settings, job.id);
  commit({ ...state, jobs, settings });
}

export function deleteJob(id: string) {
  commit({
    ...state,
    jobs: state.jobs.filter((j) => j.id !== id),
    shifts: state.shifts.filter((s) => s.jobId !== id),
    settings:
      state.settings.activeJobId === id
        ? withActiveJob(state.settings, state.jobs.find((j) => j.id !== id)?.id)
        : state.settings,
  });
}

function withActiveJob(settings: Settings, jobId: string | undefined): Settings {
  const next = { ...settings };
  if (jobId) next.activeJobId = jobId;
  else delete next.activeJobId;
  return next;
}

export function nextJobColor(): string {
  const used = new Set(state.jobs.map((j) => j.color));
  return JOB_COLORS.find((c) => !used.has(c)) ?? JOB_COLORS[0]!;
}

/* ---------- Kunden & Projekte ---------- */

export function saveCustomer(customer: Customer) {
  const exists = state.customers.some((c) => c.id === customer.id);
  const customers = exists
    ? state.customers.map((c) => (c.id === customer.id ? customer : c))
    : [...state.customers, customer];
  commit({ ...state, customers });
}

export function deleteCustomer(id: string) {
  commit({
    ...state,
    customers: state.customers.filter((c) => c.id !== id),
    projects: state.projects.filter((p) => p.customerId !== id),
  });
}

export function saveProject(project: Project) {
  const exists = state.projects.some((p) => p.id === project.id);
  const projects = exists
    ? state.projects.map((p) => (p.id === project.id ? project : p))
    : [...state.projects, project];
  commit({ ...state, projects });
}

export function deleteProject(id: string) {
  commit({ ...state, projects: state.projects.filter((p) => p.id !== id) });
}

/* ---------- Lohnzahlungen ---------- */

export function savePayment(payment: Payment) {
  const exists = state.payments.some((p) => p.id === payment.id);
  const payments = exists
    ? state.payments.map((p) => (p.id === payment.id ? payment : p))
    : [...state.payments, payment];
  commit({ ...state, payments });
}

export function deletePayment(id: string) {
  commit({ ...state, payments: state.payments.filter((p) => p.id !== id) });
}

/* ---------- Sparziele ---------- */

export function saveGoal(goal: Goal) {
  const exists = state.goals.some((g) => g.id === goal.id);
  const goals = exists
    ? state.goals.map((g) => (g.id === goal.id ? goal : g))
    : [...state.goals, goal];
  commit({ ...state, goals });
}

export function deleteGoal(id: string) {
  commit({ ...state, goals: state.goals.filter((g) => g.id !== id) });
}

/* ---------- Selbstständig-Aufträge ---------- */

export function saveOrder(order: Order) {
  const exists = state.orders.some((o) => o.id === order.id);
  const orders = exists
    ? state.orders.map((o) => (o.id === order.id ? order : o))
    : [...state.orders, order];
  commit({ ...state, orders });
}

export function deleteOrder(id: string) {
  commit({ ...state, orders: state.orders.filter((o) => o.id !== id) });
}

/* ---------- Einsatzobjekte ---------- */

export function saveObject(obj: WorkObject) {
  const exists = state.objects.some((o) => o.id === obj.id);
  const objects = exists
    ? state.objects.map((o) => (o.id === obj.id ? obj : o))
    : [...state.objects, obj];
  commit({ ...state, objects });
}

export function deleteObject(id: string) {
  // Objekt entfernen; Schicht-Adressfelder bleiben. objectId-Referenzen bereinigen.
  commit({
    ...state,
    objects: state.objects.filter((o) => o.id !== id),
    shifts: clearObjectIdFromShifts(state.shifts, id),
  });
}

/** Alias: neues Objekt anlegen oder aktualisieren (Brief-API). */
export function addObject(obj: WorkObject) {
  saveObject(obj);
}

export function upsertObject(obj: WorkObject) {
  saveObject(obj);
}

export function removeObject(id: string) {
  deleteObject(id);
}

/** Gespeicherte Leistungsart anlegen/umbenennen. Schichten werden nicht geändert. */
export function upsertWorkCodeDef(item: WorkCodeDef, previousCode?: string) {
  const code = normalizeWorkCode(item.code);
  const label = normalizeCatalogText(item.label);
  if (!code || !label || isBuiltinWorkCode(code)) return;
  const prev = state.settings.workCodes ?? [];
  let next = previousCode
    ? prev.filter((c) => normalizeWorkCode(c.code) !== normalizeWorkCode(previousCode))
    : [...prev];
  const idx = next.findIndex((c) => normalizeWorkCode(c.code) === code);
  if (idx >= 0) {
    next = next.map((c, i) => (i === idx ? { code, label } : c));
  } else {
    next = [...next, { code, label }];
  }
  updateSettings({ workCodes: next });
}

export function deleteWorkCodeDef(codeRaw: string) {
  const code = normalizeWorkCode(codeRaw);
  if (!code) return;
  const prev = state.settings.workCodes ?? [];
  const workCodes = prev.filter((c) => normalizeWorkCode(c.code) !== code);
  if (workCodes.length === prev.length) return;
  updateSettings({ workCodes });
}

/** Gespeicherte Tätigkeit anlegen/umbenennen. Schichten werden nicht geändert. */
export function upsertCustomTask(valueRaw: string, previous?: string) {
  const value = normalizeCatalogText(valueRaw);
  if (!value) return;
  let next = [...(state.settings.customTasks ?? [])];
  if (previous) {
    next = next.filter((item) => normalizeTaskCompare(item) !== normalizeTaskCompare(previous));
  }
  if (!next.some((item) => normalizeTaskCompare(item) === normalizeTaskCompare(value))) {
    next = [...next, value];
  }
  updateSettings({ customTasks: next });
}

export function deleteCustomTask(valueRaw: string) {
  const compare = normalizeTaskCompare(valueRaw);
  if (!compare) return;
  const prev = state.settings.customTasks ?? [];
  const customTasks = prev.filter((item) => normalizeTaskCompare(item) !== compare);
  if (customTasks.length === prev.length) return;
  updateSettings({ customTasks });
}

/* ---------- Einstellungen ---------- */

export function updateSettings(patch: Partial<Settings>) {
  const settings = withConsistentPinSettings({ ...state.settings, ...patch });
  commit({ ...state, settings });
  applyAppearance(settings);
}

/**
 * Gerätesperre (PIN/WebAuthn) in den aktiven Bestand übernehmen, OHNE Sync
 * auszulösen – nur, wenn dort noch keine gültige PIN existiert. Wird genutzt,
 * damit ein bisher PIN-geschütztes Gerät nach der Umstellung auf Konto-
 * Namensräume nicht plötzlich ungesperrt ist. Überträgt keine Nutzerdaten.
 */
export function seedDeviceLock(source: Settings): boolean {
  if (isValidPin(state.settings.pin) || !isValidPin(source.pin) || !source.pinEnabled) return false;
  let settings: Settings = { ...state.settings, pin: source.pin, pinEnabled: true };
  if (source.biometricCredentialId && !state.settings.biometricCredentialId) {
    settings = {
      ...settings,
      biometric: source.biometric,
      biometricCredentialId: source.biometricCredentialId,
    };
  }
  commit({ ...state, settings: withConsistentPinSettings(settings) }, false);
  return true;
}

/** Biometrie abschalten und Credential-Id entfernen (exactOptionalPropertyTypes-sicher). */
export function disableBiometric() {
  const { biometricCredentialId: _drop, ...rest } = state.settings;
  const settings: Settings = { ...rest, biometric: false };
  commit({ ...state, settings });
  applyAppearance(settings);
}

export function updateSupplements(patch: Partial<Settings["supplements"]>) {
  updateSettings({ supplements: { ...state.settings.supplements, ...patch } });
}

export function updateDashboard(patch: Partial<Settings["dashboard"]>) {
  updateSettings({ dashboard: { ...state.settings.dashboard, ...patch } });
}

/* ---------- Timer ---------- */

export function startTimer(jobId?: string) {
  const timer: RunningTimer = { startedAt: Date.now(), breakMinutes: 0 };
  if (jobId) timer.jobId = jobId;
  commit({ ...state, timer }, false);
}

export function updateTimerBreak(minutes: number) {
  if (!state.timer) return;
  commit({ ...state, timer: { ...state.timer, breakMinutes: minutes } }, false);
}

export function clearTimer() {
  commit({ ...state, timer: null }, false);
}

export function getTimer(): RunningTimer | null {
  return state.timer ?? null;
}

/* ---------- Import / Export ---------- */

export function replaceAll(data: Partial<AppData>) {
  let next = normalize(data);
  const objects = ensureObjectsFromShifts(next.objects, next.shifts, {
    newId,
    now: todayIso(),
  });
  if (objects !== next.objects) next = { ...next, objects };
  next = withEnsuredCatalogs(next);
  commit(next, false);
  applyAppearance(next.settings);
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
