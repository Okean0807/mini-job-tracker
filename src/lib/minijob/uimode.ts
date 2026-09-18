import type { UiMode } from "./types";

/** Oberflächen-Bereiche, die je nach Modus ein- oder ausgeblendet werden. */
export type Feature =
  | "nav.jobs"
  | "nav.ai"
  | "nav.stats"
  | "nav.docs"
  | "dash.statGrid"
  | "dash.limitMonth"
  | "dash.limitYear"
  | "dash.payday"
  | "dash.insights"
  | "dash.goals"
  | "dash.calendar"
  | "settings.advanced";

const SIMPLE: Feature[] = ["nav.stats", "dash.limitMonth", "dash.calendar", "dash.statGrid"];

const STANDARD: Feature[] = [
  ...SIMPLE,
  "nav.jobs",
  "nav.ai",
  "dash.limitYear",
  "dash.insights",
  "dash.payday",
  "dash.goals",
  "nav.docs",
];

const PRO: Feature[] = [...STANDARD, "settings.advanced"];

const MAP: Record<UiMode, Feature[]> = {
  simple: SIMPLE,
  standard: STANDARD,
  pro: PRO,
};

export function visible(feature: Feature, mode: UiMode): boolean {
  return (MAP[mode] ?? STANDARD).includes(feature);
}

export const UI_MODES: UiMode[] = ["simple", "standard", "pro"];

/** Features shown in the surface-mode Vorschau overlay (nav + dash). */
export const PREVIEW_FEATURES: Feature[] = [
  "nav.jobs",
  "nav.ai",
  "nav.stats",
  "nav.docs",
  "dash.statGrid",
  "dash.limitMonth",
  "dash.limitYear",
  "dash.payday",
  "dash.insights",
  "dash.goals",
  "dash.calendar",
  "settings.advanced",
];

export function featuresForMode(mode: UiMode): Feature[] {
  return [...(MAP[mode] ?? STANDARD)];
}

/** Pure: which preview features would be visible in `mode`. */
export function previewVisibility(mode: UiMode): Record<Feature, boolean> {
  const out = {} as Record<Feature, boolean>;
  for (const f of PREVIEW_FEATURES) {
    out[f] = visible(f, mode);
  }
  return out;
}

/**
 * Preview must not mutate applied settings. Returns true when the selected
 * preview mode differs from the persisted applied mode.
 */
export function isPreviewPending(applied: UiMode, preview: UiMode | null): boolean {
  return preview != null && preview !== applied;
}
