/**
 * Phase-4-Test-Doubles für Dateien, die `vi.resetModules()` nutzen: Bestätigung und Snapshot-
 * Ablage müssen in der FRISCH geladenen Modulinstanz gesetzt werden (daher dynamische Importe).
 */
import type { MemoryStorage } from "@/lib/minijob/backup-safety.memory";
import type { GuardedPreview } from "@/lib/minijob/guarded-operation";

export interface GuardedDoubles {
  storage: MemoryStorage;
  /** Alle dem Nutzer gezeigten Vergleiche (in Reihenfolge). */
  previews: GuardedPreview[];
  /** Ändert die Antwort der Bestätigung (Standard: bestätigen). */
  setAnswer(answer: boolean | ((p: GuardedPreview) => boolean | Promise<boolean>)): void;
}

export async function installGuardedDoubles(): Promise<GuardedDoubles> {
  const confirm = await import("@/lib/minijob/guarded-confirm");
  const safety = await import("@/lib/minijob/backup-safety");
  const memory = await import("@/lib/minijob/backup-safety.memory");
  const storage = memory.createMemoryStorage();
  const previews: GuardedPreview[] = [];
  let answer: boolean | ((p: GuardedPreview) => boolean | Promise<boolean>) = true;
  safety.setDefaultSnapshotStorageForTests(storage);
  confirm.setConfirmationHandlerForTests(async (preview) => {
    previews.push(preview);
    return typeof answer === "function" ? answer(preview) : answer;
  });
  return {
    storage,
    previews,
    setAnswer(next) {
      answer = next;
    },
  };
}
