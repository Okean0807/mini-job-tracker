import { useSyncExternalStore } from "react";

import { DEFAULT_SETTINGS, type AppData, type Settings, type Shift } from "./types";

const STORAGE_KEY = "minijob-tracker-v1";

let state: AppData = { shifts: [], settings: DEFAULT_SETTINGS };
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Speicher voll oder blockiert */
  }
}

export function loadFromStorage() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppData>;
      state = {
        shifts: Array.isArray(parsed.shifts) ? parsed.shifts : [],
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      };
      emit();
    }
  } catch {
    /* ungültige Daten ignorieren */
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot: AppData = { shifts: [], settings: DEFAULT_SETTINGS };

export function useAppData(): AppData {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => serverSnapshot,
  );
}

export function getData(): AppData {
  return state;
}

export function saveShift(shift: Shift) {
  const exists = state.shifts.some((s) => s.id === shift.id);
  const shifts = exists
    ? state.shifts.map((s) => (s.id === shift.id ? shift : s))
    : [...state.shifts, shift];
  shifts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  state = { ...state, shifts };
  persist();
  emit();
}

export function deleteShift(id: string) {
  state = { ...state, shifts: state.shifts.filter((s) => s.id !== id) };
  persist();
  emit();
}

export function updateSettings(patch: Partial<Settings>) {
  state = { ...state, settings: { ...state.settings, ...patch } };
  persist();
  emit();
  if (patch.theme) applyTheme(patch.theme);
}

export function replaceAll(data: AppData) {
  state = {
    shifts: Array.isArray(data.shifts) ? data.shifts : [],
    settings: { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) },
  };
  persist();
  emit();
  applyTheme(state.settings.theme);
}

export function applyTheme(theme: "light" | "dark") {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
