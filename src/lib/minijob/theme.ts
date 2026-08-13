import type { Accent, Settings, TextSize, ThemeMode } from "./types";

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

export const TEXT_SCALE: Record<TextSize, string> = {
  s: "93.75%",
  m: "100%",
  l: "112.5%",
  xl: "125%",
};

export function prefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

type AppearanceInput = Pick<
  Settings,
  "themeMode" | "accent" | "textSize" | "touchSize" | "highContrast" | "reduceMotion" | "uiMode"
>;

export function applyAppearance(settings: AppearanceInput) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const dark = settings.themeMode === "dark" || (settings.themeMode === "system" && prefersDark());
  root.classList.toggle("dark", dark);
  root.classList.toggle("high-contrast", Boolean(settings.highContrast));
  root.classList.toggle("reduce-motion", Boolean(settings.reduceMotion));
  root.dataset["accent"] = settings.accent;
  root.dataset["touch"] = settings.touchSize ?? "normal";
  root.dataset["ui"] = settings.uiMode ?? "standard";
  root.style.fontSize = TEXT_SCALE[settings.textSize ?? "m"] ?? "100%";
}
