import { useSyncExternalStore } from "react";

import { LANGUAGES, detectLanguage } from "@/lib/i18n/core";

import { applyAppearance } from "./theme";
import {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_SETTINGS,
  DEFAULT_SUPPLEMENTS,
  JOB_COLORS,
  type AppData,
  type Customer,
  type Job,
  type Project,
  type RunningTimer,
  type Settings,
  type Shift,
} from "./types";

const STORAGE_KEY = "minijob-tracker-v1";

export const EMPTY_DATA: AppData = {
  shifts: [],
  jobs: [],
  customers: [],
  projects: [],
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

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Speicher voll oder blockiert */
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
  const settings: Settings = {
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
  };
  if (!raw.settings?.["themeMode"] && (legacyTheme === "dark" || legacyTheme === "light")) {
    settings.themeMode = legacyTheme;
  }
  if (!LANGUAGES.some((l) => l.code === settings.language)) {
    settings.language = detectLanguage();
  }
  return {
    shifts: (Array.isArray(raw.shifts) ? raw.shifts : []).map((s) => ({
      ...s,
      kind: s.kind ?? "arbeit",
      breakMinutes: s.breakMinutes ?? 0,
    })),
    jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
    customers: Array.isArray(raw.customers) ? raw.customers : [],
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    settings,
    timer: raw.timer ?? null,
  };
}

export function loadFromStorage() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = normalize(JSON.parse(raw) as Partial<AppData>);
      emit(false);
      return;
    }
  } catch {
    /* ungültige Daten ignorieren */
  }
  // Erststart: Sprache aus dem Browser übernehmen (später manuell änderbar)
  state = { ...state, settings: { ...state.settings, language: detectLanguage() } };
  emit(false);
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

/* ---------- Schichten ---------- */

export function saveShift(shift: Shift) {
  const exists = state.shifts.some((s) => s.id === shift.id);
  const shifts = exists
    ? state.shifts.map((s) => (s.id === shift.id ? shift : s))
    : [...state.shifts, shift];
  shifts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  commit({ ...state, shifts });
}

export function saveShifts(list: Shift[]) {
  const map = new Map(state.shifts.map((s) => [s.id, s]));
  for (const s of list) map.set(s.id, s);
  const shifts = [...map.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  commit({ ...state, shifts });
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

/* ---------- Einstellungen ---------- */

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  commit({ ...state, settings });
  if (patch.themeMode || patch.accent) applyAppearance(settings.themeMode, settings.accent);
}

export function updateSupplements(patch: Partial<Settings["supplements"]>) {
  updateSettings({ supplements: { ...state.settings.supplements, ...patch } });
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
  const next = normalize(data);
  commit(next, false);
  applyAppearance(next.settings.themeMode, next.settings.accent);
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
