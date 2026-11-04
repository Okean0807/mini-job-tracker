import { isPublicLocalBuild } from "@/lib/cloud/cloud-mode";

import type { Settings } from "./types";

/** Premium-Funktionen (Flag-basiert, noch ohne Bezahlung). */
export type PremiumFeature = "multiJob" | "ai" | "cloud" | "excel" | "advancedReports" | "forecast";

/**
 * Public Local release: free, full functionality, no subscription and no unlock switch - every feature
 * (several employers, Excel export, ...) is available. Cloud builds keep the flag-based gating.
 */
export function isPremium(settings: Pick<Settings, "premium">): boolean {
  return isPublicLocalBuild() || settings.premium === true;
}

export function canUse(settings: Pick<Settings, "premium">, _feature: PremiumFeature): boolean {
  return isPremium(settings);
}

/** Kostenlos: genau ein Arbeitgeber. */
export function canAddJob(settings: Pick<Settings, "premium">, jobCount: number): boolean {
  return isPremium(settings) || jobCount < 1;
}

export type ExportFormat = "pdf" | "xlsx";

/**
 * Einheitliche Regel für alle Exporte in der Statistik (Monats-/Jahresliste und Jahresbericht):
 * Excel (XLSX) gehört zu Premium, PDF ist kostenlos.
 *
 * Achtung: `settings.premium` ist ein lokales Flag ohne Bezahlung und ohne Serverprüfung. Die
 * Dateien entstehen vollständig im Browser; diese Prüfung ist eine Produktregel in der Oberfläche,
 * kein Sicherheitsmerkmal.
 */
export function canExport(settings: Pick<Settings, "premium">, format: ExportFormat): boolean {
  return format === "xlsx" ? canUse(settings, "excel") : true;
}
