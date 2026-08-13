import type { UiMode } from "./types";

/** Oberflächen-Bereiche, die je nach Modus ein- oder ausgeblendet werden. */
export type Feature =
  | "nav.jobs"
  | "nav.ai"
  | "nav.stats"
  | "dash.statGrid"
  | "dash.limitMonth"
  | "dash.limitYear"
  | "dash.payday"
  | "dash.insights"
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
];

const PRO: Feature[] = [...STANDARD, "settings.advanced"];

const MAP: Record<UiMode, Feature[]> = {
  simple: SIMPLE,
  standard: STANDARD,
  pro: PRO,
};

export function visible(feature: Feature, mode: UiMode): boolean {
  return MAP[mode].includes(feature);
}

export const UI_MODES: UiMode[] = ["simple", "standard", "pro"];
