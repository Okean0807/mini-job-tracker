import { isValidPayload } from "./payload";
import { getScopeGeneration, isScopeCurrent, replaceAll } from "./store";

export type LocalBackupRestoreResult = "restored" | "invalid" | "read-error" | "stale";

/**
 * Lokale JSON-Sicherung (Einstellungen → Lokale Sicherung) einlesen und
 * übernehmen. Die Datei wird async gelesen: wechselt währenddessen Konto oder
 * Namensraum, wird nichts geschrieben ("stale").
 */
export function restoreLocalBackupFile(file: Blob): Promise<LocalBackupRestoreResult> {
  const generation = getScopeGeneration();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (!isScopeCurrent(generation)) {
        resolve("stale");
        return;
      }
      try {
        const data: unknown = JSON.parse(String(reader.result));
        if (!isValidPayload(data)) {
          resolve("invalid");
          return;
        }
        replaceAll(data);
        resolve("restored");
      } catch {
        resolve("read-error");
      }
    };
    reader.readAsText(file);
  });
}
