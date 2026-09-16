import { describe, expect, it } from "vitest";

import {
  classifySyncSituation,
  decideSync,
  explainSyncDecision,
  metaForUser,
  workFingerprint,
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
      decideSync({
        ...base,
        localChangedAt: 250,
        localWorkChangedAt: 250,
        lastSyncedAt: 100,
        remoteUpdatedAt: 300,
      }),
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
        localWorkChangedAt: 250,
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

  it("H2: null→userId bind behält lastSyncedAt (kein Fake-Erstsync)", () => {
    const next = metaForUser(
      {
        userId: null,
        localChangedAt: 200,
        localWorkChangedAt: 50,
        lastSyncedAt: 999,
        remoteSeenAt: 999,
      },
      "a",
      true,
    );
    expect(next.userId).toBe("a");
    expect(next.lastSyncedAt).toBe(999);
    expect(next.remoteSeenAt).toBe(999);
  });

  it("H2: null→userId mit Schichten behält Baseline 999", () => {
    const next = metaForUser(
      {
        userId: null,
        localChangedAt: 100,
        lastSyncedAt: 999,
        remoteSeenAt: 900,
      },
      "user-1",
      true,
    );
    expect(next.lastSyncedAt).toBe(999);
    expect(next.remoteSeenAt).toBe(900);
  });
});

describe("decideSync A–I (false conflict / work vs settings)", () => {
  // A new empty → restore/none
  it("A: new empty device + remote → restore; empty+empty → none", () => {
    expect(
      decideSync({
        ...base,
        hasLocalWorkData: false,
        hasLocalJobs: false,
        localChangedAt: null,
        lastSyncedAt: null,
        remoteUpdatedAt: 100,
      }),
    ).toBe("restore");
    expect(
      decideSync({
        ...base,
        hasLocalWorkData: false,
        hasRemote: false,
        localChangedAt: null,
        lastSyncedAt: null,
        remoteUpdatedAt: null,
      }),
    ).toBe("none");
  });

  // B onboarding ignore jobs → restore
  it("B: onboarding ignoreLocalJobsOnFirstSync → restore", () => {
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
  });

  // C unchanged → none
  it("C: unchanged since baseline → none", () => {
    expect(
      decideSync({
        ...base,
        localChangedAt: 100,
        localWorkChangedAt: 100,
        lastSyncedAt: 100,
        remoteUpdatedAt: 100,
      }),
    ).toBe("none");
  });

  // D settings-only local change + cloud unchanged → push NOT conflict
  it("D: settings-only local + cloud unchanged → push", () => {
    expect(
      decideSync({
        ...base,
        localChangedAt: 200,
        localWorkChangedAt: 50,
        lastSyncedAt: 100,
        remoteUpdatedAt: 100,
      }),
    ).toBe("push");
  });

  // E local work + cloud both new → conflict
  it("E: local work + cloud both new after baseline → conflict", () => {
    expect(
      decideSync({
        ...base,
        localChangedAt: 200,
        localWorkChangedAt: 200,
        lastSyncedAt: 100,
        remoteUpdatedAt: 150,
      }),
    ).toBe("conflict");
  });

  // F local work unchanged + cloud new → restore
  it("F: local work unchanged + cloud new → restore", () => {
    expect(
      decideSync({
        ...base,
        localChangedAt: 200,
        localWorkChangedAt: 50,
        lastSyncedAt: 100,
        remoteUpdatedAt: 150,
      }),
    ).toBe("restore");
    expect(
      decideSync({
        ...base,
        localChangedAt: 200,
        localWorkChangedAt: null,
        lastSyncedAt: 100,
        remoteUpdatedAt: 150,
      }),
    ).toBe("restore");
  });

  // G local work/settings changed + cloud unchanged → push
  it("G: local work/settings changed + cloud unchanged → push", () => {
    expect(
      decideSync({
        ...base,
        localChangedAt: 200,
        localWorkChangedAt: 200,
        lastSyncedAt: 100,
        remoteUpdatedAt: 100,
      }),
    ).toBe("push");
  });

  // H reload/meta preserve — covered above; assert decide after bind
  it("H: after null→userId bind keeping lastSyncedAt, settings stamp is not conflict", () => {
    const next = metaForUser(
      {
        userId: null,
        localChangedAt: 200,
        localWorkChangedAt: 50,
        lastSyncedAt: 999,
        remoteSeenAt: 999,
      },
      "a",
      true,
    );
    expect(next.lastSyncedAt).toBe(999);
    // Settings changed after baseline, work did not, cloud unchanged → push
    expect(
      decideSync({
        hasLocalWorkData: true,
        hasRemote: true,
        localChangedAt: 1200,
        localWorkChangedAt: next.localWorkChangedAt ?? 50,
        lastSyncedAt: next.lastSyncedAt,
        remoteUpdatedAt: 999,
      }),
    ).toBe("push");
    // Same with cloud slightly newer than baseline but work unchanged → restore, not conflict
    expect(
      decideSync({
        hasLocalWorkData: true,
        hasRemote: true,
        localChangedAt: 1200,
        localWorkChangedAt: 50,
        lastSyncedAt: next.lastSyncedAt,
        remoteUpdatedAt: 1100,
      }),
    ).toBe("restore");
  });

  // I leftover jobs after onboarded still conflict on first sync
  it("I: leftover jobs after onboarded still conflict on first sync", () => {
    expect(
      decideSync({
        ...base,
        hasLocalWorkData: false,
        hasLocalJobs: true,
        ignoreLocalJobsOnFirstSync: false,
        localChangedAt: 900,
        lastSyncedAt: null,
        remoteUpdatedAt: 800,
      }),
    ).toBe("conflict");
  });

  it("regression: settings stamp must not conflict; work stamp must", () => {
    // has shifts, lastSyncedAt=100, localChangedAt=200 (settings), localWorkChangedAt=50|null, remote=150
    expect(
      decideSync({
        ...base,
        localChangedAt: 200,
        localWorkChangedAt: 50,
        lastSyncedAt: 100,
        remoteUpdatedAt: 150,
      }),
    ).not.toBe("conflict");
    expect(
      decideSync({
        ...base,
        localChangedAt: 200,
        localWorkChangedAt: null,
        lastSyncedAt: 100,
        remoteUpdatedAt: 150,
      }),
    ).not.toBe("conflict");
    expect(
      decideSync({
        ...base,
        localChangedAt: 200,
        localWorkChangedAt: 200,
        lastSyncedAt: 100,
        remoteUpdatedAt: 150,
      }),
    ).toBe("conflict");
  });

  it("explainSyncDecision returns decision + flags (no secrets)", () => {
    const explained = explainSyncDecision({
      ...base,
      localChangedAt: 200,
      localWorkChangedAt: 50,
      lastSyncedAt: 100,
      remoteUpdatedAt: 150,
    });
    expect(explained.decision).toBe("restore");
    expect(explained.remoteIsNew).toBe(true);
    expect(explained.localIsNew).toBe(true);
    expect(explained.localWorkIsNew).toBe(false);
    expect(explained).not.toHaveProperty("payload");
    expect(JSON.stringify(explained)).not.toMatch(/password|token|secret|pin/i);
  });
});

describe("workFingerprint (normalize-safe)", () => {
  type Work = Pick<import("./types").AppData, "shifts" | "jobs">;

  it("raw remote missing kind/breakMinutes equals normalized local with defaults", () => {
    const rawRemote = {
      shifts: [{ id: "s1", date: "2026-09-01", start: "09:00", end: "12:00", jobId: "j1" }],
      jobs: [{ id: "j1", name: "Café", color: "#0d9488", mode: "flex" as const }],
    } as unknown as Work;
    const normalizedLocal = {
      shifts: [
        {
          id: "s1",
          date: "2026-09-01",
          start: "09:00",
          end: "12:00",
          jobId: "j1",
          kind: "arbeit" as const,
          breakMinutes: 0,
        },
      ],
      jobs: [{ id: "j1", name: "Café", color: "#0d9488", mode: "flex" as const }],
    } as unknown as Work;
    expect(workFingerprint(normalizedLocal)).toBe(workFingerprint(rawRemote));
  });

  it("job rate:0 on remote stripped locally → equal fingerprint", () => {
    const rawRemote = {
      shifts: [],
      jobs: [{ id: "j1", name: "Café", color: "#0d9488", mode: "flex" as const, rate: 0 }],
    } as unknown as Work;
    const normalizedLocal = {
      shifts: [],
      jobs: [{ id: "j1", name: "Café", color: "#0d9488", mode: "flex" as const }],
    } as unknown as Work;
    expect(workFingerprint(normalizedLocal)).toBe(workFingerprint(rawRemote));
  });

  it("different key order same data → equal fingerprint", () => {
    const a = {
      shifts: [{ id: "s1", date: "2026-09-01", start: "09:00", end: "12:00", kind: "arbeit" as const, breakMinutes: 0 }],
      jobs: [{ id: "j1", name: "Café", color: "#0d9488", mode: "flex" as const, rate: 12 }],
    } as unknown as Work;
    const b = {
      shifts: [{ breakMinutes: 0, kind: "arbeit" as const, end: "12:00", start: "09:00", date: "2026-09-01", id: "s1" }],
      jobs: [{ mode: "flex" as const, color: "#0d9488", name: "Café", id: "j1", rate: 12 }],
    } as unknown as Work;
    expect(workFingerprint(a)).toBe(workFingerprint(b));
  });

  it("different shift hours → unequal fingerprint", () => {
    const a = {
      shifts: [{ id: "s1", date: "2026-09-01", start: "09:00", end: "12:00", kind: "arbeit" as const, breakMinutes: 0 }],
      jobs: [],
    } as unknown as Work;
    const b = {
      shifts: [{ id: "s1", date: "2026-09-01", start: "09:00", end: "17:00", kind: "arbeit" as const, breakMinutes: 0 }],
      jobs: [],
    } as unknown as Work;
    expect(workFingerprint(a)).not.toBe(workFingerprint(b));
  });

  it("jobs-only identical → equal; jobs-only different → unequal", () => {
    const a = {
      shifts: [],
      jobs: [{ id: "j1", name: "Café", color: "#0d9488", mode: "flex" as const }],
    } as unknown as Work;
    const b = {
      shifts: [],
      jobs: [{ id: "j1", name: "Café", color: "#0d9488", mode: "flex" as const }],
    } as unknown as Work;
    const c = {
      shifts: [],
      jobs: [{ id: "j1", name: "Bar", color: "#0d9488", mode: "flex" as const }],
    } as unknown as Work;
    expect(workFingerprint(a)).toBe(workFingerprint(b));
    expect(workFingerprint(a)).not.toBe(workFingerprint(c));
  });
});
