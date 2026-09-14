import { describe, expect, it } from "vitest";

import { decideSync, metaForUser, type SyncDecisionInput } from "./cloud";

const base: SyncDecisionInput = {
  hasLocalData: true,
  hasRemote: true,
  localChangedAt: null,
  lastSyncedAt: null,
  remoteUpdatedAt: null,
};

describe("decideSync", () => {
  it("lädt nichts hoch, wenn Gerät und Cloud leer sind", () => {
    expect(decideSync({ ...base, hasLocalData: false, hasRemote: false })).toBe("none");
  });

  it("sichert lokale Daten, wenn keine Cloud-Sicherung existiert", () => {
    expect(decideSync({ ...base, hasRemote: false, localChangedAt: 100 })).toBe("push");
  });

  it("stellt auf einem leeren Gerät die Cloud wieder her", () => {
    expect(decideSync({ ...base, hasLocalData: false, remoteUpdatedAt: 100 })).toBe("restore");
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

  it("überschreibt lokale Daten nicht bei unbekanntem Abgleichstand", () => {
    // Erstlogin auf einem Gerät mit eigenen Daten und vorhandener Cloud-Sicherung
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
    // Sprache/OAuth speichern setzt localChangedAt, ohne dass Schichten/Jobs existieren.
    expect(
      decideSync({
        ...base,
        hasLocalData: false,
        localChangedAt: 500,
        lastSyncedAt: null,
        remoteUpdatedAt: 400,
      }),
    ).toBe("restore");
  });


  it("macht eine bewusste lokale Löschung nicht still rückgängig", () => {
    expect(
      decideSync({ ...base, hasLocalData: false, localChangedAt: 500, lastSyncedAt: 100, remoteUpdatedAt: 100 }),
    ).toBe("push");
  });

  it("meldet Konflikt, wenn lokal geleert wurde und die Cloud neuer ist", () => {
    expect(
      decideSync({ ...base, hasLocalData: false, localChangedAt: 500, lastSyncedAt: 100, remoteUpdatedAt: 400 }),
    ).toBe("conflict");
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
        hasLocalData: true,
        hasRemote: true,
        localChangedAt: next.localChangedAt,
        lastSyncedAt: next.lastSyncedAt,
        remoteUpdatedAt: 400,
      }),
    ).toBe("conflict");
  });
});
