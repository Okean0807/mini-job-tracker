import { isoDate } from "./calc";
import type { AppData } from "./types";

/**
 * Export der lokalen JSON-Sicherung. Das Format ist unverändert
 * (`JSON.stringify(getData(), null, 2)`); neu ist nur der Weg zum Datenträger:
 *
 * 1. Wo der Browser `showSaveFilePicker` anbietet (File System Access API), öffnet sich der
 *    System-Dialog „Speichern unter“ (Ordner/Dateiname frei wählbar).
 * 2. Sonst bleibt der bisherige Download (Anker mit `download`). Es wird kein Dialog nachgebaut.
 *
 * Die Funktion muss direkt im Klick-Handler gestartet werden: der Picker wird ohne vorheriges
 * `await` aufgerufen, damit die Nutzeraktivierung noch gilt.
 */
export type BackupExportOutcome = "saved" | "downloaded" | "cancelled" | "failed";

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}
interface WritableLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}
interface FileHandleLike {
  createWritable(): Promise<WritableLike>;
}
type SaveFilePicker = (options?: SaveFilePickerOptions) => Promise<FileHandleLike>;

export const BACKUP_MIME = "application/json";

export function defaultBackupFilename(date: Date = new Date()): string {
  return `minijob-companion-backup-${isoDate(date)}.json`;
}

/** Exakt die bisherige Serialisierung – nicht ändern, der Restore-Pfad liest dieses Format. */
export function serializeBackup(data: AppData): string {
  return JSON.stringify(data, null, 2);
}

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "";
}

function getSavePicker(): SaveFilePicker | null {
  if (typeof window === "undefined") return null;
  const picker = (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  return typeof picker === "function" ? (picker as SaveFilePicker).bind(window) : null;
}

/** Bisheriger Mechanismus; „downloaded“ heißt nur: der Download wurde angestoßen. */
function downloadBlob(blob: Blob, filename: string): BackupExportOutcome {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "downloaded";
  } catch {
    return "failed";
  }
}

export function exportBackup(data: AppData): Promise<BackupExportOutcome> {
  // Synchron vorbereiten, damit der Picker ohne vorheriges await aufgerufen wird.
  const filename = defaultBackupFilename();
  const blob = new Blob([serializeBackup(data)], { type: BACKUP_MIME });
  const picker = getSavePicker();
  if (!picker) return Promise.resolve(downloadBlob(blob, filename));
  return saveWithPicker(picker, blob, filename);
}

async function saveWithPicker(
  picker: SaveFilePicker,
  blob: Blob,
  filename: string,
): Promise<BackupExportOutcome> {
  let handle: FileHandleLike;
  try {
    handle = await picker({
      suggestedName: filename,
      types: [{ description: "JSON", accept: { [BACKUP_MIME]: [".json"] } }],
    });
  } catch (error) {
    const name = errorName(error);
    if (name === "AbortError") return "cancelled"; // normaler Ausgang, keine Meldung
    // Picker in diesem Kontext nicht nutzbar (z. B. iframe/WebView): bisheriger Download.
    if (name === "SecurityError" || name === "TypeError" || name === "NotSupportedError") {
      return downloadBlob(blob, filename);
    }
    return "failed";
  }

  let writable: WritableLike | null = null;
  try {
    writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "saved";
  } catch {
    try {
      await writable?.abort?.();
    } catch {
      /* Schreibfehler wird unten gemeldet */
    }
    return "failed";
  }
}
