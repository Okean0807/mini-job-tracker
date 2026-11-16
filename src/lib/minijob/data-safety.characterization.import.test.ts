/**
 * TEMPORARY CHARACTERIZATION TESTS (Data-safety Phase 1) – lokaler JSON-Import.
 *
 * Halten das HEUTIGE, nachweislich unsichere Verhalten beider Importwege fest
 * (`restoreLocalBackupFile` in Einstellungen, `importJsonBackupFile` im ImportDialog):
 * - der Import markiert die Daten NICHT als geändert (`replaceAll` committet mit sync=false),
 * - der Import ersetzt oder entfernt die lokale Gerätesperre (PIN/Biometrie).
 *
 * EXPECTED SECURE BEHAVIOUR (Phase 4): beide Wege laufen durch denselben geführten Ablauf
 * (Vergleich, Anzeige, Snapshot, Bestätigung), setzen die Änderungsmarke und behalten die lokale
 * Gerätesperre. Sobald das umgesetzt ist, müssen diese Tests ersetzt werden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { importJsonBackupFile } from "./json-backup-import";
import { restoreLocalBackupFile } from "./local-backup-restore";
import { DEMO_SCOPE } from "./storage-scope";
import { activateScope, getData, loadFromStorage, onDataChange, updateSettings } from "./store";

const LOCAL_PIN = "4321";
const FILE_PIN = "8765";

function backupJson(settings: Record<string, unknown>): string {
  return JSON.stringify({
    shifts: [
      {
        id: "file-s1",
        kind: "arbeit",
        date: "2026-09-16",
        start: "08:00",
        end: "12:00",
        breakMinutes: 0,
      },
    ],
    jobs: [{ id: "file-j1", name: "Job", color: "#000", mode: "flex" }],
    settings: { onboarded: true, ...settings },
  });
}

type ImportPath = [name: string, run: (json: string) => Promise<unknown>];

const PATHS: ImportPath[] = [
  [
    "importJsonBackupFile (ImportDialog)",
    (json) => importJsonBackupFile({ text: async () => json }),
  ],
  ["restoreLocalBackupFile (Einstellungen)", (json) => restoreLocalBackupFile(new Blob([json]))],
];

beforeEach(() => {
  window.localStorage.clear();
  loadFromStorage();
  activateScope(DEMO_SCOPE);
  updateSettings({ pin: LOCAL_PIN, pinEnabled: true });
});

afterEach(() => {
  onDataChange(null);
});

describe.each(PATHS)("TEMPORARY CHARACTERIZATION: %s", (_name, run) => {
  it("ersetzt die Daten, markiert sie aber NICHT als geändert (kein Änderungs-Hook)", async () => {
    const hook = vi.fn();
    onDataChange(hook);

    const result = await run(backupJson({}));

    expect(["restored", "imported"]).toContain(result);
    expect(getData().shifts.map((s) => s.id)).toEqual(["file-s1"]); // lokale Daten ersetzt
    // CURRENT: kein sync-Commit → `scheduleBackup` läuft nie, der Zustand bleibt "sauber".
    expect(hook).not.toHaveBeenCalled();
    // EXPECTED SECURE BEHAVIOUR: Änderungsmarke gesetzt (dirty), Status zeigt ungesicherte Daten.
  });

  it("entfernt die lokale Gerätesperre, wenn die Datei keine PIN enthält", async () => {
    expect(getData().settings.pinEnabled).toBe(true);

    await run(backupJson({}));

    // CURRENT: PIN und Sperre sind weg.
    expect(getData().settings.pin).toBeUndefined();
    expect(getData().settings.pinEnabled).toBe(false);
    // EXPECTED SECURE BEHAVIOUR: lokale Gerätesperre bleibt unverändert erhalten.
  });

  it("übernimmt die PIN aus der Datei und überschreibt die lokale", async () => {
    await run(backupJson({ pin: FILE_PIN, pinEnabled: true }));

    // CURRENT: die Gerätesperre der Datei ersetzt die lokale (fremde PIN auf diesem Gerät).
    expect(getData().settings.pin).toBe(FILE_PIN);
    expect(getData().settings.pin).not.toBe(LOCAL_PIN);
    // EXPECTED SECURE BEHAVIOUR: PIN/Biometrie aus der Datei werden ignoriert; lokale bleibt.
  });
});
