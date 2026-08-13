import type { Settings } from "./types";

/** Premium-Funktionen (Flag-basiert, noch ohne Bezahlung). */
export type PremiumFeature =
  | "multiJob"
  | "ai"
  | "cloud"
  | "excel"
  | "advancedReports"
  | "forecast";

export function isPremium(settings: Pick<Settings, "premium">): boolean {
  return settings.premium === true;
}

export function canUse(settings: Pick<Settings, "premium">, _feature: PremiumFeature): boolean {
  return isPremium(settings);
}

/** Kostenlos: genau ein Arbeitgeber. */
export function canAddJob(settings: Pick<Settings, "premium">, jobCount: number): boolean {
  return isPremium(settings) || jobCount < 1;
}
