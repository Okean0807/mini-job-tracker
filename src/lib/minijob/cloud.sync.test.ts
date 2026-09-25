/**
 * Integrationsnahe Regressionstests für die Cloud-Sync-Orchestrierung.
 *
 * `cloud.test.ts` prüft nur die reine Entscheidungslogik (`decideSync`).
 * Hier werden die zustandsbehafteten Pfade abgedeckt, die im Browser-E2E ohne
 * zwei echte Konten nicht reproduzierbar sind: Konflikt-Erkennung beim
 * automatischen Abgleich, Offline-Queue mit Retry nach `online`, Abbruch des
 * geplanten Push bei Abmeldung sowie die Konfliktauflösung durch den Nutzer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppData } from "./types";

/* ---------- Mocks ---------- */

type Remote = { payload: unknown; updated_at: string } | null;

const cloud = {
  remote: null as Remote,
  upsertError: null as { message: string } | null,
  selectError: null as { message: string } | null,
  upserts: 0,
  /** Blockiert den Cloud-Lesezugriff, um Parallelität zu testen. */
  gate: null as Promise<void> | null,
};

let authCallback: ((event: string, session: unknown) => void) | null = null;
let session: { user: { id: string } } | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: async (row: { payload: unknown; updated_at: string }) => {
        cloud.upserts += 1;
        if (cloud.upsertError) return { error: cloud.upsertError };
        cloud.remote = { payload: row.payload, updated_at: row.updated_at };
        return { error: null };
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => (
            cloud.gate ? await cloud.gate : undefined,
            cloud.selectError
              ? { data: null, error: cloud.selectError }
              : { data: cloud.remote, error: null }
          ),
        }),
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  },
}));

let local: AppData;
let changeHook: ((data: AppData) => void) | null = null;
const replaced: AppData[] = [];

vi.mock("./store", async () => {
  const actual = await vi.importActual<typeof import("./store")>("./store");
  return {
    ...actual,
    getData: () => local,
    onDataChange: (cb: (data: AppData) => void) => {
      changeHook = cb;
    },
    replaceAll: (data: AppData) => {
      replaced.push(data);
      local = data;
      // Simulate store listeners observing restore writes (tests applyingRemote guard).
      changeHook?.(data);
    },
  };
});

vi.mock("./notify", () => ({ markBackup: vi.fn() }));

/* ---------- Hilfen ---------- */

function makeData(shifts: number, autoBackup = true, onboarded = true): AppData {
  return {
    shifts: Array.from({ length: shifts }, (_, i) => ({ id: `s${i}` })),
    jobs: [],
    customers: [],
    projects: [],
    payments: [],
    goals: [],
    orders: [],
    settings: { autoBackup, onboarded },
    timer: null,
  } as unknown as AppData;
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    value: online,
    configurable: true,
  });
}

async function loadModule() {
  vi.resetModules();
  return await import("./cloud");
}

/** Wartet, bis die Micro-/Makrotask-Kette des Sync abgearbeitet ist. */
async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  cloud.remote = null;
  cloud.upsertError = null;
  cloud.selectError = null;
  cloud.upserts = 0;
  cloud.gate = null;
  authCallback = null;
  changeHook = null;
  replaced.length = 0;
  session = { user: { id: "user-1" } };
  local = makeData(1);
  setOnline(true);
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("initCloudSync", () => {
  it("sichert lokale Daten, wenn in der Cloud noch nichts liegt", async () => {
    const { initCloudSync, getSyncState } = await loadModule();
    initCloudSync();
    await settle();

    expect(cloud.upserts).toBe(1);
    expect(getSyncState()).toMatchObject({ status: "synced", pending: false, signedIn: true });
  });

  it("stellt den Cloud-Stand auf einem leeren Gerät wieder her", async () => {
    local = makeData(0);
    cloud.remote = { payload: makeData(3), updated_at: new Date().toISOString() };

    const { initCloudSync } = await loadModule();
    initCloudSync();
    await settle();

    expect(replaced).toHaveLength(1);
    expect(cloud.upserts).toBe(0);
  });

  it("stellt trotz Einstellungs-Marke vor dem ersten Abgleich wieder her (kein Falsch-Konflikt)", async () => {
    // Einrichtungsassistent / Sprache / OAuth setzt localChangedAt, obwohl noch
    // keine Schichten existieren. Ohne lastSyncedAt darf das nicht als
    // unabhängige lokale Version gegen die Cloud gelten.
    local = makeData(0);
    cloud.remote = { payload: makeData(3), updated_at: new Date().toISOString() };
    window.localStorage.setItem(
      "minijob-sync-meta-v1:u:user-1",
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now(),
        lastSyncedAt: null,
        remoteSeenAt: null,
      }),
    );

    const { initCloudSync, getSyncState } = await loadModule();
    initCloudSync();
    await settle();

    expect(getSyncState().status).not.toBe("conflict");
    expect(replaced).toHaveLength(1);
    expect(cloud.upserts).toBe(0);
  });

  it("meldet keinen Konflikt, wenn der Assistent Einstellungen speichert und danach Sync läuft", async () => {
    session = null;
    local = makeData(0);
    cloud.remote = { payload: makeData(4), updated_at: new Date().toISOString() };

    const { initCloudSync, getSyncState } = await loadModule();
    initCloudSync();
    await settle();

    // Nutzer ändert nur Settings (wie Sprache im Wizard), noch nicht angemeldet.
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(100);

    session = { user: { id: "user-1" } };
    authCallback?.("SIGNED_IN", session);
    await settle();

    expect(getSyncState().status).not.toBe("conflict");
    expect(replaced).toHaveLength(1);
  });

  it("FIRST_SYNC: Jobs ohne Schichten + Cloud → conflict (jobs-only survival bis resolve)", async () => {
    // onboarded + no wizard flag → leftover jobs still compete (#78)
    local = {
      ...makeData(0, true, true),
      jobs: [{ id: "j1", name: "Demo", color: "#0d9488", mode: "flex" }],
    } as unknown as AppData;
    cloud.remote = { payload: makeData(5), updated_at: new Date().toISOString() };
    window.localStorage.setItem(
      "minijob-sync-meta-v1:u:user-1",
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now(),
        lastSyncedAt: null,
        remoteSeenAt: null,
      }),
    );

    const { initCloudSync, getSyncState } = await loadModule();
    initCloudSync();
    await settle();

    expect(getSyncState().status).toBe("conflict");
    expect(replaced).toHaveLength(0);
    expect(cloud.upserts).toBe(0);
    // Local jobs survive until the user resolves keep local vs cloud.
    expect(local.jobs).toHaveLength(1);
  });

  it("Onboarding unvollständig + Wizard-Job + Cloud → restore (kein Falsch-Konflikt)", async () => {
    local = {
      ...makeData(0, true, false),
      jobs: [{ id: "j1", name: "Wizard", color: "#0d9488", mode: "flex" }],
    } as unknown as AppData;
    cloud.remote = { payload: makeData(5), updated_at: new Date().toISOString() };
    window.localStorage.setItem(
      "minijob-sync-meta-v1:u:user-1",
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now(),
        lastSyncedAt: null,
        remoteSeenAt: null,
      }),
    );

    const { initCloudSync, getSyncState } = await loadModule();
    initCloudSync();
    await settle();

    expect(getSyncState().status).not.toBe("conflict");
    expect(replaced).toHaveLength(1);
    expect(cloud.upserts).toBe(0);
  });

  it("Race finish-before-sync: wizardPendingFirstSync + Job + Cloud → restore", async () => {
    local = {
      ...makeData(0, true, true),
      jobs: [{ id: "j1", name: "Wizard", color: "#0d9488", mode: "flex" }],
    } as unknown as AppData;
    cloud.remote = { payload: makeData(5), updated_at: new Date().toISOString() };
    window.localStorage.setItem(
      "minijob-sync-meta-v1:u:user-1",
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now(),
        lastSyncedAt: null,
        remoteSeenAt: null,
        wizardPendingFirstSync: true,
      }),
    );

    const { initCloudSync, getSyncState } = await loadModule();
    initCloudSync();
    await settle();

    expect(getSyncState().status).not.toBe("conflict");
    expect(replaced).toHaveLength(1);
    // Flag cleared after successful restore
    const meta = JSON.parse(window.localStorage.getItem("minijob-sync-meta-v1:u:user-1")!);
    expect(meta.wizardPendingFirstSync).toBe(false);
  });

  it("Leftover jobs nach Onboarding ohne Flag + Cloud → conflict (jobs-only survival)", async () => {
    local = {
      ...makeData(0, true, true),
      jobs: [{ id: "j1", name: "Alt", color: "#0d9488", mode: "flex" }],
    } as unknown as AppData;
    cloud.remote = { payload: makeData(5), updated_at: new Date().toISOString() };
    window.localStorage.setItem(
      "minijob-sync-meta-v1:u:user-1",
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now(),
        lastSyncedAt: null,
        remoteSeenAt: null,
        wizardPendingFirstSync: false,
      }),
    );

    const { initCloudSync, getSyncState } = await loadModule();
    initCloudSync();
    await settle();

    expect(getSyncState().status).toBe("conflict");
    expect(replaced).toHaveLength(0);
  });

  it("nie synced + lokale Schichten + Cloud → Konflikt (datensicher)", async () => {
    local = makeData(2);
    cloud.remote = { payload: makeData(9), updated_at: new Date().toISOString() };
    window.localStorage.setItem(
      "minijob-sync-meta-v1:u:user-1",
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now(),
        lastSyncedAt: null,
        remoteSeenAt: null,
      }),
    );

    const { initCloudSync, getSyncState } = await loadModule();
    initCloudSync();
    await settle();

    expect(getSyncState().status).toBe("conflict");
    expect(replaced).toHaveLength(0);
    expect(cloud.upserts).toBe(0);
  });

  it("null baseline + identical local/remote work → synced (re-establish, no conflict UI)", async () => {
    // Production stuck clients: lastSyncedAt wiped but work identical to cloud.
    // Must re-establish baseline without Keep/conflict dialog or replaceAll.
    const work = makeData(3);
    const remoteAt = Date.now() - 60_000;
    local = work;
    cloud.remote = {
      payload: makeData(3),
      updated_at: new Date(remoteAt).toISOString(),
    };
    window.localStorage.setItem(
      "minijob-sync-meta-v1:u:user-1",
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now(),
        localWorkChangedAt: Date.now(),
        lastSyncedAt: null,
        remoteSeenAt: null,
      }),
    );

    const { initCloudSync, getSyncState } = await loadModule();
    initCloudSync();
    await settle();

    expect(getSyncState().status).toBe("synced");
    expect(getSyncState().status).not.toBe("conflict");
    expect(replaced).toHaveLength(0);
    expect(cloud.upserts).toBe(0);
    const meta = JSON.parse(window.localStorage.getItem("minijob-sync-meta-v1:u:user-1")!);
    expect(meta.lastSyncedAt).toBe(remoteAt);
    expect(meta.remoteSeenAt).toBe(remoteAt);
    expect(meta.localChangedAt).toBeNull();
    expect(meta.localWorkChangedAt).toBeNull();
    expect(typeof meta.localWorkFingerprint).toBe("string");
  });

  it("null baseline + different shifts → still conflict", async () => {
    local = makeData(2);
    cloud.remote = { payload: makeData(9), updated_at: new Date().toISOString() };
    window.localStorage.setItem(
      "minijob-sync-meta-v1:u:user-1",
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now(),
        localWorkChangedAt: Date.now(),
        lastSyncedAt: null,
        remoteSeenAt: null,
      }),
    );

    const { initCloudSync, getSyncState } = await loadModule();
    initCloudSync();
    await settle();

    expect(getSyncState().status).toBe("conflict");
    expect(replaced).toHaveLength(0);
    expect(cloud.upserts).toBe(0);
    const meta = JSON.parse(window.localStorage.getItem("minijob-sync-meta-v1:u:user-1")!);
    expect(meta.lastSyncedAt).toBeNull();
  });

  it("löscht beim Wiederherstellen keinen laufenden Timer", async () => {
    // Der Timer wird nie in die Cloud geschrieben; ein Restore darf die
    // laufende, noch nicht gespeicherte Zeit nicht verwerfen.
    const running = { startedAt: Date.now(), breakMinutes: 0 };
    local = { ...makeData(0), timer: running } as unknown as AppData;
    cloud.remote = { payload: makeData(3), updated_at: new Date().toISOString() };

    const { initCloudSync } = await loadModule();
    initCloudSync();
    await settle();

    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.timer).toEqual(running);
    expect(replaced[0]?.shifts).toHaveLength(3);
  });
});

describe("automatischer Abgleich", () => {
  it("meldet einen Konflikt statt fremde Cloud-Änderungen zu überschreiben", async () => {
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    // Uhr weiterlaufen lassen: sonst fallen Erst-Push und lokale Änderung
    // auf dieselbe Millisekunde und gelten als "nicht geändert".
    await vi.advanceTimersByTimeAsync(1000);
    expect(mod.getSyncState().status).toBe("synced");

    // Anderes Gerät schreibt einen neueren Stand in die Cloud.
    cloud.remote = {
      payload: makeData(9),
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const before = cloud.upserts;

    // Lokale Änderung → geplanter Abgleich.
    local = makeData(2);
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(3000);
    await settle();

    expect(mod.getSyncState()).toMatchObject({ status: "conflict", pending: true });
    expect(cloud.upserts).toBe(before); // kein blindes Überschreiben
    expect(replaced).toHaveLength(0); // und kein stiller Restore
  });

  it("Settings-only lokal + Cloud neuer → restore (kein Falsch-Konflikt)", async () => {
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mod.getSyncState().status).toBe("synced");

    cloud.remote = {
      payload: makeData(9),
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    };

    // Same shifts fingerprint; only settings stamp via changeHook
    local = {
      ...makeData(1),
      settings: { autoBackup: true, onboarded: true, language: "en" },
    } as unknown as AppData;
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(3000);
    await settle();

    expect(mod.getSyncState().status).not.toBe("conflict");
    expect(replaced.length).toBeGreaterThanOrEqual(1);
    expect(replaced[replaced.length - 1]?.shifts).toHaveLength(9);
  });

  it("Settings-only lokal + Cloud unverändert → push", async () => {
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mod.getSyncState().status).toBe("synced");
    const before = cloud.upserts;

    local = {
      ...makeData(1),
      settings: { autoBackup: true, onboarded: true, language: "de" },
    } as unknown as AppData;
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(3000);
    await settle();

    expect(mod.getSyncState().status).toBe("synced");
    expect(cloud.upserts).toBe(before + 1);
    expect(replaced).toHaveLength(0);
  });

  it("löst den Konflikt zugunsten der lokalen Daten auf", async () => {
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    // Uhr weiterlaufen lassen: sonst fallen Erst-Push und lokale Änderung
    // auf dieselbe Millisekunde und gelten als "nicht geändert".
    await vi.advanceTimersByTimeAsync(1000);
    cloud.remote = {
      payload: makeData(9),
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    };
    local = makeData(2);
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(3000);
    await settle();
    expect(mod.getSyncState().status).toBe("conflict");

    await mod.resolveConflict("local");

    expect(mod.getSyncState()).toMatchObject({ status: "synced", pending: false });
    expect((cloud.remote?.payload as AppData).shifts).toHaveLength(2);
  });

  it("löst den Konflikt zugunsten der Cloud auf", async () => {
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    // Uhr weiterlaufen lassen: sonst fallen Erst-Push und lokale Änderung
    // auf dieselbe Millisekunde und gelten als "nicht geändert".
    await vi.advanceTimersByTimeAsync(1000);
    cloud.remote = {
      payload: makeData(9),
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    };
    local = makeData(2);
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(3000);
    await settle();

    await mod.resolveConflict("cloud");

    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.shifts).toHaveLength(9);
    expect(mod.getSyncState()).toMatchObject({ status: "synced", pending: false });
  });

  it("startet nach gemeldetem Konflikt keinen automatischen Push mehr", async () => {
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    // Uhr weiterlaufen lassen: sonst fallen Erst-Push und lokale Änderung
    // auf dieselbe Millisekunde und gelten als "nicht geändert".
    await vi.advanceTimersByTimeAsync(1000);
    cloud.remote = {
      payload: makeData(9),
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    };
    changeHook?.(makeData(2));
    await vi.advanceTimersByTimeAsync(3000);
    await settle();
    const before = cloud.upserts;

    changeHook?.(makeData(3));
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();

    expect(cloud.upserts).toBe(before);
    expect(mod.getSyncState().status).toBe("conflict");
    // retryPending darf einen Konflikt ebenfalls nicht umgehen
    mod.retryPending();
    await settle();
    expect(cloud.upserts).toBe(before);
  });
});

describe("Offline-Queue", () => {
  it("hält Änderungen offline zurück und sendet sie nach online", async () => {
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    // Uhr weiterlaufen lassen: sonst fallen Erst-Push und lokale Änderung
    // auf dieselbe Millisekunde und gelten als "nicht geändert".
    await vi.advanceTimersByTimeAsync(1000);
    const afterInit = cloud.upserts;

    setOnline(false);
    local = makeData(4);
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(3000);
    await settle();

    expect(mod.getSyncState()).toMatchObject({ status: "offline", pending: true });
    expect(cloud.upserts).toBe(afterInit);

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await settle();

    expect(cloud.upserts).toBe(afterInit + 1);
    expect(mod.getSyncState()).toMatchObject({ status: "synced", pending: false });
    expect((cloud.remote?.payload as AppData).shifts).toHaveLength(4);
  });

  it("macht einen Netzwerkfehler sichtbar und sendet ihn beim Retry erneut", async () => {
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    // Uhr weiterlaufen lassen: sonst fallen Erst-Push und lokale Änderung
    // auf dieselbe Millisekunde und gelten als "nicht geändert".
    await vi.advanceTimersByTimeAsync(1000);

    cloud.upsertError = { message: "boom" };
    local = makeData(5);
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(3000);
    await settle();

    expect(mod.getSyncState()).toMatchObject({ status: "error", pending: true });
    expect(mod.getSyncState().message).toBeTruthy();

    cloud.upsertError = null;
    mod.retryPending();
    await settle();

    expect(mod.getSyncState()).toMatchObject({ status: "synced", pending: false });
    expect((cloud.remote?.payload as AppData).shifts).toHaveLength(5);
  });
});

describe("Abmeldung", () => {
  it("bricht den geplanten Push ab und schreibt nicht ohne Konto", async () => {
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    // Uhr weiterlaufen lassen: sonst fallen Erst-Push und lokale Änderung
    // auf dieselbe Millisekunde und gelten als "nicht geändert".
    await vi.advanceTimersByTimeAsync(1000);
    const afterInit = cloud.upserts;

    local = makeData(7);
    changeHook?.(local);
    authCallback?.("SIGNED_OUT", null);
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();

    expect(cloud.upserts).toBe(afterInit);
    expect(mod.getSyncState()).toMatchObject({
      status: "idle",
      pending: false,
      signedIn: false,
    });
  });

  it("verwirft nach Kontowechsel den fremden Abgleichstand und meldet den Konflikt", async () => {
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    // Uhr weiterlaufen lassen: sonst fallen Erst-Push und lokale Änderung
    // auf dieselbe Millisekunde und gelten als "nicht geändert".
    await vi.advanceTimersByTimeAsync(1000);

    // Konto B hat einen eigenen, älteren Cloud-Stand; das Gerät hat eigene Daten.
    authCallback?.("SIGNED_OUT", null);
    cloud.remote = { payload: makeData(9), updated_at: new Date().toISOString() };
    local = makeData(2);
    authCallback?.("SIGNED_IN", { user: { id: "user-2" } });
    await settle();

    expect(mod.getSyncState().status).toBe("conflict");
    expect(replaced).toHaveLength(0);
  });
});

describe("beschädigter Cloud-Stand", () => {
  it("überschreibt lokale Daten nicht mit einem kaputten Payload", async () => {
    local = makeData(0);
    cloud.remote = { payload: "kaputt" as unknown, updated_at: new Date().toISOString() };

    const mod = await loadModule();
    mod.initCloudSync();
    await settle();

    expect(replaced).toHaveLength(0);
    expect(cloud.upserts).toBe(0);
    expect(mod.getSyncState().status).toBe("error");
  });

  it("erkennt gültige und ungültige Strukturen", async () => {
    const { isValidPayload } = await loadModule();
    expect(isValidPayload(makeData(1))).toBe(true);
    expect(isValidPayload({ shifts: [], jobs: [] })).toBe(true);
    expect(isValidPayload(null)).toBe(false);
    expect(isValidPayload([])).toBe(false);
    expect(isValidPayload("{}")).toBe(false);
    expect(isValidPayload({})).toBe(false);
    expect(isValidPayload({ goals: [] })).toBe(false);
    expect(isValidPayload({ shifts: [] })).toBe(false);
    expect(isValidPayload({ shifts: [], jobs: "nein" })).toBe(false);
    expect(isValidPayload({ shifts: [], jobs: [], settings: [] })).toBe(false);
  });
});

describe("paralleler Abgleich", () => {
  it("behält Änderungen, die während eines laufenden Abgleichs entstehen", async () => {
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);

    // Cloud-Lesezugriff anhalten, damit der Abgleich "läuft".
    let release: () => void = () => {};
    cloud.gate = new Promise<void>((r) => {
      release = r;
    });

    local = makeData(2);
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(2500);
    expect(mod.getSyncState().status).toBe("syncing");

    // Weitere Änderung während des laufenden Abgleichs.
    await vi.advanceTimersByTimeAsync(10);
    local = makeData(3);
    changeHook?.(local);

    cloud.gate = null;
    release();
    await vi.advanceTimersByTimeAsync(10);
    await settle();

    // Die spätere Änderung darf nicht als gesichert gelten.
    expect(mod.getSyncState().pending).toBe(true);
  });
});

describe("Sync-Timeout (SYNC-LIVE-P1)", () => {
  it("exportiert SYNC_TIMEOUT_MS = 15s für UX", async () => {
    const mod = await loadModule();
    expect(mod.SYNC_TIMEOUT_MS).toBe(15_000);
  });

  it("hängt der Cloud-Fetch → status error/offline, nicht syncing", async () => {
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mod.getSyncState().status).toBe("synced");

    // Hang forever on next fetch
    cloud.gate = new Promise<void>(() => {});

    local = makeData(2);
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(2500);
    await settle();
    expect(mod.getSyncState().status).toBe("syncing");

    // Advance past SYNC_TIMEOUT_MS (15s) — must leave syncing
    await vi.advanceTimersByTimeAsync(mod.SYNC_TIMEOUT_MS + 100);
    await settle();

    expect(mod.getSyncState().status).not.toBe("syncing");
    expect(["error", "offline"]).toContain(mod.getSyncState().status);
    if (mod.getSyncState().status === "error") {
      expect(mod.getSyncState().message).toMatch(/zu lange gedauert|too long|try again/i);
    }
  });

  it("forceFailStuckSync verlässt syncing (UI-Failsafe)", async () => {
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mod.getSyncState().status).toBe("synced");

    cloud.gate = new Promise<void>(() => {});
    local = makeData(2);
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(2500);
    await settle();
    expect(mod.getSyncState().status).toBe("syncing");

    mod.forceFailStuckSync();
    expect(mod.getSyncState().status).not.toBe("syncing");
    expect(["error", "offline"]).toContain(mod.getSyncState().status);
    // Idempotent when already left syncing
    const after = mod.getSyncState();
    mod.forceFailStuckSync();
    expect(mod.getSyncState()).toEqual(after);
  });

  it("hard watchdog beendet syncing auch wenn nur Epoch-Timer weiterläuft", async () => {
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);

    cloud.gate = new Promise<void>(() => {});
    local = makeData(2);
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(2500);
    await settle();
    expect(mod.getSyncState().status).toBe("syncing");

    // Watchdog + Promise.race share SYNC_TIMEOUT_MS; either must leave syncing.
    await vi.advanceTimersByTimeAsync(mod.SYNC_TIMEOUT_MS + 50);
    await settle();
    expect(mod.getSyncState().status).not.toBe("syncing");
  });

  it("nach forceFail darf late fetch weder restore noch synced setzen", async () => {
    local = makeData(0);
    cloud.remote = { payload: makeData(5), updated_at: new Date().toISOString() };

    let release!: () => void;
    cloud.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(mod.getSyncState().status).toBe("syncing");
    expect(replaced).toHaveLength(0);

    mod.forceFailStuckSync();
    expect(["error", "offline"]).toContain(mod.getSyncState().status);
    const statusAfterFail = mod.getSyncState().status;
    const replacedAfterFail = replaced.length;
    const upsertsAfterFail = cloud.upserts;

    // Late hung fetch resolves with restore-worthy remote — must stay abandoned.
    release();
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    await settle();

    expect(replaced).toHaveLength(replacedAfterFail);
    expect(cloud.upserts).toBe(upsertsAfterFail);
    expect(mod.getSyncState().status).toBe(statusAfterFail);
    expect(mod.getSyncState().status).not.toBe("synced");
    expect(mod.getSyncState().status).not.toBe("syncing");
  });

  it("nach Watchdog-Timeout darf late fetch weder restore noch synced setzen", async () => {
    local = makeData(0);
    cloud.remote = { payload: makeData(5), updated_at: new Date().toISOString() };

    let release!: () => void;
    cloud.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(mod.getSyncState().status).toBe("syncing");
    expect(replaced).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(mod.SYNC_TIMEOUT_MS + 50);
    await settle();
    expect(mod.getSyncState().status).not.toBe("syncing");
    expect(["error", "offline"]).toContain(mod.getSyncState().status);
    const statusAfterTimeout = mod.getSyncState().status;
    const replacedAfterTimeout = replaced.length;
    const upsertsAfterTimeout = cloud.upserts;

    release();
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    await settle();

    expect(replaced).toHaveLength(replacedAfterTimeout);
    expect(cloud.upserts).toBe(upsertsAfterTimeout);
    expect(mod.getSyncState().status).toBe(statusAfterTimeout);
    expect(mod.getSyncState().status).not.toBe("synced");
  });

  it("nach forceFail darf late push weder upserten noch synced setzen", async () => {
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mod.getSyncState().status).toBe("synced");

    let release!: () => void;
    cloud.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    local = makeData(2);
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(2500);
    await settle();
    expect(mod.getSyncState().status).toBe("syncing");

    mod.forceFailStuckSync();
    expect(["error", "offline"]).toContain(mod.getSyncState().status);
    const upsertsAfterFail = cloud.upserts;
    const statusAfterFail = mod.getSyncState().status;

    // Remote present so decide could push; late ungated work must not mutate.
    cloud.remote = {
      payload: makeData(1),
      updated_at: new Date(Date.now() - 60_000).toISOString(),
    };
    release();
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    await settle();

    expect(cloud.upserts).toBe(upsertsAfterFail);
    expect(mod.getSyncState().status).toBe(statusAfterFail);
    expect(mod.getSyncState().status).not.toBe("synced");
  });

  it("applyRemote löst keinen Backup-Loop über onDataChange aus", async () => {
    local = makeData(0);
    cloud.remote = { payload: makeData(3), updated_at: new Date().toISOString() };

    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);

    expect(replaced.length).toBeGreaterThanOrEqual(1);
    const upsertsAfterRestore = cloud.upserts;

    // Debounce window after restore must not schedule another sync from applyRemote.
    await vi.advanceTimersByTimeAsync(3000);
    await settle();

    expect(cloud.upserts).toBe(upsertsAfterRestore);
    expect(mod.getSyncState().status).not.toBe("syncing");
    expect(mod.getSyncState().pending).toBe(false);
  });
});

describe("normalize-safe work fingerprint (false conflict)", () => {
  function richShift(partial: Record<string, unknown> = {}) {
    return {
      id: "s1",
      date: "2026-09-01",
      start: "09:00",
      end: "12:00",
      jobId: "j1",
      ...partial,
    };
  }

  function richJob(partial: Record<string, unknown> = {}) {
    return {
      id: "j1",
      name: "Café",
      color: "#0d9488",
      mode: "flex",
      ...partial,
    };
  }

  function basePayload(shifts: unknown[], jobs: unknown[]): AppData {
    return {
      ...makeData(0),
      shifts,
      jobs,
    } as unknown as AppData;
  }

  it("raw remote missing kind/breakMinutes vs normalized local → synced (no conflict)", async () => {
    const remoteAt = Date.now() - 60_000;
    local = basePayload([richShift({ kind: "arbeit", breakMinutes: 0 })], [richJob()]);
    cloud.remote = {
      payload: basePayload([richShift()], [richJob()]),
      updated_at: new Date(remoteAt).toISOString(),
    };
    window.localStorage.setItem(
      "minijob-sync-meta-v1:u:user-1",
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now(),
        localWorkChangedAt: Date.now(),
        lastSyncedAt: null,
        remoteSeenAt: null,
      }),
    );

    const { initCloudSync, getSyncState } = await loadModule();
    initCloudSync();
    await settle();

    expect(getSyncState().status).toBe("synced");
    expect(replaced).toHaveLength(0);
    expect(cloud.upserts).toBe(0);
  });

  it("job rate:0 on remote stripped locally → no conflict", async () => {
    const remoteAt = Date.now() - 60_000;
    local = basePayload([], [richJob()]); // rate stripped
    cloud.remote = {
      payload: basePayload([], [richJob({ rate: 0 })]),
      updated_at: new Date(remoteAt).toISOString(),
    };
    window.localStorage.setItem(
      "minijob-sync-meta-v1:u:user-1",
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now(),
        localWorkChangedAt: Date.now(),
        lastSyncedAt: null,
        remoteSeenAt: null,
      }),
    );

    const { initCloudSync, getSyncState } = await loadModule();
    initCloudSync();
    await settle();

    expect(getSyncState().status).toBe("synced");
    expect(replaced).toHaveLength(0);
    expect(cloud.upserts).toBe(0);
  });

  it("different key order same data → no conflict", async () => {
    const remoteAt = Date.now() - 60_000;
    local = basePayload([richShift({ kind: "arbeit", breakMinutes: 0 })], [richJob({ rate: 12 })]);
    cloud.remote = {
      payload: {
        ...makeData(0),
        shifts: [
          {
            breakMinutes: 0,
            kind: "arbeit",
            end: "12:00",
            start: "09:00",
            date: "2026-09-01",
            jobId: "j1",
            id: "s1",
          },
        ],
        jobs: [{ mode: "flex", color: "#0d9488", name: "Café", id: "j1", rate: 12 }],
      } as unknown as AppData,
      updated_at: new Date(remoteAt).toISOString(),
    };
    window.localStorage.setItem(
      "minijob-sync-meta-v1:u:user-1",
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now(),
        localWorkChangedAt: Date.now(),
        lastSyncedAt: null,
        remoteSeenAt: null,
      }),
    );

    const { initCloudSync, getSyncState } = await loadModule();
    initCloudSync();
    await settle();

    expect(getSyncState().status).toBe("synced");
    expect(replaced).toHaveLength(0);
  });

  it("lastSyncedAt set + remote newer + localWorkChangedAt + equal FP → no conflict", async () => {
    const syncedAt = Date.now() - 120_000;
    const remoteAt = Date.now() - 30_000;
    const workLocal = basePayload([richShift({ kind: "arbeit", breakMinutes: 0 })], [richJob()]);
    local = workLocal;
    cloud.remote = {
      // semantically same, raw missing defaults
      payload: basePayload([richShift()], [richJob()]),
      updated_at: new Date(remoteAt).toISOString(),
    };
    window.localStorage.setItem(
      "minijob-sync-meta-v1:u:user-1",
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now() - 10_000,
        localWorkChangedAt: Date.now() - 10_000,
        lastSyncedAt: syncedAt,
        remoteSeenAt: syncedAt,
        localWorkFingerprint: "stale-mark",
      }),
    );

    const { initCloudSync, getSyncState } = await loadModule();
    initCloudSync();
    await settle();

    expect(getSyncState().status).toBe("synced");
    expect(getSyncState().status).not.toBe("conflict");
    expect(replaced).toHaveLength(0);
    expect(cloud.upserts).toBe(0);
    const meta = JSON.parse(window.localStorage.getItem("minijob-sync-meta-v1:u:user-1")!);
    expect(meta.lastSyncedAt).toBe(remoteAt);
    expect(meta.localChangedAt).toBeNull();
    expect(meta.localWorkChangedAt).toBeNull();
  });

  it("different shift hours → still conflict", async () => {
    local = basePayload(
      [richShift({ kind: "arbeit", breakMinutes: 0, end: "12:00" })],
      [richJob()],
    );
    cloud.remote = {
      payload: basePayload([richShift({ end: "17:00" })], [richJob()]),
      updated_at: new Date().toISOString(),
    };
    window.localStorage.setItem(
      "minijob-sync-meta-v1:u:user-1",
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now(),
        localWorkChangedAt: Date.now(),
        lastSyncedAt: null,
        remoteSeenAt: null,
      }),
    );

    const { initCloudSync, getSyncState } = await loadModule();
    initCloudSync();
    await settle();

    expect(getSyncState().status).toBe("conflict");
    expect(replaced).toHaveLength(0);
    expect(cloud.upserts).toBe(0);
  });

  it("jobs-only identical → no conflict; jobs-only different → conflict", async () => {
    const remoteAt = Date.now() - 60_000;
    // identical jobs-only
    local = basePayload([], [richJob()]);
    cloud.remote = {
      payload: basePayload([], [richJob({ rate: 0 })]),
      updated_at: new Date(remoteAt).toISOString(),
    };
    window.localStorage.setItem(
      "minijob-sync-meta-v1:u:user-1",
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now(),
        localWorkChangedAt: Date.now(),
        lastSyncedAt: null,
        remoteSeenAt: null,
      }),
    );

    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(mod.getSyncState().status).toBe("synced");
    expect(replaced).toHaveLength(0);

    // different jobs-only
    window.localStorage.clear();
    replaced.length = 0;
    cloud.upserts = 0;
    local = basePayload([], [richJob({ name: "Café" })]);
    cloud.remote = {
      payload: basePayload([], [richJob({ name: "Bar" })]),
      updated_at: new Date().toISOString(),
    };
    window.localStorage.setItem(
      "minijob-sync-meta-v1:u:user-1",
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now(),
        localWorkChangedAt: Date.now(),
        lastSyncedAt: null,
        remoteSeenAt: null,
      }),
    );

    const mod2 = await loadModule();
    mod2.initCloudSync();
    await settle();
    expect(mod2.getSyncState().status).toBe("conflict");
    expect(replaced).toHaveLength(0);
    expect(cloud.upserts).toBe(0);
  });
});

describe("device-local auth secrets", () => {
  it("strips PIN and WebAuthn id from cloud upsert payload", async () => {
    local = makeData(1);
    (
      local.settings as {
        pinEnabled?: boolean;
        pin?: string;
        biometric?: boolean;
        biometricCredentialId?: string;
      }
    ).pinEnabled = true;
    (local.settings as { pin?: string }).pin = "4242";
    (local.settings as { biometric?: boolean }).biometric = true;
    (local.settings as { biometricCredentialId?: string }).biometricCredentialId = "cred-local";

    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    await mod.backupNow();

    const uploaded = cloud.remote?.payload as {
      settings?: {
        pin?: string;
        pinEnabled?: boolean;
        biometric?: boolean;
        biometricCredentialId?: string;
      };
      timer?: unknown;
    };
    expect(uploaded?.timer ?? null).toBeNull();
    expect(uploaded?.settings?.pin).toBeUndefined();
    expect(uploaded?.settings?.biometricCredentialId).toBeUndefined();
    expect(uploaded?.settings?.pinEnabled).toBe(false);
    expect(uploaded?.settings?.biometric).toBe(false);
    // Local store unchanged
    expect((local.settings as { pin?: string }).pin).toBe("4242");
  });

  it("preserves local PIN across restore and ignores remote credential", async () => {
    local = makeData(1);
    (local.settings as { pinEnabled?: boolean; pin?: string }).pinEnabled = true;
    (local.settings as { pin?: string }).pin = "4242";
    (local.settings as { biometric?: boolean; biometricCredentialId?: string }).biometric = true;
    (local.settings as { biometricCredentialId?: string }).biometricCredentialId = "cred-local";

    cloud.remote = {
      payload: {
        ...makeData(5),
        settings: {
          autoBackup: true,
          pinEnabled: true,
          pin: "9999",
          biometric: true,
          biometricCredentialId: "cred-remote",
        },
      },
      updated_at: new Date().toISOString(),
    };

    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    const ok = await mod.restoreNow();
    expect(ok).toBe(true);
    expect(replaced.length).toBeGreaterThan(0);
    const applied = replaced[replaced.length - 1]!;
    expect((applied.settings as { pin?: string }).pin).toBe("4242");
    expect((applied.settings as { biometricCredentialId?: string }).biometricCredentialId).toBe(
      "cred-local",
    );
  });
});

describe("orders sync (v1.1)", () => {
  it("Backup-Payload enthält orders", async () => {
    local = {
      ...makeData(1),
      orders: [
        {
          id: "o1",
          title: "Garten",
          customerName: "Müller",
          service: "Rasen",
          location: "Hof",
          dateFrom: "2026-09-01",
          amount: 100,
          status: "open",
        },
      ],
    } as unknown as AppData;

    const { initCloudSync } = await loadModule();
    initCloudSync();
    await settle();

    expect(cloud.upserts).toBe(1);
    const payload = cloud.remote?.payload as AppData;
    expect(payload.orders).toBeDefined();
    expect(payload.orders).toHaveLength(1);
    expect(payload.orders![0]!.id).toBe("o1");
  });

  it("order with start/end round-trips in backup payload (not in workFingerprint)", async () => {
    local = {
      ...makeData(1),
      orders: [
        {
          id: "o-times",
          title: "Mit Zeiten",
          customerName: "Müller",
          service: "Rasen",
          location: "Hof",
          dateFrom: "2026-09-01",
          amount: 90,
          status: "open",
          start: "09:00",
          end: "12:00",
          hoursWorked: 3,
        },
      ],
    } as unknown as AppData;

    const { initCloudSync, workFingerprint } = await loadModule();
    const fpBefore = workFingerprint(local);
    initCloudSync();
    await settle();

    expect(cloud.upserts).toBe(1);
    const payload = cloud.remote?.payload as AppData;
    expect(payload.orders).toHaveLength(1);
    const o = payload.orders![0]!;
    expect(o.id).toBe("o-times");
    expect(o.start).toBe("09:00");
    expect(o.end).toBe("12:00");
    expect(o.hoursWorked).toBe(3);
    // orders remain outside workFingerprint
    expect(workFingerprint(local)).toBe(fpBefore);
    expect(workFingerprint(payload)).toBe(fpBefore);
  });

  it("order-only change bump localChangedAt but not workFingerprint/localWorkChangedAt", async () => {
    const { initCloudSync, workFingerprint } = await loadModule();
    initCloudSync();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);

    const metaBefore = JSON.parse(window.localStorage.getItem("minijob-sync-meta-v1:u:user-1")!);
    const fpBefore = workFingerprint(local);
    const workAtBefore = metaBefore.localWorkChangedAt ?? null;

    local = {
      ...local,
      orders: [
        {
          id: "o-new",
          title: "Auftrag",
          customerName: "X",
          service: "Y",
          location: "Z",
          dateFrom: "2026-09-10",
          amount: 50,
          status: "open",
        },
      ],
    } as unknown as AppData;
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(100); // scheduleBackup stamps meta immediately

    const metaAfter = JSON.parse(window.localStorage.getItem("minijob-sync-meta-v1:u:user-1")!);
    expect(metaAfter.localChangedAt).toBeGreaterThan(metaBefore.localChangedAt ?? 0);
    expect(metaAfter.localWorkChangedAt ?? null).toBe(workAtBefore);
    expect(workFingerprint(local)).toBe(fpBefore);
    expect(workFingerprint(local)).not.toContain("o-new");
  });
});
