import { describe, expect, it } from "vitest";

import { decideSync, type SyncDecisionInput } from "./cloud";

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
});
