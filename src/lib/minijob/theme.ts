import type { Accent, ThemeMode } from "./types";

export const ACCENTS: { id: Accent; label: string; swatch: string }[] = [
  { id: "teal", label: "Türkis", swatch: "#0d9488" },
  { id: "blue", label: "Blau", swatch: "#2563eb" },
  { id: "green", label: "Grün", swatch: "#16a34a" },
  { id: "orange", label: "Orange", swatch: "#ea580c" },
  { id: "red", label: "Rot", swatch: "#dc2626" },
  { id: "purple", label: "Lila", swatch: "#7c3aed" },
];

export const THEME_MODES: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Hell" },
  { id: "dark", label: "Dunkel" },
];

export function prefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyAppearance(mode: ThemeMode, accent: Accent) {
  if (typeof document === "undefined") return;
  const dark = mode === "dark" || (mode === "system" && prefersDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset["accent"] = accent;
}
