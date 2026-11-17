import { importBackupText } from "./guarded-local";
import type { GuardedResult } from "./guarded-operation";
import { createActivePorts } from "./guarded-ports";

export type LocalBackupRestoreResult = GuardedResult | { status: "read-error" };

/**
 * Lokale JSON-Sicherung (Einstellungen → Lokale Sicherung): Datei lesen, dann derselbe
 * geschützte Ablauf wie im ImportDialog. Konto und Scope-Epoche werden VOR dem Lesen
 * festgehalten; wechselt währenddessen Konto oder Namensraum, schreibt der Ablauf nichts.
 */
export function restoreLocalBackupFile(file: Blob): Promise<LocalBackupRestoreResult> {
  const ports = createActivePorts();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => void importBackupText(String(reader.result), ports).then(resolve);
    reader.onerror = () => resolve({ status: "read-error" });
    reader.readAsText(file);
  });
}
