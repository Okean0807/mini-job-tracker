import { describe, expect, it } from "vitest";

import {
  classifySyncSituation,
  decideSync,
  metaForUser,
  type SyncDecisionInput,
} from "./cloud";

const base: SyncDecisionInput = {
  hasLocalWorkData: true,
  hasRemote: true,
  localChangedAt: null,
  lastSyncedAt: null,
  remoteUpdatedAt: null,
};

describe("decideSync", () => {
  it("lädt nichts hoch, wenn Gerät und Cloud leer sind", () => {
    expect(decideSync({ ...base, hasLocalWorkData: false, hasRemote: false })).toBe("none");
  });

  it("sichert lokale Daten, wenn keine Cloud-Sicherung existiert", () => {
    expect(decideSync({ ...base, hasRemote: false, localChangedAt: 100 })).toBe("push");
  });

  it("stellt auf einem leeren Gerät die Cloud wieder her", () => {
    expect(decideSync({ ...base, hasLocalWorkData: false, remoteUpdatedAt: 100 })).toBe("restore");
  });

  it("lädt hoch, wenn nur lokal geändert wurde", () => {
    expect(
      decideSync({ ...base, localChangedAt: 200, lastSyncedAt: 100, remoteUpdatedAt: 100 }),
    ).toBe("push");
  });

  it("lädt herunter, wenn nur die Cloud neuer ist", () => {
    expect(
      decideSync({ ...base, localChangedAt: 50, lastSyncedAt: 100, remoteUpdatedAt: 300 }),
    ).toBe("restore");
  });

  it("meldet einen Konflikt, wenn beide Seiten seit dem Abgleich geändert wurden", () => {
    expect(
      decideSync({ ...base, localChangedAt: 250, lastSyncedAt: 100, remoteUpdatedAt: 300 }),
    ).toBe("conflict");
  });

  it("tut nichts, wenn seit dem letzten Abgleich nichts passiert ist", () => {
    expect(
      decideSync({ ...base, localChangedAt: 100, lastSyncedAt: 100, remoteUpdatedAt: 100 }),
    ).toBe("none");
  });

  it("überschreibt lokale Schichten nicht bei unbekanntem Abgleichstand (nie synced + shifts + remote)", () => {
    // Erstlogin auf einem Gerät mit eigenen Schichten und vorhandener Cloud-Sicherung
    expect(
      decideSync({ ...base, localChangedAt: 500, lastSyncedAt: null, remoteUpdatedAt: 400 }),
    ).toBe("conflict");
  });

  it("stellt wieder her, wenn lokal nie geändert wurde", () => {
    expect(
      decideSync({ ...base, localChangedAt: null, lastSyncedAt: null, remoteUpdatedAt: 400 }),
    ).toBe("restore");
  });

  it("meldet keinen Konflikt bei Einstellungs-Marken vor dem ersten Abgleich (Einrichtungsassistent)", () => {
    // Sprache/OAuth speichern setzt localChangedAt, ohne dass Schichten existieren.
    expect(
      decideSync({
        ...base,
        hasLocalWorkData: false,
        localChangedAt: 500,
        lastSyncedAt: null,
        remoteUpdatedAt: 400,
      }),
    ).toBe("restore");
  });

  it("FIRST_SYNC: Jobs allein ohne Schichten + remote → conflict (jobs-only survival)", () => {
    expect(
      decideSync({
        ...base,
        hasLocalWorkData: false,
        hasLocalJobs: true,
        localChangedAt: 900,
        lastSyncedAt: null,
        remoteUpdatedAt: 800,
      }),
    ).toBe("conflict");
    expect(
      classifySyncSituation({
        ...base,
        hasLocalWorkData: false,
        hasLocalJobs: true,
        localChangedAt: 900,
        lastSyncedAt: null,
        remoteUpdatedAt: 800,
      }),
    ).toBe("CONFLICT");
  });

  it("FIRST_SYNC: onboarding / wizard jobs ignored → restore (no false conflict)", () => {
    expect(
      decideSync({
        ...base,
        hasLocalWorkData: false,
        hasLocalJobs: true,
        ignoreLocalJobsOnFirstSync: true,
        localChangedAt: 900,
        lastSyncedAt: null,
        remoteUpdatedAt: 800,
      }),
    ).toBe("restore");
    expect(
      classifySyncSituation({
        ...base,
        hasLocalWorkData: false,
        hasLocalJobs: true,
        ignoreLocalJobsOnFirstSync: true,
        localChangedAt: 900,
        lastSyncedAt: null,
        remoteUpdatedAt: 800,
      }),
    ).toBe("FIRST_SYNC_RESTORE");
  });

  it("FIRST_SYNC: keine Jobs und keine Schichten → restore", () => {
    expect(
      decideSync({
        ...base,
        hasLocalWorkData: false,
        hasLocalJobs: false,
        localChangedAt: 900,
        lastSyncedAt: null,
        remoteUpdatedAt: 800,
      }),
    ).toBe("restore");
    expect(
      classifySyncSituation({
        ...base,
        hasLocalWorkData: false,
        hasLocalJobs: false,
        localChangedAt: 900,
        lastSyncedAt: null,
        remoteUpdatedAt: 800,
      }),
    ).toBe("FIRST_SYNC_RESTORE");
  });

  it("NEW_DEVICE / EMPTY_DEVICE ohne Schichten + Cloud → FIRST_SYNC_RESTORE", () => {
    expect(
      classifySyncSituation({
        ...base,
        hasLocalWorkData: false,
        localChangedAt: null,
        lastSyncedAt: null,
        remoteUpdatedAt: 100,
      }),
    ).toBe("FIRST_SYNC_RESTORE");
  });

  it("macht eine bewusste lokale Löschung nicht still rückgängig", () => {
    expect(
      decideSync({
        ...base,
        hasLocalWorkData: false,
        localChangedAt: 500,
        lastSyncedAt: 100,
        remoteUpdatedAt: 100,
      }),
    ).toBe("push");
  });

  it("meldet Konflikt, wenn lokal geleert wurde und die Cloud neuer ist", () => {
    expect(
      decideSync({
        ...base,
        hasLocalWorkData: false,
        localChangedAt: 500,
        lastSyncedAt: 100,
        remoteUpdatedAt: 400,
      }),
    ).toBe("conflict");
  });
});

describe("classifySyncSituation", () => {
  it("mappt Entscheidungen auf Labels", () => {
    expect(
      classifySyncSituation({
        ...base,
        localChangedAt: 100,
        lastSyncedAt: 100,
        remoteUpdatedAt: 100,
      }),
    ).toBe("NO_CHANGE");
    expect(
      classifySyncSituation({
        ...base,
        localChangedAt: 200,
        lastSyncedAt: 100,
        remoteUpdatedAt: 100,
      }),
    ).toBe("PUSH");
    expect(
      classifySyncSituation({
        ...base,
        localChangedAt: 50,
        lastSyncedAt: 100,
        remoteUpdatedAt: 300,
      }),
    ).toBe("RESTORE");
    expect(
      classifySyncSituation({
        ...base,
        localChangedAt: 250,
        lastSyncedAt: 100,
        remoteUpdatedAt: 300,
      }),
    ).toBe("CONFLICT");
  });
});

describe("metaForUser", () => {
  it("behält Metadaten desselben Kontos unverändert", () => {
    const m = { userId: "a", localChangedAt: 5, lastSyncedAt: 10, remoteSeenAt: 20 };
    expect(metaForUser(m, "a")).toBe(m);
  });

  it("verwirft fremden Abgleichstand nach Kontowechsel", () => {
    const next = metaForUser(
      { userId: "a", localChangedAt: 5, lastSyncedAt: 999, remoteSeenAt: 999 },
      "b",
    );
    expect(next.userId).toBe("b");
    expect(next.lastSyncedAt).toBeNull();
    expect(next.remoteSeenAt).toBeNull();
    expect(next.localChangedAt).toBe(5);
  });

  it("markiert vorhandene Gerätedaten beim Erstlogin als lokal geändert", () => {
    const next = metaForUser(
      { userId: null, localChangedAt: null, lastSyncedAt: null, remoteSeenAt: null },
      "a",
    );
    expect(next.localChangedAt).not.toBeNull();
  });

  it("führt nach Kontowechsel zu einem Konflikt statt stillem Überschreiben", () => {
    const next = metaForUser(
      { userId: "a", localChangedAt: 500, lastSyncedAt: 999, remoteSeenAt: 999 },
      "b",
    );
    expect(
      decideSync({
        hasLocalWorkData: true,
        hasRemote: true,
        localChangedAt: next.localChangedAt,
        lastSyncedAt: next.lastSyncedAt,
        remoteUpdatedAt: 400,
      }),
    ).toBe("conflict");
  });

  it("erfindet keine Änderungsmarke ohne lokale Schichten", () => {
    const next = metaForUser(
      { userId: null, localChangedAt: null, lastSyncedAt: null, remoteSeenAt: null },
      "a",
      false,
    );
    expect(next.localChangedAt).toBeNull();
  });
});
