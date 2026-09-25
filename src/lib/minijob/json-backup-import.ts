import { isValidPayload } from "./payload";
import { getScopeGeneration, isScopeCurrent, replaceAll } from "./store";

export type JsonBackupImportResult = "imported" | "invalid" | "stale";

/**
 * JSON-Sicherung aus einer Datei in den aktiven Namensraum übernehmen.
 * Das Lesen der Datei ist async: wechselt währenddessen Konto/Namensraum,
 * wird nichts geschrieben ("stale") – sonst landete die Sicherung im fremden
 * Konto. Ungültiges JSON wirft (Aufrufer zeigt den bisherigen Fehler-Toast).
 */
export async function importJsonBackupFile(file: {
  text(): Promise<string>;
}): Promise<JsonBackupImportResult> {
  const generation = getScopeGeneration();
  const data: unknown = JSON.parse(await file.text());
  if (!isScopeCurrent(generation)) return "stale";
  if (!isValidPayload(data)) return "invalid";
  replaceAll(data);
  return "imported";
}
