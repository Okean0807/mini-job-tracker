import type { AppData } from "./types";

/**
 * Struktureller Mindestcheck für einen Sicherungs-/Import-Stand.
 *
 * `normalize()` im Store ist tolerant: aus einem beschädigten oder fremden
 * Payload (String, Zahl, Array, `{}`) entsteht ein *leerer* Datensatz. Würde
 * der ohne Prüfung durch `replaceAll` laufen, löscht ein kaputter Import oder
 * Cloud-Eintrag still alle lokalen Daten. Deshalb nur plausibel geformte
 * Payloads übernehmen.
 *
 * Echte Local-/Cloud-Backups tragen immer `shifts` und `jobs` (ggf. leer).
 * Ein einzelnes Nebenfeld wie `{ goals: [] }` darf deshalb nicht als gültige
 * Sicherung gelten — sonst wischen Import und Sync den Bestand still weg.
 */
export function isValidPayload(value: unknown): value is AppData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;

  // Kernbestand: beide Primärlisten müssen Arrays sein (wie getData() exportiert).
  if (!Array.isArray(raw["shifts"]) || !Array.isArray(raw["jobs"])) return false;

  const optionalLists = ["customers", "projects", "payments", "goals"];
  if (optionalLists.some((key) => raw[key] !== undefined && !Array.isArray(raw[key]))) {
    return false;
  }

  if (raw["settings"] !== undefined) {
    const s = raw["settings"];
    if (typeof s !== "object" || s === null || Array.isArray(s)) return false;
  }
  return true;
}
