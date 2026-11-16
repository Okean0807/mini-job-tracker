/**
 * Data-safety Phase 2 – Sync-Semantik und Änderungsverfolgung (`cloud.ts`).
 *
 * Deckt ab: exaktes Server-Token statt Zeitstempel-Heuristik, Altbestand-Metadaten, alle acht
 * Sammlungen in Konflikt- und Restore-Entscheidungen, `dirty` unabhängig von Auto-Backup,
 * Auto-Backup AUS (kein POST/PATCH/Upsert auf IRGENDEINEM automatischen Pfad), die streng
 * geprüfte Leer-Gerät-Wiederherstellung und Konto-/Scope-Abbruch.
 *
 * Es gibt noch KEINE bedingten Cloud-Schreibzugriffe (CAS): `push` bleibt ein Upsert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COLLECTION_NAMES, fullFingerprint } from "./backup-compare";
import type { AppData } from "./types";

type Remote = { payload: unknown; updated_at: string } | null;

const cloud = {
  remote: null as Remote,
  /** JEDER Schreibzugriff (upsert/insert/update/delete) – leer = kein POST/PATCH. */
  writes: [] as string[],
  selects: 0,
  upsertError: null as { message: string } | null,
  fetchGate: null as Promise<void> | null,
  upsertGate: null as Promise<void> | null,
};

let authCallback: ((event: string, session: unknown) => void) | null = null;
let session: { user: { id: string } } | null = null;

vi.mock("@/integrations/supabase/client", () => {
  const forbidden = (name: string) => () => {
    cloud.writes.push(name);
    throw new Error(`unexpected ${name}`);
  };
  return {
    supabase: {
      from: () => ({
        upsert: async (row: { payload: unknown; updated_at: string }) => {
          cloud.writes.push("upsert");
          if (cloud.upsertGate) await cloud.upsertGate;
          if (cloud.upsertError) return { error: cloud.upsertError };
          cloud.remote = { payload: row.payload, updated_at: row.updated_at };
          return { error: null };
        },
        insert: forbidden("insert"),
        update: forbidden("update"),
        delete: forbidden("delete"),
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              cloud.selects += 1;
              if (cloud.fetchGate) await cloud.fetchGate;
              return { data: cloud.remote, error: null };
            },
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
  };
});

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
    },
  };
});

vi.mock("./notify", () => ({ markBackup: vi.fn() }));

const META_KEY = "minijob-sync-meta-v1:u:user-1";
const T0 = "2026-10-27T19:28:52.738+00:00";
const T1 = "2026-11-16T18:16:36.894+00:00";
const ms = (iso: string) => new Date(iso).getTime();

function data(over: Record<string, unknown> = {}, autoBackup = true): AppData {
  return {
    shifts: [],
    jobs: [],
    customers: [],
    projects: [],
    payments: [],
    goals: [],
    orders: [],
    objects: [],
    settings: { autoBackup, onboarded: true },
    timer: null,
    ...over,
  } as unknown as AppData;
}

const shifts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));
const rec = (name: string) => ({ id: `${name}-local`, name });

function setMeta(meta: Record<string, unknown>) {
  window.localStorage.setItem(META_KEY, JSON.stringify({ userId: "user-1", ...meta }));
}
const readMeta = () => JSON.parse(window.localStorage.getItem(META_KEY) ?? "{}");

async function loadModule() {
  vi.resetModules();
  return await import("./cloud");
}

async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value: online, configurable: true });
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

beforeEach(() => {
  cloud.remote = null;
  cloud.writes = [];
  cloud.selects = 0;
  cloud.upsertError = null;
  cloud.fetchGate = null;
  cloud.upsertGate = null;
  authCallback = null;
  changeHook = null;
  replaced.length = 0;
  session = { user: { id: "user-1" } };
  local = data({ shifts: shifts(1) });
  setOnline(true);
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setOnline(true);
});

/** Baseline: lokal und Cloud gleich, Token T0 bekannt, Abgleich bekannt. */
function syncedBaseline(extraMeta: Record<string, unknown> = {}, autoBackup = true) {
  local = data({ shifts: shifts(2) }, autoBackup);
  cloud.remote = { payload: data({ shifts: shifts(2) }), updated_at: T0 };
  setMeta({
    localChangedAt: null,
    localWorkChangedAt: null,
    lastSyncedAt: ms(T0) + 1000,
    remoteSeenAt: ms(T0),
    remoteToken: T0,
    ...extraMeta,
  });
}

/* =============================================================== Server-Token */

describe("remoteToken: exakte Gleichheit statt Zeitstempel-Heuristik", () => {
  it("Token gleich → Cloud unverändert: lokale Änderung wird hochgeladen (push)", async () => {
    syncedBaseline();
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(cloud.writes).toEqual([]); // sauber + unverändert → nichts zu tun

    local = { ...local, shifts: shifts(3) } as AppData;
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(2600);

    expect(cloud.writes).toEqual(["upsert"]);
    expect(replaced).toHaveLength(0);
  });

  it("ein ANDERES Token gilt als Änderung – auch wenn es zeitlich älter ist als lastSyncedAt", async () => {
    // CHARACTERIZATION of the old rule: `remoteUpdatedAt > lastSyncedAt` read this as "unchanged".
    syncedBaseline({ lastSyncedAt: ms(T1) + 60_000 }); // lokale Uhr "weit vorn"
    cloud.remote = {
      payload: data({ shifts: shifts(5) }),
      updated_at: "2026-10-27T19:28:52.739+00:00",
    };

    const mod = await loadModule();
    mod.initCloudSync();
    await settle();

    // NEW: Token weicht ab → Cloud geändert, lokal sauber → Wiederherstellung der neueren Cloud.
    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.shifts).toHaveLength(5);
    expect(cloud.writes).toEqual([]);
  });

  it("Token gleich, aber lastSyncedAt ist jünger/älter: lastSyncedAt ist kein Konkurrenz-Token", async () => {
    syncedBaseline({ lastSyncedAt: 1 }); // absurd alt
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(replaced).toHaveLength(0);
    expect(cloud.writes).toEqual([]);
    expect(mod.getSyncState().status).toBe("synced");
  });

  it("Token verschieden + lokale Änderung → Konflikt (nie stilles Überschreiben)", async () => {
    syncedBaseline();
    cloud.remote = { payload: data({ shifts: shifts(9) }), updated_at: T1 };
    local = { ...local, shifts: shifts(3) } as AppData;
    setMeta({
      localChangedAt: ms(T0) + 5000,
      localWorkChangedAt: ms(T0) + 5000,
      lastSyncedAt: ms(T0) + 1000,
      remoteSeenAt: ms(T0),
      remoteToken: T0,
    });
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(mod.getSyncState().status).toBe("conflict");
    expect(replaced).toHaveLength(0);
    expect(cloud.writes).toEqual([]);
  });

  it("remoteChangedSince: Token-Vergleich, Altbestand über remoteSeenAt, unbekannt = geändert", async () => {
    const { remoteChangedSince } = await loadModule();
    const remote = { token: T1, updatedAt: ms(T1) };
    expect(remoteChangedSince(remote, { remoteToken: T1, remoteSeenAt: null })).toBe(false);
    expect(remoteChangedSince(remote, { remoteToken: T0, remoteSeenAt: ms(T1) })).toBe(true); // Token gewinnt
    expect(remoteChangedSince(remote, { remoteToken: null, remoteSeenAt: ms(T1) })).toBe(false); // Altbestand
    expect(remoteChangedSince(remote, { remoteToken: null, remoteSeenAt: ms(T1) - 1 })).toBe(true);
    expect(remoteChangedSince(remote, {})).toBe(true);
    expect(remoteChangedSince(remote, { remoteToken: null, remoteSeenAt: null })).toBe(true);
    expect(remoteChangedSince(null, { remoteToken: T0, remoteSeenAt: null })).toBe(false);
  });
});

describe("Altbestand: numerisches remoteSeenAt ohne Token (konservativ)", () => {
  it("remoteSeenAt == Server-Millisekunden → unverändert: lokale Änderung wird gesichert", async () => {
    syncedBaseline({ remoteToken: undefined });
    local = { ...local, shifts: shifts(3) } as AppData;
    setMeta({
      localChangedAt: ms(T0) + 5000,
      localWorkChangedAt: ms(T0) + 5000,
      lastSyncedAt: ms(T0) + 1000,
      remoteSeenAt: ms(T0),
    });
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(cloud.writes).toEqual(["upsert"]);
  });

  it("remoteSeenAt weicht ab → Cloud gilt als geändert → Konflikt bei lokaler Arbeit, nie Upload", async () => {
    syncedBaseline({ remoteToken: undefined });
    cloud.remote = { payload: data({ shifts: shifts(7) }), updated_at: T1 };
    local = { ...local, shifts: shifts(3) } as AppData;
    setMeta({
      localChangedAt: ms(T0) + 5000,
      localWorkChangedAt: ms(T0) + 5000,
      lastSyncedAt: ms(T0) + 1000,
      remoteSeenAt: ms(T0),
    });
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(mod.getSyncState().status).toBe("conflict");
    expect(cloud.writes).toEqual([]);
  });

  it("nach einer Inspektion mit unveränderter Cloud ist das exakte Token gespeichert", async () => {
    syncedBaseline({ remoteToken: undefined });
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(readMeta().remoteToken).toBe(T0);
  });
});

describe("Restore speichert das echte Server-Token", () => {
  it("Erst-Wiederherstellung auf leerem Gerät: remoteToken === exakter updated_at-String", async () => {
    local = data();
    cloud.remote = { payload: data({ shifts: shifts(3) }), updated_at: T1 };
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(replaced).toHaveLength(1);
    const meta = readMeta();
    expect(meta.remoteToken).toBe(T1);
    expect(meta.remoteSeenAt).toBe(ms(T1));
    expect(meta.lastVerifiedAt).toBeGreaterThan(0);
  });

  it("manuelles Laden (restoreNow) speichert ebenfalls das Token", async () => {
    syncedBaseline();
    cloud.remote = { payload: data({ shifts: shifts(4) }), updated_at: T1 };
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    await mod.restoreNow();
    expect(readMeta().remoteToken).toBe(T1);
  });
});

/* ========================================================= Alle acht Sammlungen */

describe("alle acht Sammlungen nehmen an Konflikt- und Restore-Entscheidungen teil", () => {
  it.each(COLLECTION_NAMES)(
    "lokaler Datensatz nur in %s + geänderte Cloud → Konflikt, nichts wird überschrieben",
    async (name) => {
      syncedBaseline();
      const mod = await loadModule();
      mod.initCloudSync();
      await settle();
      expect(mod.getSyncState().status).toBe("synced");

      // Cloud wird von anderswo geändert (anderes Token, andere Schichten) …
      cloud.remote = { payload: data({ shifts: shifts(6) }), updated_at: T1 };
      // … während lokal NUR ein Datensatz der Sammlung `name` entsteht.
      local = {
        ...local,
        [name]: [...(local[name as keyof AppData] as unknown[]), rec(name)],
      } as AppData;
      changeHook?.(local);
      await vi.advanceTimersByTimeAsync(2600);

      expect(mod.getSyncState().status).toBe("conflict");
      expect(replaced).toHaveLength(0);
      expect(cloud.writes).toEqual([]);
      expect((local[name as keyof AppData] as unknown[]).length).toBeGreaterThan(0);
    },
  );

  it("Zahlung nur lokal, gleiche Schichten, Cloud neuer → Konflikt (vorher: stilles Restore)", async () => {
    const payment = { id: "pay-lokal", jobId: "j", year: 2026, month: 9, actual: 5 };
    local = data({ shifts: shifts(1), payments: [payment] });
    cloud.remote = { payload: data({ shifts: shifts(1) }), updated_at: T1 };
    setMeta({
      localChangedAt: ms(T0) + 5000,
      localWorkChangedAt: ms(T0) + 5000,
      lastSyncedAt: ms(T0) + 1000,
      remoteSeenAt: ms(T0),
      remoteToken: T0,
    });
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(mod.getSyncState().status).toBe("conflict");
    expect(replaced).toHaveLength(0);
    expect(local.payments).toHaveLength(1);
  });

  it("Erstabgleich: Nicht-Schicht-Daten und Cloud-Stand → Konflikt statt Restore (jede Sammlung)", async () => {
    for (const name of COLLECTION_NAMES) {
      window.localStorage.clear();
      replaced.length = 0;
      cloud.writes = [];
      local = data({ [name]: [rec(name)] });
      cloud.remote = { payload: data({ shifts: shifts(3) }), updated_at: T1 };
      const mod = await loadModule();
      mod.initCloudSync();
      await settle();
      expect(mod.getSyncState().status, name).toBe("conflict");
      expect(replaced, name).toHaveLength(0);
      expect(cloud.writes, name).toEqual([]);
    }
  });

  it("Einstellungen allein bleiben ausgenommen: nur Einstellungs-Änderung + neuere Cloud → Restore", async () => {
    syncedBaseline();
    cloud.remote = {
      payload: data({
        shifts: shifts(2),
        settings: { autoBackup: true, onboarded: true, language: "en" },
      }),
      updated_at: T1,
    };
    local = { ...local, settings: { ...local.settings, defaultRate: 18 } } as AppData;
    setMeta({
      localChangedAt: ms(T0) + 5000,
      localWorkChangedAt: null,
      lastSyncedAt: ms(T0) + 1000,
      remoteSeenAt: ms(T0),
      remoteToken: T0,
    });
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(replaced).toHaveLength(1);
  });

  it("lokale Daten weichen ab, aber es gibt keine Änderungsmarke und die Cloud ist unverändert → als Änderung erkannt", async () => {
    const payment = { id: "pay-import", jobId: "j", year: 2026, month: 1, actual: 1 };

    // Auto-Backup AN: die erkannte Änderung wird gesichert (Marke geheilt → Upload → sauber).
    syncedBaseline();
    local = data({ shifts: shifts(2), payments: [payment] });
    let mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(cloud.writes).toEqual(["upsert"]);
    expect((cloud.remote?.payload as AppData).payments).toHaveLength(1);
    expect(mod.getSyncState().dirty).toBe(false);

    // Auto-Backup AUS: die erkannte Änderung bleibt sichtbar ungesichert, es wird nichts geschrieben.
    window.localStorage.clear();
    cloud.writes = [];
    syncedBaseline({}, false);
    local = data({ shifts: shifts(2), payments: [payment] }, false);
    mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(cloud.writes).toEqual([]);
    expect(readMeta().localWorkChangedAt).toBeGreaterThan(0);
    expect(mod.getSyncState().dirty).toBe(true);
  });
});

/* ============================================================== Dirty-Verfolgung */

describe("dirty ist unabhängig von Auto-Backup", () => {
  it("Auto-Backup AUS: Änderung markiert dirty, pending bleibt false – pending beweist nichts", async () => {
    syncedBaseline({}, false);
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(mod.getSyncState().dirty).toBe(false);

    local = { ...local, shifts: shifts(3) } as AppData;
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mod.getSyncState().pending).toBe(false); // das alte Signal sieht nichts
    expect(mod.getSyncState().dirty).toBe(true); // die Änderungsmarke schon
    expect(readMeta().localWorkChangedAt).toBeGreaterThan(0);
    expect(cloud.writes).toEqual([]);
  });

  it("Auto-Backup AN: nach erfolgreichem Sync des unveränderten Stands ist dirty gelöscht", async () => {
    syncedBaseline();
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();

    local = { ...local, shifts: shifts(3) } as AppData;
    changeHook?.(local);
    expect(mod.getSyncState().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(2600);

    expect(cloud.writes).toEqual(["upsert"]);
    expect(mod.getSyncState().dirty).toBe(false);
    expect(readMeta().localChangedAt).toBeNull();
    expect(mod.getSyncState().lastVerifiedAt).toBeGreaterThan(0);
  });

  it("Änderungen während eines laufenden Uploads bleiben dirty (mit und ohne Änderungsmarke)", async () => {
    syncedBaseline();
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();

    local = { ...local, shifts: shifts(3) } as AppData;
    changeHook?.(local);
    const g = gate();
    cloud.upsertGate = g.promise;
    await vi.advanceTimersByTimeAsync(2600); // Upload läuft, blockiert

    // (a) mit Marke
    local = { ...local, shifts: shifts(4) } as AppData;
    changeHook?.(local);
    // (b) und eine zweite Änderung OHNE Hook (Fingerprint-Prüfung greift trotzdem)
    local = { ...local, goals: [rec("goal")] } as AppData;
    g.open();
    cloud.upsertGate = null;
    await settle();

    expect(mod.getSyncState().dirty).toBe(true);
    expect(readMeta().localChangedAt).not.toBeNull();
    expect((cloud.remote?.payload as AppData).shifts).toHaveLength(3); // der alte Stand wurde gesichert
  });

  it("Ohne Marken-Wechsel: Änderung nur im Daten-Fingerprint hält den Stand ungesichert", async () => {
    syncedBaseline();
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();

    local = { ...local, shifts: shifts(3) } as AppData;
    changeHook?.(local);
    const g = gate();
    cloud.upsertGate = g.promise;
    await vi.advanceTimersByTimeAsync(2600);
    local = { ...local, objects: [rec("object")] } as AppData; // KEIN changeHook
    g.open();
    await settle();

    expect(fullFingerprint(local as never)).not.toBe(
      fullFingerprint(cloud.remote?.payload as never),
    );
    expect(mod.getSyncState().dirty).toBe(true);
  });

  it("fehlgeschlagener Upload: dirty bleibt, lastVerifiedAt wird nie aktualisiert", async () => {
    syncedBaseline({ lastVerifiedAt: 12345 });
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    const verifiedBefore = readMeta().lastVerifiedAt;

    cloud.upsertError = { message: "kaputt" };
    local = { ...local, shifts: shifts(3) } as AppData;
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(2600);

    expect(mod.getSyncState().status).toBe("error");
    expect(mod.getSyncState().dirty).toBe(true);
    expect(readMeta().lastVerifiedAt).toBe(verifiedBefore);
    expect(readMeta().localWorkChangedAt).not.toBeNull();
  });

  it("Timeout (mehrdeutig) markiert nie sauber", async () => {
    syncedBaseline();
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    local = { ...local, shifts: shifts(3) } as AppData;
    changeHook?.(local);
    cloud.upsertGate = new Promise<void>(() => {}); // antwortet nie
    await vi.advanceTimersByTimeAsync(2600 + 16_000);
    expect(["error", "offline"]).toContain(mod.getSyncState().status);
    expect(mod.getSyncState().dirty).toBe(true);
    expect(mod.getSyncState().lastVerifiedAt).not.toBeNull(); // der ALTE Zeitpunkt, kein neuer
    expect(readMeta().lastVerifiedAt).toBeLessThan(Date.now() - 10_000);
  });

  it("getBackupHealthInput: dirty kommt aus den Marken, Herkunft ist unabhängig", async () => {
    syncedBaseline({}, false);
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    local = { ...local, shifts: shifts(3) } as AppData;
    changeHook?.(local);

    const input = mod.getBackupHealthInput("non-canonical", 1_000);
    expect(input).toMatchObject({
      signedIn: true,
      scopeKind: "user",
      origin: "non-canonical",
      hasData: true,
      autoBackup: false,
      dirty: true,
      now: 1_000,
    });
    const { deriveBackupHealth } = await import("./backup-status");
    expect(deriveBackupHealth(input)).toMatchObject({
      state: "dirty-autobackup-off",
      originWarning: true,
    });
  });
});

/* ===================================================== Auto-Backup AUS: kein Upload */

describe("Auto-Backup AUS: kein automatischer Pfad schreibt (kein upsert/POST/PATCH)", () => {
  /** Lokale Änderung, Cloud unverändert: der klassische Upload-Fall. */
  function dirtyOffBaseline() {
    syncedBaseline({}, false);
    local = { ...local, shifts: shifts(3) } as AppData;
    setMeta({
      localChangedAt: ms(T0) + 5000,
      localWorkChangedAt: ms(T0) + 5000,
      lastSyncedAt: ms(T0) + 1000,
      remoteSeenAt: ms(T0),
      remoteToken: T0,
    });
  }

  it("Kontrolle: mit Auto-Backup AN schreibt derselbe Startpfad (die Testharness erkennt Schreibzugriffe)", async () => {
    dirtyOffBaseline();
    local = { ...local, settings: { ...local.settings, autoBackup: true } } as AppData;
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(cloud.writes).toEqual(["upsert"]);
  });

  it("Start (getSession): nur lesen", async () => {
    dirtyOffBaseline();
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cloud.writes).toEqual([]);
    expect(cloud.selects).toBeGreaterThan(0); // Inspektion ist erlaubt
    expect(mod.getSyncState().dirty).toBe(true);
    expect(mod.getSyncState().status).toBe("idle");
  });

  it("Start ohne Cloud-Stand: kein Upload trotz lokaler Daten", async () => {
    local = data({ shifts: shifts(2) }, false);
    cloud.remote = null;
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cloud.writes).toEqual([]);
    expect(mod.getSyncState().dirty).toBe(true);
  });

  it("Anmeldung (SIGNED_IN nach Start als Gast): nur lesen", async () => {
    dirtyOffBaseline();
    session = null;
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    session = { user: { id: "user-1" } };
    authCallback?.("SIGNED_IN", session);
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cloud.writes).toEqual([]);
  });

  it("online-Wiederholung nach Offline-Phase: nur lesen", async () => {
    dirtyOffBaseline();
    setOnline(false);
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(mod.getSyncState().status).toBe("offline"); // pending = true
    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cloud.writes).toEqual([]);
    expect(mod.getSyncState().dirty).toBe(true);
  });

  it("retryPending (Wiederholen-Knopf-Pfad): nur lesen", async () => {
    dirtyOffBaseline();
    setOnline(false);
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    setOnline(true);
    mod.retryPending();
    await settle();
    expect(cloud.writes).toEqual([]);
  });

  it("Nach-Sync-Wiederholung (Änderung während des Abgleichs → Timer): nur lesen", async () => {
    syncedBaseline({}, false); // lokal == Cloud: Entscheidung "none"
    const mod = await loadModule();
    const g = gate();
    cloud.fetchGate = g.promise;
    mod.initCloudSync();
    await settle();
    // Änderung während des laufenden Abgleichs (nur Einstellung → kein Konflikt)
    local = { ...local, settings: { ...local.settings, defaultRate: 19 } } as AppData;
    changeHook?.(local);
    g.open();
    cloud.fetchGate = null;
    await settle();
    expect(mod.getSyncState().pending).toBe(true); // löst den Nachlauf-Timer aus
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cloud.writes).toEqual([]);
  });

  it("Sichtbarkeitswechsel und weitere Ereignisse lösen keinen Upload aus", async () => {
    dirtyOffBaseline();
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cloud.writes).toEqual([]);
  });

  it("lokale Änderung im laufenden Betrieb (scheduleBackup): kein Timer, kein Upload", async () => {
    syncedBaseline({}, false);
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    local = { ...local, shifts: shifts(5) } as AppData;
    changeHook?.(local);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cloud.writes).toEqual([]);
    expect(mod.getSyncState().dirty).toBe(true);
  });

  it("Cloud neuer + vorhandene Nutzerdaten: keine automatische Überschreibung, remoteAhead", async () => {
    syncedBaseline({}, false);
    cloud.remote = { payload: data({ shifts: shifts(8) }), updated_at: T1 };
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(replaced).toHaveLength(0);
    expect(cloud.writes).toEqual([]);
    expect(mod.getSyncState().remoteAhead).toBe(true);
    expect(local.shifts).toHaveLength(2);
  });

  it("Konflikt-Lage mit Auto-Backup AUS: nie ein Upload", async () => {
    local = data({ shifts: shifts(2) }, false);
    cloud.remote = { payload: data({ shifts: shifts(9) }), updated_at: T1 };
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(mod.getSyncState().status).toBe("conflict");
    expect(cloud.writes).toEqual([]);
  });

  it("ausdrücklicher manueller Upload bleibt möglich (backupNow)", async () => {
    dirtyOffBaseline();
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    await mod.backupNow();
    expect(cloud.writes).toEqual(["upsert"]);
    expect(mod.getSyncState().dirty).toBe(false);
  });
});

/* ============================================================ Leer-Gerät-Regel */

describe("automatische Erst-Wiederherstellung nur für ein nachweislich leeres Gerät", () => {
  it.each(COLLECTION_NAMES)(
    "ein einziger Datensatz in %s verhindert die Wiederherstellung",
    async (name) => {
      local = data({ [name]: [rec(name)] });
      cloud.remote = { payload: data({ shifts: shifts(3) }), updated_at: T1 };
      const mod = await loadModule();
      mod.initCloudSync();
      await settle();
      expect(replaced).toHaveLength(0);
      expect(mod.getSyncState().status).toBe("conflict");
    },
  );

  it("leeres Gerät (nur Einstellungen) → automatische Wiederherstellung, auch bei Auto-Backup AUS", async () => {
    for (const autoBackup of [true, false]) {
      window.localStorage.clear();
      replaced.length = 0;
      cloud.writes = [];
      local = data({}, autoBackup);
      cloud.remote = { payload: data({ shifts: shifts(3) }), updated_at: T1 };
      const mod = await loadModule();
      mod.initCloudSync();
      await settle();
      expect(replaced).toHaveLength(1);
      expect(cloud.writes).toEqual([]);
    }
  });

  it("Wizard-Job (onboarded=false, wizardPendingFirstSync) verhindert die automatische Wiederherstellung", async () => {
    local = data({ jobs: [{ id: "wizard", name: "Erster Job" }] });
    (local.settings as { onboarded: boolean }).onboarded = false;
    cloud.remote = { payload: data({ shifts: shifts(3) }), updated_at: T1 };
    setMeta({ wizardPendingFirstSync: true, localChangedAt: Date.now(), lastSyncedAt: null });
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(replaced).toHaveLength(0);
    expect(mod.getSyncState().status).toBe("conflict");
  });

  it("Prüfung zum Inspektionszeitpunkt nutzt den AKTUELLEN Stand (Daten entstehen während des Fetch)", async () => {
    local = data();
    cloud.remote = { payload: data({ shifts: shifts(3) }), updated_at: T1 };
    const g = gate();
    cloud.fetchGate = g.promise;
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    local = data({ payments: [rec("payment")] }); // während des Fetch
    g.open();
    cloud.fetchGate = null;
    await settle();
    expect(replaced).toHaveLength(0);
    expect(local.payments).toHaveLength(1);
  });

  it("zweite Prüfung unmittelbar vor dem Anwenden: nicht mehr leer → kein Überschreiben", async () => {
    local = data();
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    const remote = { payload: data({ shifts: shifts(3) }), updatedAt: ms(T1), token: T1 };
    const snap = mod.__testing.snapshotOwner();
    const epoch = mod.__testing.getSyncEpoch();

    local = data({ goals: [rec("goal")] }); // zwischen erster und zweiter Prüfung
    expect(mod.__testing.restoreIfVerifiedEmpty(remote, snap, epoch)).toBe(false);
    expect(replaced).toHaveLength(0);

    local = data(); // wieder leer → erlaubt
    expect(mod.__testing.restoreIfVerifiedEmpty(remote, snap, epoch)).toBe(true);
    expect(replaced).toHaveLength(1);
  });

  it("zweite Prüfung: veralteter Sync-Lauf (Epoche) → kein Überschreiben", async () => {
    local = data();
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    const remote = { payload: data({ shifts: shifts(3) }), updatedAt: ms(T1), token: T1 };
    const snap = mod.__testing.snapshotOwner();
    const staleEpoch = mod.__testing.getSyncEpoch() - 1;
    expect(mod.__testing.restoreIfVerifiedEmpty(remote, snap, staleEpoch)).toBe(false);
    expect(replaced).toHaveLength(0);
  });
});

/* ==================================================== Konto-/Scope-Wechsel bricht ab */

describe("Konto-/Scope-Wechsel bricht den Vorgang ab", () => {
  it("Abmeldung während des Fetch: weder Restore noch Upload noch Konflikt-Status", async () => {
    local = data();
    cloud.remote = { payload: data({ shifts: shifts(3) }), updated_at: T1 };
    const g = gate();
    cloud.fetchGate = g.promise;
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    authCallback?.("SIGNED_OUT", null);
    g.open();
    cloud.fetchGate = null;
    await settle();
    expect(replaced).toHaveLength(0);
    expect(cloud.writes).toEqual([]);
    expect(mod.getSyncState().status).toBe("idle");
  });

  it("Kontowechsel während des Fetch: kein Restore in den neuen Namensraum", async () => {
    local = data();
    cloud.remote = { payload: data({ shifts: shifts(3) }), updated_at: T1 };
    const g = gate();
    cloud.fetchGate = g.promise;
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    session = { user: { id: "user-2" } };
    authCallback?.("SIGNED_IN", session);
    g.open();
    cloud.fetchGate = null;
    await settle();
    expect(replaced.every((d) => d !== undefined)).toBe(true);
    // Alle Wiederherstellungen gehören zum NEUEN Konto (ein eigener, frischer Lauf), nie zum alten.
    expect(cloud.writes).toEqual([]);
  });
});
