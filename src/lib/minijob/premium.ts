import type { Settings } from "./types";

/** Premium-Funktionen (Flag-basiert, noch ohne Bezahlung). */
export type PremiumFeature = "multiJob" | "ai" | "cloud" | "excel" | "advancedReports" | "forecast";

/**
 * v1.0 ist vorübergehend kostenlos: alle Funktionen stehen allen Nutzern zur Verfügung.
 * Einziger Erweiterungspunkt für spätere Pläne — eine echte Berechtigung (z. B. serverseitig
 * geprüft) ersetzt dann diese Konstante. `settings.premium` ist ein Altfeld ohne Wirkung.
 */
export const ALL_FEATURES_FREE: boolean = true;

export function isPremium(settings: Pick<Settings, "premium">): boolean {
  return settings.premium === true;
}

export function canUse(settings: Pick<Settings, "premium">, _feature: PremiumFeature): boolean {
  return ALL_FEATURES_FREE || isPremium(settings);
}

/** v1.0: beliebig viele Arbeitgeber (ohne ALL_FEATURES_FREE: genau einer kostenlos). */
export function canAddJob(settings: Pick<Settings, "premium">, jobCount: number): boolean {
  return ALL_FEATURES_FREE || isPremium(settings) || jobCount < 1;
}
