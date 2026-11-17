/**
 * Data-safety Phase 4: lokale Ersetzungen (JSON-Import aus Einstellungen/ImportDialog,
 * Snapshot-Wiederherstellung) laufen durch den EINEN geschützten Ablauf.
 * Gerätesperre (PIN/Biometrie) und laufender Timer bleiben immer die lokalen.
 */
import { sha256Hex } from "./backup-safety";
import { getActiveSnapshotFile } from "./backup-safety-active";
import { markLocalReplacementForSync } from "./cloud";
import { mergeDeviceAuthFromLocal, stripDeviceAuthForCloud } from "./device-auth";
import {
  GuardedAbort,
  runGuardedOperation,
  type GuardedOperation,
  type GuardedPorts,
  type GuardedResult,
  type Prepared,
} from "./guarded-operation";
import { createActivePorts } from "./guarded-ports";
import { isValidPayload } from "./payload";
import { isPersistFailed, replaceAll } from "./store";
import type { SnapshotKind } from "./backup-safety";
import type { AppData } from "./types";

/** Ersetzt den lokalen Stand durch `load()`; `after` läuft synchron direkt nach dem Ersetzen. */
export function localReplaceOperation(args: {
  kind: "local-import" | "snapshot-restore";
  snapshotKind: SnapshotKind;
  load: () => Promise<{ raw: unknown; sourceHash?: string }>;
  after?: () => void;
}): GuardedOperation {
  return {
    kind: args.kind,
    async prepare({ local }): Promise<Prepared> {
      let raw: unknown;
      let sourceHash: string | undefined;
      try {
        ({ raw, sourceHash } = await args.load());
      } catch (error) {
        if (error instanceof GuardedAbort) throw error;
        throw new GuardedAbort("invalid-payload");
      }
      if (!isValidPayload(raw)) throw new GuardedAbort("invalid-payload");
      return {
        // Eine Datei bringt NIE Gerätesperre mit: erst entfernen, dann die lokale einsetzen
        // (die Alt-Migration "PIN übernehmen, wenn das Gerät keine hat" gilt nur für Cloud-Altstände).
        incoming: mergeDeviceAuthFromLocal(stripDeviceAuthForCloud(raw), local),
        losing: local,
        snapshotKind: args.snapshotKind,
        replaces: "local",
        ...(sourceHash ? { sourceHash } : {}),
      };
    },
    commit(prepared, { local }) {
      // REIHENFOLGE ist Absicht (Absturzsicherheit): erst die Änderungsmarke (+ zurückgesetzte
      // Basis), dann der Datenwechsel. Ein Abbruch dazwischen hinterlässt "markiert, Daten
      // unverändert" (harmlos: höchstens ein Konflikt) – nie "Daten ersetzt, aber unmarkiert", wo
      // ein späterer automatischer Abgleich den Import still durch den Cloud-Stand überschreiben
      // könnte. Dirty ja, Upload nur nach eigener Aktion.
      markLocalReplacementForSync();
      replaceAll({ ...prepared.incoming, timer: local.timer ?? null });
      // `replaceAll` speichert mit EINEM setItem (ein Schlüssel = alles oder nichts). Schlägt das
      // Speichern fehl (Quota), steht der neue Stand nur im Arbeitsspeicher: nicht als Erfolg melden.
      if (isPersistFailed()) throw new GuardedAbort("commit-failed");
      args.after?.();
    },
  };
}

/** Text einer JSON-Sicherung geschützt übernehmen (beide Importwege). */
export async function importBackupText(
  text: string,
  ports: GuardedPorts = createActivePorts(),
): Promise<GuardedResult> {
  return runGuardedOperation(
    localReplaceOperation({
      kind: "local-import",
      snapshotKind: "local_pre_import",
      async load() {
        // Der Dateihash wird mit dem Vergleich festgehalten (der Text liegt unveränderlich im Speicher).
        return { raw: JSON.parse(text) as unknown, sourceHash: await sha256Hex(text) };
      },
    }),
    ports,
  );
}

/** Verifizierten Snapshot des aktiven Kontos geschützt zurückspielen. */
export async function restoreSnapshot(id: string): Promise<GuardedResult> {
  return runGuardedOperation(
    localReplaceOperation({
      kind: "snapshot-restore",
      snapshotKind: "local_pre_restore",
      async load() {
        const file = await getActiveSnapshotFile(id); // prüft Scope, SHA-256 und Manifest erneut
        return { raw: JSON.parse(file.text) as unknown, sourceHash: await sha256Hex(file.text) };
      },
    }),
    createActivePorts(),
  );
}
