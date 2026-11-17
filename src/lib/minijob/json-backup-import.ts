import { importBackupText } from "./guarded-local";
import type { GuardedResult } from "./guarded-operation";
import { createActivePorts } from "./guarded-ports";

/**
 * JSON-Sicherung aus dem ImportDialog: Datei lesen, dann der geschützte Ablauf
 * (Vergleich, Snapshot, Bestätigung, Gerätesperre bleibt lokal). Konto und Scope-Epoche werden
 * VOR dem asynchronen Lesen festgehalten: wechselt währenddessen das Konto, schreibt der Ablauf
 * nichts (`aborted/scope-changed`). Ungültiges JSON ergibt `aborted/invalid-payload`.
 */
export async function importJsonBackupFile(file: {
  text(): Promise<string>;
}): Promise<GuardedResult> {
  const ports = createActivePorts();
  return importBackupText(await file.text(), ports);
}
