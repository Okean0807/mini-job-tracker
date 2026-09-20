import type { AppData } from "./types";

/** Non-null plain object (not Array) — list rows in backups must be records. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listElementsAreRecords(value: unknown): boolean {
  return Array.isArray(value) && value.every(isPlainRecord);
}

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
 *
 * Listenelemente müssen Plain-Objects sein: `normalize` greift auf `s.kind` /
 * `j.rate` zu; `null`/Primitive in den Arrays werfen sonst und können über
 * `loadFromStorage`'s catch den lokalen Bestand still auf Erststart zurücksetzen.
 */
export function isValidPayload(value: unknown): value is AppData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;

  // Kernbestand: beide Primärlisten müssen Arrays *von Objekten* sein.
  if (!listElementsAreRecords(raw["shifts"]) || !listElementsAreRecords(raw["jobs"])) {
    return false;
  }

  const optionalLists = ["customers", "projects", "payments", "goals", "orders", "objects"];
  if (
    optionalLists.some(
      (key) => raw[key] !== undefined && !listElementsAreRecords(raw[key]),
    )
  ) {
    return false;
  }

  if (raw["settings"] !== undefined) {
    const s = raw["settings"];
    if (typeof s !== "object" || s === null || Array.isArray(s)) return false;
  }
  return true;
}
