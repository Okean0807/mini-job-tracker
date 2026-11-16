/** Data-safety Phase 1 – `deriveBackupHealth`, `computeDirty`. */
import { describe, expect, it } from "vitest";

import {
  computeDirty,
  deriveBackupHealth,
  STALE_BACKUP_MS,
  type BackupHealthInput,
  type BackupHealthState,
} from "./backup-status";

const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function input(over: Partial<BackupHealthInput> = {}): BackupHealthInput {
  return {
    signedIn: true,
    scopeKind: "user",
    origin: "canonical",
    hasData: true,
    autoBackup: true,
    online: true,
    syncStatus: "synced",
    dirty: false,
    lastVerifiedAt: NOW - DAY,
    now: NOW,
    ...over,
  };
}

const state = (over: Partial<BackupHealthInput>): BackupHealthState =>
  deriveBackupHealth(input(over)).state;

describe("deriveBackupHealth – alle Zustände", () => {
  it("clean: angemeldet, verifiziert, nicht schmutzig", () => {
    expect(deriveBackupHealth(input())).toMatchObject({ state: "clean", severity: "ok" });
  });

  it("dirty: Änderungen und Auto-Backup an", () => {
    expect(deriveBackupHealth(input({ dirty: true }))).toMatchObject({
      state: "dirty",
      severity: "info",
    });
  });

  it("dirty-autobackup-off: Änderungen sind sichtbar, auch wenn Auto-Backup aus ist", () => {
    expect(deriveBackupHealth(input({ dirty: true, autoBackup: false }))).toMatchObject({
      state: "dirty-autobackup-off",
      severity: "warning",
    });
  });

  it("offline-pending: offline mit ungesicherten Änderungen (online=false oder Status offline)", () => {
    expect(state({ dirty: true, online: false })).toBe("offline-pending");
    expect(state({ dirty: true, syncStatus: "offline" })).toBe("offline-pending");
  });

  it("offline ohne Änderungen ist nicht auffällig", () => {
    expect(state({ dirty: false, online: false })).toBe("clean");
  });

  it("failed: Fehler im Abgleich", () => {
    expect(deriveBackupHealth(input({ syncStatus: "error" }))).toMatchObject({
      state: "failed",
      severity: "error",
    });
  });

  it("conflict: bleibt sichtbar, hat Vorrang vor Fehler und allem anderen", () => {
    expect(deriveBackupHealth(input({ syncStatus: "conflict" }))).toMatchObject({
      state: "conflict",
      severity: "error",
    });
    expect(
      state({
        syncStatus: "conflict",
        dirty: true,
        autoBackup: false,
        online: false,
        origin: "non-canonical",
      }),
    ).toBe("conflict");
  });

  it("no-verified-backup: angemeldet mit Daten, aber nie verifiziert", () => {
    expect(deriveBackupHealth(input({ lastVerifiedAt: null }))).toMatchObject({
      state: "no-verified-backup",
      severity: "warning",
    });
    expect(state({ lastVerifiedAt: null, dirty: true })).toBe("no-verified-backup");
  });

  it("stale: ungesicherte Daten und letzte Sicherung > 7 Tage", () => {
    expect(deriveBackupHealth(input({ dirty: true, lastVerifiedAt: NOW - 8 * DAY }))).toMatchObject(
      {
        state: "stale",
        severity: "warning",
        daysSinceVerified: 8,
      },
    );
  });

  it("local-only: abgemeldet, Testmodus, anderer Scope oder fremde Adresse (mit Daten)", () => {
    expect(deriveBackupHealth(input({ signedIn: false, scopeKind: "guest" }))).toMatchObject({
      state: "local-only",
      reasons: ["signed-out"],
    });
    expect(deriveBackupHealth(input({ signedIn: false, scopeKind: "demo" })).reasons).toEqual([
      "test-mode",
    ]);
    expect(deriveBackupHealth(input({ signedIn: true, scopeKind: "demo" })).reasons).toEqual([
      "test-mode",
    ]);
  });
});

/**
 * Phase 2 correction of the Phase 1 contract: a foreign origin is an INDEPENDENT warning and
 * never replaces (hides) the actual backup state.
 */
describe("Herkunfts-Warnung ist unabhängig vom Sicherungszustand", () => {
  const foreign = { origin: "non-canonical" as const };

  it("meldet die Warnung getrennt und lässt den Zustand unberührt", () => {
    expect(deriveBackupHealth(input(foreign))).toMatchObject({
      state: "clean",
      originWarning: true,
    });
    expect(deriveBackupHealth(input({ origin: "canonical" })).originWarning).toBe(false);
    expect(deriveBackupHealth(input({ origin: "development" })).originWarning).toBe(false);
  });

  it("verdeckt weder ungesicherte Daten noch Fehler, Konflikte oder fehlende Sicherungen", () => {
    expect(state({ ...foreign, dirty: true })).toBe("dirty");
    expect(state({ ...foreign, dirty: true, autoBackup: false })).toBe("dirty-autobackup-off");
    expect(state({ ...foreign, dirty: true, lastVerifiedAt: NOW - 8 * DAY })).toBe("stale");
    expect(state({ ...foreign, dirty: true, online: false })).toBe("offline-pending");
    expect(state({ ...foreign, syncStatus: "error" })).toBe("failed");
    expect(state({ ...foreign, syncStatus: "conflict" })).toBe("conflict");
    expect(state({ ...foreign, lastVerifiedAt: null })).toBe("no-verified-backup");
    for (const over of [
      { dirty: true },
      { syncStatus: "error" as const },
      { lastVerifiedAt: null },
    ]) {
      expect(deriveBackupHealth(input({ ...foreign, ...over })).originWarning).toBe(true);
    }
  });

  it("local-only (abgemeldet/Testmodus) trägt die Herkunftswarnung ebenfalls getrennt", () => {
    expect(
      deriveBackupHealth(input({ ...foreign, signedIn: false, scopeKind: "guest" })),
    ).toMatchObject({
      state: "local-only",
      originWarning: true,
    });
  });
});

describe("Grenzfälle und Prioritäten", () => {
  it("genau 7 Tage ist noch nicht veraltet, mehr als 7 Tage schon", () => {
    expect(STALE_BACKUP_MS).toBe(7 * DAY);
    expect(state({ dirty: true, lastVerifiedAt: NOW - 7 * DAY })).toBe("dirty");
    expect(state({ dirty: true, lastVerifiedAt: NOW - 7 * DAY - 1 })).toBe("stale");
    expect(state({ dirty: true, autoBackup: false, lastVerifiedAt: NOW - 7 * DAY })).toBe(
      "dirty-autobackup-off",
    );
  });

  it("veraltet nur mit ungesicherten Daten: sauber bleibt sauber, auch nach 30 Tagen", () => {
    expect(state({ dirty: false, lastVerifiedAt: NOW - 30 * DAY })).toBe("clean");
  });

  it("ohne Daten gibt es nichts zu sichern – in jedem Anmeldezustand", () => {
    expect(
      deriveBackupHealth(input({ hasData: false, signedIn: false, scopeKind: "guest" })),
    ).toMatchObject({
      state: "clean",
      reasons: ["no-data"],
    });
    expect(state({ hasData: false, lastVerifiedAt: null })).toBe("clean");
  });

  it("Entwicklungs-Adresse verhält sich wie die kanonische", () => {
    expect(state({ origin: "development" })).toBe("clean");
    expect(state({ origin: "development", dirty: true })).toBe("dirty");
  });

  it("Fehler hat Vorrang vor local-only und offline", () => {
    expect(state({ syncStatus: "error", origin: "non-canonical" })).toBe("failed");
    expect(state({ syncStatus: "error", online: false, dirty: true })).toBe("failed");
  });

  it("sauber ist NIE allein aus 'nicht schmutzig' abgeleitet: ohne verifizierte Sicherung nicht clean", () => {
    expect(state({ dirty: false, lastVerifiedAt: null })).toBe("no-verified-backup");
  });

  it("während 'syncing' zählt nur dirty", () => {
    expect(state({ syncStatus: "syncing", dirty: false })).toBe("clean");
    expect(state({ syncStatus: "syncing", dirty: true })).toBe("dirty");
  });

  it("verändert die Eingabe nicht und hat keine Premium-Abhängigkeit", () => {
    const original = input({ dirty: true });
    const copy = JSON.stringify(original);
    deriveBackupHealth(original);
    expect(JSON.stringify(original)).toBe(copy);
    expect(Object.keys(original)).not.toContain("premium");
  });
});

describe("computeDirty – aus Änderungsmarken, nicht aus pending", () => {
  it("Änderungsmarken → dirty, unabhängig von Auto-Backup", () => {
    expect(computeDirty({ localChangedAt: 5, lastSyncedAt: 10, hasData: true })).toBe(true);
    expect(
      computeDirty({
        localChangedAt: null,
        localWorkChangedAt: 5,
        lastSyncedAt: 10,
        hasData: true,
      }),
    ).toBe(true);
  });

  it("keine Marken und abgeglichen → nicht dirty", () => {
    expect(
      computeDirty({
        localChangedAt: null,
        localWorkChangedAt: null,
        lastSyncedAt: 10,
        hasData: true,
      }),
    ).toBe(false);
  });

  it("Daten, die nie abgeglichen wurden → dirty; ohne Daten nicht", () => {
    expect(computeDirty({ localChangedAt: null, lastSyncedAt: null, hasData: true })).toBe(true);
    expect(computeDirty({ localChangedAt: null, lastSyncedAt: null, hasData: false })).toBe(false);
  });
});
