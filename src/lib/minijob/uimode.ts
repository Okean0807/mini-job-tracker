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
