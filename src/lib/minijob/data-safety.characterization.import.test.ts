/**
 * Phase 4 – beide lokalen JSON-Importwege (`restoreLocalBackupFile` in Einstellungen,
 * `importJsonBackupFile` im ImportDialog) laufen durch denselben geschützten Ablauf.
 * (Ersetzt die Phase-1-Charakterisierungstests des früheren, ungeschützten Verhaltens.)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installGuardedDoubles, type GuardedDoubles } from "@/test-utils/guarded-doubles";

import { SnapshotError } from "./backup-safety";
import { importJsonBackupFile } from "./json-backup-import";
import { restoreLocalBackupFile } from "./local-backup-restore";
import { DEMO_SCOPE } from "./storage-scope";
import {
  activateScope,
  getData,
  loadFromStorage,
  onDataChange,
  replaceAll,
  saveJob,
  saveShift,
  updateSettings,
} from "./store";

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

type ImportPath = [
  name: string,
  run: (json: string) => Promise<{ status: string; reason?: string }>,
];

const PATHS: ImportPath[] = [
  [
    "importJsonBackupFile (ImportDialog)",
    (json) => importJsonBackupFile({ text: async () => json }),
  ],
  [
    "restoreLocalBackupFile (Einstellungen)",
    (json) =>
      restoreLocalBackupFile(new Blob([json])) as Promise<{ status: string; reason?: string }>,
  ],
];

let doubles: GuardedDoubles;

beforeEach(async () => {
  window.localStorage.clear();
  doubles = await installGuardedDoubles();
  loadFromStorage();
  activateScope(DEMO_SCOPE);
  replaceAll({ shifts: [], jobs: [] }); // sauberer Ausgangszustand (der Speicher bleibt zwischen Tests)
  updateSettings({ pin: LOCAL_PIN, pinEnabled: true });
  saveJob({ id: "local-j1", name: "Lokal", color: "#111", mode: "flex" });
  saveShift({
    id: "local-s1",
    kind: "arbeit",
    date: "2026-01-05",
    start: "09:00",
    end: "10:00",
    breakMinutes: 0,
    jobId: "local-j1",
  } as never);
});

afterEach(() => {
  onDataChange(null);
});

describe.each(PATHS)("geschützter Import: %s", (_name, run) => {
  it("zeigt zuerst den Vergleich, ersetzt erst nach Bestätigung und sichert den lokalen Stand", async () => {
    const result = await run(backupJson({}));

    expect(result.status).toBe("done");
    expect(getData().shifts.map((s) => s.id)).toEqual(["file-s1"]);
    // Vergleich wurde gezeigt: 1 lokale Schicht geht verloren, 1 Dateischicht kommt hinzu.
    const preview = doubles.previews[0]!;
    expect(preview.kind).toBe("local-import");
    expect(preview.replaces).toBe("local");
    const shifts = preview.collections.find((c) => c.name === "shifts")!;
    expect(shifts.lost).toBe(1);
    expect(shifts.added).toBe(1);
    // Wiederherstellungskopie des verlierenden (lokalen) Standes, verifiziert.
    const snaps = [...doubles.storage.records.values()];
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.kind).toBe("local_pre_import");
    expect(snaps[0]!.state).toBe("verified");
    expect(JSON.parse(snaps[0]!.payload).shifts.map((s: { id: string }) => s.id)).toEqual([
      "local-s1",
    ]);
  });

  it("ohne Bestätigung bleibt ALLES unverändert (keine Kopie, keine Ersetzung)", async () => {
    doubles.setAnswer(false);
    const before = JSON.stringify(getData());

    const result = await run(backupJson({}));

    expect(result.status).toBe("cancelled");
    expect(JSON.stringify(getData())).toBe(before);
    expect(doubles.storage.records.size).toBe(0);
  });

  it("scheitert der Snapshot, wird NICHT ersetzt", async () => {
    doubles.storage.failAlways("put", new SnapshotError("quota"));
    const before = JSON.stringify(getData());

    const result = await run(backupJson({}));

    expect(result).toMatchObject({ status: "aborted", reason: "snapshot-failed" });
    expect(JSON.stringify(getData())).toBe(before);
  });

  it("ungültige Datei: nichts verändert, kein Vergleich gezeigt", async () => {
    const before = JSON.stringify(getData());
    const result = await run(JSON.stringify({ shifts: "kaputt" }));
    expect(result).toMatchObject({ status: "aborted", reason: "invalid-payload" });
    expect(JSON.stringify(getData())).toBe(before);
    expect(doubles.previews).toHaveLength(0);
  });

  it("die lokale Gerätesperre bleibt erhalten, wenn die Datei keine PIN enthält", async () => {
    await run(backupJson({}));
    expect(getData().settings.pin).toBe(LOCAL_PIN);
    expect(getData().settings.pinEnabled).toBe(true);
  });

  it("PIN/Biometrie aus der Datei werden ignoriert; die lokale PIN bleibt", async () => {
    await run(
      backupJson({ pin: FILE_PIN, pinEnabled: true, biometric: true, biometricCredentialId: "x" }),
    );
    expect(getData().settings.pin).toBe(LOCAL_PIN);
    expect(getData().settings.pin).not.toBe(FILE_PIN);
    expect(getData().settings.biometricCredentialId).toBeUndefined();
  });

  it("hat das Gerät KEINE Sperre, wird auch keine aus der Datei übernommen", async () => {
    const { pin: _pin, ...withoutPin } = getData().settings;
    replaceAll({ ...getData(), settings: { ...withoutPin, pinEnabled: false, biometric: false } });
    await run(
      backupJson({ pin: FILE_PIN, pinEnabled: true, biometric: true, biometricCredentialId: "x" }),
    );
    expect(getData().settings.pin).toBeUndefined();
    expect(getData().settings.pinEnabled).toBe(false);
    expect(getData().settings.biometricCredentialId).toBeUndefined();
    // Auch die Wiederherstellungskopie enthält keine Gerätesperre.
    const text = [...doubles.storage.records.values()].map((r) => r.payload).join("");
    expect(text).not.toContain(FILE_PIN);
  });

  it("Änderung der lokalen Daten nach dem Vergleich → Abbruch, nichts ersetzt", async () => {
    doubles.setAnswer(() => {
      // Nutzer sieht den Vergleich; währenddessen ändert sich der lokale Stand.
      saveJob({ id: "late-j", name: "Spät", color: "#222", mode: "flex" });
      return true;
    });
    const result = await run(backupJson({}));
    expect(result).toMatchObject({ status: "aborted", reason: "local-changed" });
    expect(getData().shifts.map((s) => s.id)).toEqual(["local-s1"]);
  });
});

describe("kein ungeschützter Importpfad", () => {
  it("die beiden Importmodule rufen replaceAll nicht mehr selbst auf", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["json-backup-import.ts", "local-backup-restore.ts"]) {
      const src = readFileSync(`${process.cwd()}/src/lib/minijob/${f}`, "utf8");
      expect(src).not.toMatch(/replaceAll/);
    }
  });
});
