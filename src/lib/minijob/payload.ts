import type { AppData } from "./types";

/**
 * Struktureller Mindestcheck für einen Sicherungs-/Import-Stand.
 *
 * `normalize()` im Store ist tolerant: aus einem beschädigten oder fremden
 * Payload (String, Zahl, Array, `{}`) entsteht ein *leerer* Datensatz. Würde
 * der ohne Prüfung durch `replaceAll` laufen, löscht ein kaputter Import oder
 * Cloud-Eintrag still alle lokalen Daten. Deshalb nur plausibel geformte
 * Payloads übernehmen.
 */
export function isValidPayload(value: unknown): value is AppData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  const lists = ["shifts", "jobs", "customers", "projects", "payments", "goals"];
  // Mindestens eine bekannte Liste muss vorhanden und ein Array sein; alle
  // vorhandenen Listen müssen Arrays sein.
  if (!lists.some((key) => Array.isArray(raw[key]))) return false;
  if (lists.some((key) => raw[key] !== undefined && !Array.isArray(raw[key]))) return false;
  if (raw["settings"] !== undefined) {
    const s = raw["settings"];
    if (typeof s !== "object" || s === null || Array.isArray(s)) return false;
  }
  return true;
}
