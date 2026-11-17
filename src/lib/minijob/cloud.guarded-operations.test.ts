/**
 * Phase 4 – geschützte Cloud-Operationen und bedingtes Schreiben (CAS) in `cloud.ts`.
 *
 * Supabase ist ein Double (`backups-double`): bewiesen wird das Verhalten der APP gegen die
 * zugesicherte Schnittstelle, NICHT das Verhalten des echten PostgREST/Postgres.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installGuardedDoubles, type GuardedDoubles } from "@/test-utils/guarded-doubles";

import { COLLECTION_NAMES, fullFingerprint } from "./backup-compare";
import { SnapshotError } from "./backup-safety";
import type { AppData } from "./types";

type Remote = { payload: unknown; updated_at: string } | null;

const cloud = {
  remote: null as Remote,
  /** JEDER Schreibversuch ("insert"/"update"; "upsert" wäre ein Verstoß). */
  writes: [] as string[],
  selects: 0,
  /** Wird direkt vor jedem Schreibzugriff ausgeführt (parallele Änderung simulieren). */
  beforeWrite: null as null | (() => void),
  fault: null as null | { code?: string; message?: string },
  writeGate: null as Promise<void> | null,
  gated: 0,
};

let authCallback: ((event: string, session: unknown) => void) | null = null;
let session: { user: { id: string } } | null = null;

vi.mock("@/integrations/supabase/client", async () => {
  const { makeBackupsTable } = await import("@/test-utils/backups-double");
  return {
    supabase: {
      from: () =>
        makeBackupsTable({
          read: () => cloud.remote,
          write: (_u, row) => {
            cloud.remote = row;
          },
          onUpsert: () => cloud.writes.push("upsert"),
          onWrite: async (kind) => {
            cloud.writes.push(kind);
            cloud.beforeWrite?.();
            if (cloud.writeGate) {
              cloud.gated += 1;
              await cloud.writeGate;
            }
            return cloud.fault ? { error: cloud.fault } : null;
          },
          onSelect: async () => {
            cloud.selects += 1;
            return null;
          },
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
    // Wie der echte Store: ersetzen löst KEINEN Änderungs-Hook aus (sync=false).
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

const shifts = (n: number, prefix = "s") =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, date: `2026-01-0${(i % 9) + 1}` }));

function setMeta(meta: Record<string, unknown>) {
  window.localStorage.setItem(META_KEY, JSON.stringify({ userId: "user-1", ...meta }));
}
const readMeta = () => JSON.parse(window.localStorage.getItem(META_KEY) ?? "{}");

let doubles: GuardedDoubles;
async function loadModule() {
  vi.resetModules();
  doubles = await installGuardedDoubles();
  return await import("./cloud");
}

async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

/** Der Ablauf nutzt SHA-256 (echt asynchron): mit dem echten Takt warten. */
async function untilReal(cond: () => boolean, timeoutMs = 20_000) {
  // Echte Zeit (nicht Fake-Timer): SHA-256 läuft im Threadpool und braucht unter Last länger.
  const { setTimeout: realSleep } = await import("node:timers/promises");
  const deadline = performance.now() + timeoutMs;
  while (!cond() && performance.now() < deadline) await realSleep(2);
}

beforeEach(() => {
  cloud.remote = null;
  cloud.writes = [];
  cloud.selects = 0;
  cloud.beforeWrite = null;
  cloud.fault = null;
  cloud.writeGate = null;
  cloud.gated = 0;
  authCallback = null;
  changeHook = null;
  replaced.length = 0;
  session = { user: { id: "user-1" } };
  local = data({ shifts: shifts(2) });
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Lokal und Cloud gleich, Token T0 bekannt. */
function baseline(autoBackup = true) {
  local = data({ shifts: shifts(2) }, autoBackup);
  cloud.remote = { payload: data({ shifts: shifts(2) }, autoBackup), updated_at: T0 };
  setMeta({
    localChangedAt: null,
    localWorkChangedAt: null,
    lastSyncedAt: ms(T0) + 1000,
    remoteSeenAt: ms(T0),
    remoteToken: T0,
  });
}

/** Lokal geändert (3 Schichten), Cloud unverändert beim bekannten Token T0. */
function dirtyBaseline(autoBackup = true) {
  baseline(autoBackup);
  local = data({ shifts: shifts(3) }, autoBackup);
  setMeta({
    localChangedAt: ms(T0) + 5000,
    localWorkChangedAt: ms(T0) + 5000,
    lastSyncedAt: ms(T0) + 1000,
    remoteSeenAt: ms(T0),
    remoteToken: T0,
  });
}

async function started(autoBackup = true) {
  const mod = await loadModule();
  mod.initCloudSync();
  await settle();
  // der Start (Auto-Backup AN) darf schon geschrieben haben: ab hier zählen
  cloud.writes = [];
  cloud.selects = 0;
  return mod;
}

/* ===================================================================== Cloud-Backup */

describe("manuelles Cloud-Backup (backupNow)", () => {
  it("liest die Cloud zuerst, zeigt nur-Cloud und nur-lokale Datensätze, sichert die Cloud-Kopie, schreibt bedingt", async () => {
    dirtyBaseline(false);
    cloud.remote = { payload: data({ shifts: [...shifts(2), ...shifts(4, "c")] }), updated_at: T0 };
    const mod = await started(false);

    const result = await mod.backupNow();

    expect(result.status).toBe("done");
    expect(cloud.writes).toEqual(["update"]);
    const preview = doubles.previews[0]!;
    expect(preview).toMatchObject({ kind: "cloud-backup", replaces: "cloud" });
    const s = preview.collections.find((c) => c.name === "shifts")!;
    expect(s.lost).toBe(4); // nur in der Cloud (c0..c3): gehen verloren
    expect(s.added).toBe(1); // nur lokal (s2): kommt hinzu
    const snap = [...doubles.storage.records.values()];
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ kind: "cloud_pre_overwrite", state: "verified" });
    expect(snap[0]!.counts.shifts).toBe(6);
    expect((cloud.remote?.payload as AppData).shifts).toHaveLength(3);
  });

  it("neuer Token ist verschieden vom beobachteten und wird exakt gespeichert", async () => {
    dirtyBaseline(false);
    const mod = await started(false);
    await mod.backupNow();
    const meta = readMeta();
    expect(meta.remoteToken).toBe(cloud.remote!.updated_at);
    expect(meta.remoteToken).not.toBe(T0);
    expect(new Date(meta.remoteToken).getTime()).toBeGreaterThan(ms(T0));
    expect(meta.pendingWrite).toBeNull();
  });

  it("keine Cloud-Zeile: Insert (kein Upsert), kein Snapshot nötig", async () => {
    local = data({ shifts: shifts(2) }, false);
    cloud.remote = null;
    const mod = await started(false);
    const result = await mod.backupNow();
    expect(result.status).toBe("done");
    expect(cloud.writes).toEqual(["insert"]);
    expect(doubles.storage.records.size).toBe(0);
  });

  it("dirty wird erst nach verifiziertem Erfolg gelöscht", async () => {
    dirtyBaseline(false);
    const mod = await started(false);
    expect(mod.getSyncState().dirty).toBe(true);
    await mod.backupNow();
    expect(mod.getSyncState().dirty).toBe(false);
  });

  it("dirty bleibt, wenn sich lokal NACH dem Bau des Payloads etwas ändert (Änderung während des Schreibens)", async () => {
    dirtyBaseline(false);
    const mod = await started(false);
    cloud.beforeWrite = () => {
      local = data({ shifts: shifts(5) }, false); // der Nutzer arbeitet weiter
    };
    // Die Änderung entsteht erst beim Schreiben (nach der Prüfung): erlaubt, bleibt aber dirty.
    const result = await mod.backupNow();
    expect(result.status).toBe("done");
    expect(mod.getSyncState().dirty).toBe(true);
  });

  it("Cloud ändert sich nach dem Vergleich → remote-changed, nichts geschrieben, dirty bleibt", async () => {
    dirtyBaseline(false);
    const mod = await started(false);
    doubles.setAnswer(() => {
      cloud.remote = { payload: data({ shifts: shifts(9, "x") }), updated_at: T1 };
      return true;
    });
    const result = await mod.backupNow();
    expect(result).toMatchObject({ status: "aborted", reason: "remote-changed" });
    expect(cloud.writes).toEqual([]);
    expect(cloud.remote?.updated_at).toBe(T1);
    expect(mod.getSyncState().dirty).toBe(true);
  });

  it("Cloud ändert sich zwischen Prüfung und Schreiben → 0 Zeilen → Konflikt, EIN Versuch, kein Wiederholen", async () => {
    dirtyBaseline(false);
    const mod = await started(false);
    cloud.beforeWrite = () => {
      cloud.remote = { payload: data({ shifts: shifts(9, "x") }), updated_at: T1 };
    };
    const result = await mod.backupNow();
    expect(result).toMatchObject({ status: "aborted", reason: "commit-failed" });
    expect((result as { error: Error }).error.name).toBe("CasStaleError");
    expect(cloud.writes).toEqual(["update"]); // genau ein Versuch
    expect(cloud.remote?.updated_at).toBe(T1); // fremder Stand unberührt
    expect(mod.getSyncState().status).toBe("conflict");
    expect(mod.getSyncState().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(cloud.writes).toEqual(["update"]); // auch später kein stilles Wiederholen
  });

  it("Insert trifft eine inzwischen vorhandene Zeile (23505) → Konflikt, nichts überschrieben", async () => {
    local = data({ shifts: shifts(2) }, false);
    cloud.remote = null;
    const mod = await started(false);
    cloud.beforeWrite = () => {
      cloud.remote = { payload: data({ shifts: shifts(7, "x") }), updated_at: T1 };
    };
    const result = await mod.backupNow();
    expect(result).toMatchObject({ status: "aborted", reason: "commit-failed" });
    expect((result as { error: Error }).error.name).toBe("CasStaleError");
    expect(cloud.writes).toEqual(["insert"]);
    expect(((cloud.remote as Remote)?.payload as AppData).shifts).toHaveLength(7);
    expect(mod.getSyncState().status).toBe("conflict");
  });

  it("23503 (Konto existiert nicht mehr) → Abbruch mit sicherer Meldung, dirty bleibt, kein Wiederholen", async () => {
    dirtyBaseline(false);
    const mod = await started(false);
    cloud.fault = { code: "23503", message: "fk violation users" };
    const result = await mod.backupNow();
    expect(result).toMatchObject({ status: "aborted", reason: "commit-failed" });
    expect((result as { error: Error }).error.name).toBe("CloudAccountGoneError");
    expect(cloud.writes).toEqual(["update"]);
    expect(mod.getSyncState().dirty).toBe(true);
    expect(mod.getSyncState().message ?? "").not.toMatch(/fk violation/);
  });

  it("42501 (RLS/Auth) → sichere Meldung ohne Serverdetails, dirty bleibt", async () => {
    dirtyBaseline(false);
    const mod = await started(false);
    cloud.fault = { code: "42501", message: "new row violates row-level security policy" };
    const result = await mod.backupNow();
    expect((result as { error: Error }).error.name).toBe("CloudAuthError");
    expect(mod.getSyncState().message ?? "").not.toMatch(/row-level/);
    expect(mod.getSyncState().dirty).toBe(true);
    expect(cloud.writes).toEqual(["update"]);
  });

  it("ohne Bestätigung: nichts gesichert, nichts geschrieben", async () => {
    dirtyBaseline(false);
    const mod = await started(false);
    doubles.setAnswer(false);
    const result = await mod.backupNow();
    expect(result.status).toBe("cancelled");
    expect(cloud.writes).toEqual([]);
    expect(doubles.storage.records.size).toBe(0);
    expect(mod.getSyncState().dirty).toBe(true);
  });

  it("Snapshot schlägt fehl → die Cloud wird NICHT überschrieben", async () => {
    dirtyBaseline(false);
    cloud.remote = { payload: data({ shifts: shifts(6, "c") }), updated_at: T0 };
    const mod = await started(false);
    doubles.storage.failAlways("put", new SnapshotError("quota"));
    const result = await mod.backupNow();
    expect(result).toMatchObject({ status: "aborted", reason: "snapshot-failed" });
    expect(cloud.writes).toEqual([]);
    expect((cloud.remote?.payload as AppData).shifts).toHaveLength(6);
    expect(mod.getSyncState().dirty).toBe(true);
  });

  it("beide Seiten gleich: kein Schreiben, kein Snapshot, Basis wird bereinigt", async () => {
    baseline(false);
    const mod = await started(false);
    const result = await mod.backupNow();
    expect(result).toMatchObject({ status: "done", unchanged: true });
    expect(cloud.writes).toEqual([]);
    expect(doubles.storage.records.size).toBe(0);
  });

  it("Auto-Backup AUS: automatisch keine Schreibzugriffe, das manuelle Backup bleibt möglich", async () => {
    dirtyBaseline(false);
    const mod = await started(false);
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(cloud.writes).toEqual([]);
    expect((await mod.backupNow()).status).toBe("done");
    expect(cloud.writes).toEqual(["update"]);
  });

  it("Aufwand: genau 2 Lesezugriffe (Vergleich + erneute Prüfung), 1 bedingter Schreibzugriff, 1 Snapshot, keine Wiederholung", async () => {
    dirtyBaseline(false);
    cloud.remote = { payload: data({ shifts: [...shifts(2), ...shifts(2, "c")] }), updated_at: T0 };
    const mod = await started(false);
    await mod.backupNow();
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(cloud.selects).toBe(2);
    expect(cloud.writes).toEqual(["update"]);
    expect(doubles.storage.records.size).toBe(1);
    // Snapshot: je 1 Schreiben, 1 Rücklesen, 1 Markieren, 1 Aufräumprüfung (kein Mehrfachanlegen).
    expect(doubles.storage.calls.filter((c) => c === "put")).toHaveLength(1);
    expect(doubles.storage.calls.filter((c) => c === "markVerified")).toHaveLength(1);
  });

  it("Sperre: parallele zweite Aktion wird abgewiesen (lock-busy)", async () => {
    dirtyBaseline(false);
    const mod = await started(false);
    let release!: () => void;
    const hold = new Promise<boolean>((r) => (release = () => r(true)));
    doubles.setAnswer(() => hold);
    const first = mod.backupNow();
    await untilReal(() => doubles.previews.length > 0);
    expect(await mod.backupNow()).toMatchObject({ status: "aborted", reason: "lock-busy" });
    release();
    expect((await first).status).toBe("done");
  });

  it("Premium-unabhängig: kein Premium-/Abo-Bezug im geschützten Ablauf", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of [
      "guarded-operation.ts",
      "guarded-local.ts",
      "guarded-ports.ts",
      "cloud-cas.ts",
    ]) {
      const src = readFileSync(`${process.cwd()}/src/lib/minijob/${f}`, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(src).not.toMatch(/premium|subscription|entitlement|isPro/i);
    }
  });
});

/* ======================================================== unklares Ergebnis (Timeout) */

describe("unklares Schreibergebnis (Timeout) wird bei der nächsten Inspektion geklärt", () => {
  async function timeoutWrite() {
    dirtyBaseline(false);
    const mod = await started(false);
    cloud.writeGate = new Promise<void>(() => {}); // antwortet nie
    const pending = mod.backupNow();
    await untilReal(() => cloud.gated === 1);
    await vi.advanceTimersByTimeAsync(mod.SYNC_TIMEOUT_MS + 50);
    const result = await pending;
    expect(result).toMatchObject({ status: "aborted", reason: "commit-failed" });
    const pendingWrite = readMeta().pendingWrite as {
      observedToken: string;
      attemptedToken: string;
      fingerprint: string;
    };
    // Versuch + Fingerprint wurden VOR dem Senden festgehalten.
    expect(pendingWrite.observedToken).toBe(T0);
    expect(pendingWrite.attemptedToken).not.toBe(T0);
    expect(mod.getSyncState().dirty).toBe(true);
    cloud.writeGate = null;
    return { pendingWrite, sent: local };
  }

  it("Token UND Inhalt stimmen → der erfolgreiche Schreibvorgang wird übernommen (dirty gelöscht)", async () => {
    const { pendingWrite, sent } = await timeoutWrite();
    // Der Server hat den Schreibvorgang doch verarbeitet.
    cloud.remote = { payload: { ...sent, timer: null }, updated_at: pendingWrite.attemptedToken };
    cloud.writes = [];
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(cloud.writes).toEqual([]); // nie blind wiederholt
    expect(readMeta().pendingWrite).toBeNull();
    expect(readMeta().remoteToken).toBe(pendingWrite.attemptedToken);
    expect(mod.getSyncState().dirty).toBe(false);
  });

  it("beobachteter Token unverändert → nicht angekommen: Marke weg, KEIN automatischer Upload, neu vorbereiten", async () => {
    await timeoutWrite();
    cloud.writes = [];
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(readMeta().pendingWrite).toBeNull();
    expect(cloud.writes).toEqual([]); // Auto-Backup AUS: kein Upload
    expect(mod.getSyncState().dirty).toBe(true);
    // Der Nutzer bereitet neu vor und bestätigt: jetzt wird bedingt geschrieben.
    expect((await mod.backupNow()).status).toBe("done");
    expect(cloud.writes).toEqual(["update"]);
  });

  it("anderer Token → Konflikt, nichts überschrieben", async () => {
    await timeoutWrite();
    cloud.remote = { payload: data({ shifts: shifts(9, "x") }), updated_at: T1 };
    cloud.writes = [];
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(readMeta().pendingWrite).toBeNull();
    expect(mod.getSyncState().status).toBe("conflict");
    expect(cloud.writes).toEqual([]);
    expect(cloud.remote?.updated_at).toBe(T1);
  });

  it("gleicher Token, aber fremder Inhalt → Konflikt (nie als eigener Erfolg übernommen)", async () => {
    const { pendingWrite } = await timeoutWrite();
    cloud.remote = {
      payload: data({ shifts: shifts(9, "x") }),
      updated_at: pendingWrite.attemptedToken,
    };
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(mod.getSyncState().status).toBe("conflict");
    expect(mod.getSyncState().dirty).toBe(true);
  });

  it("Neustart mit Auto-Backup AN nach unklarem Schreiben: erst lesen, nie mit dem alten Token schreiben; bei fremder Änderung gar nicht", async () => {
    await timeoutWrite();
    // Nach dem Neustart ist Auto-Backup AN (die Einstellung stammt aus den lokalen Daten).
    local = { ...local, settings: { ...local.settings, autoBackup: true } } as AppData;
    cloud.remote = { payload: data({ shifts: shifts(9, "x") }), updated_at: T1 };
    cloud.writes = [];
    cloud.selects = 0;
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(cloud.selects).toBeGreaterThan(0);
    expect(cloud.writes).toEqual([]); // fremder Stand: Konflikt, kein Schreiben
    expect(cloud.remote?.updated_at).toBe(T1);
    expect(mod.getSyncState().status).toBe("conflict");
  });

  it("Neustart nach unklarem Schreiben, Cloud unverändert: ein frischer, bedingter Versuch mit dem AKTUELLEN Token (kein Wiederholen des alten)", async () => {
    await timeoutWrite();
    local = { ...local, settings: { ...local.settings, autoBackup: true } } as AppData;
    cloud.writes = [];
    const seen: string[] = [];
    cloud.beforeWrite = () => seen.push(cloud.remote?.updated_at ?? "none");
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(cloud.writes).toEqual(["update"]); // genau ein Versuch
    expect(seen).toEqual([T0]); // Cloud stand beim Schreiben auf dem beobachteten Token
    expect(readMeta().pendingWrite).toBeNull();
  });

  it("Zustand 'markiert, Daten noch alt, Cloud neuer' (Absturz zwischen Marke und Datenwechsel) → Konflikt, nie stilles Überschreiben", async () => {
    local = data({ shifts: shifts(2) }, true);
    cloud.remote = { payload: data({ shifts: shifts(5, "c") }), updated_at: T1 };
    setMeta({
      localChangedAt: ms(T0) + 5000,
      localWorkChangedAt: ms(T0) + 5000,
      lastSyncedAt: null,
      remoteSeenAt: null,
      remoteToken: null,
    });
    const mod = await started(true);
    expect(mod.getSyncState().status).toBe("conflict");
    expect(replaced).toHaveLength(0);
    expect(cloud.writes).toEqual([]);
  });
});

/* ===================================================================== Cloud-Restore */

describe("Cloud-Wiederherstellung (restoreNow)", () => {
  function cloudAhead() {
    local = data({ shifts: shifts(3), jobs: [{ id: "j-local" }] }, false);
    cloud.remote = {
      payload: data({ shifts: shifts(2, "c"), jobs: [{ id: "j-cloud" }] }),
      updated_at: T1,
    };
    setMeta({
      localChangedAt: 1,
      localWorkChangedAt: 1,
      lastSyncedAt: ms(T0),
      remoteSeenAt: ms(T0),
      remoteToken: T0,
    });
  }

  it("zeigt, welche lokalen Datensätze verloren gehen; sichert den lokalen Stand; ersetzt dann", async () => {
    cloudAhead();
    const mod = await started(false);
    const result = await mod.restoreNow();
    expect(result.status).toBe("done");
    const preview = doubles.previews[0]!;
    expect(preview).toMatchObject({ kind: "cloud-restore", replaces: "local" });
    expect(preview.collections.find((c) => c.name === "shifts")!.lost).toBe(3);
    expect(preview.collections.find((c) => c.name === "jobs")!.lost).toBe(1);
    const snap = [...doubles.storage.records.values()];
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ kind: "local_pre_restore", state: "verified" });
    expect(snap[0]!.counts.shifts).toBe(3);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.shifts.map((s) => s.id)).toEqual(["c0", "c1"]);
  });

  it("Remote-Token ändert sich nach dem Vergleich → Abbruch, lokale Daten unverändert", async () => {
    cloudAhead();
    const mod = await started(false);
    const before = JSON.stringify(local);
    doubles.setAnswer(() => {
      cloud.remote = {
        payload: data({ shifts: shifts(8, "z") }),
        updated_at: "2026-12-01T00:00:00.000+00:00",
      };
      return true;
    });
    const result = await mod.restoreNow();
    expect(result).toMatchObject({ status: "aborted", reason: "remote-changed" });
    expect(replaced).toHaveLength(0);
    expect(JSON.stringify(local)).toBe(before);
  });

  it("lokale Daten ändern sich nach dem Vergleich → Abbruch, nichts ersetzt", async () => {
    cloudAhead();
    const mod = await started(false);
    doubles.setAnswer(() => {
      local = data({ shifts: shifts(4), jobs: [{ id: "j-local" }] }, false);
      return true;
    });
    expect(await mod.restoreNow()).toMatchObject({ status: "aborted", reason: "local-changed" });
    expect(replaced).toHaveLength(0);
  });

  it("Snapshot schlägt fehl / Verifikation schlägt fehl → nichts ersetzt", async () => {
    cloudAhead();
    const mod = await started(false);
    doubles.storage.failAlways("put", new SnapshotError("quota"));
    expect(await mod.restoreNow()).toMatchObject({ status: "aborted", reason: "snapshot-failed" });
    expect(replaced).toHaveLength(0);

    doubles.storage.clearFailures();
    const orig = doubles.storage.get.bind(doubles.storage);
    doubles.storage.get = async (id) => {
      const r = await orig(id);
      return r ? { ...r, payload: r.payload.replace("s0", "sX") } : r;
    };
    expect(await mod.restoreNow()).toMatchObject({ status: "aborted", reason: "snapshot-failed" });
    expect(replaced).toHaveLength(0);
  });

  it("ohne Bestätigung: nichts ersetzt, nichts gesichert", async () => {
    cloudAhead();
    const mod = await started(false);
    doubles.setAnswer(false);
    expect((await mod.restoreNow()).status).toBe("cancelled");
    expect(replaced).toHaveLength(0);
    expect(doubles.storage.records.size).toBe(0);
  });

  it("keine Cloud-Sicherung → remote-missing, nichts verändert", async () => {
    local = data({ shifts: shifts(2) }, false);
    cloud.remote = null;
    const mod = await started(false);
    expect(await mod.restoreNow()).toMatchObject({ status: "aborted", reason: "remote-missing" });
    expect(replaced).toHaveLength(0);
  });

  it("Gerätesperre (PIN/Biometrie) bleibt lokal; die Cloud-PIN wird nicht übernommen", async () => {
    cloudAhead();
    local = {
      ...local,
      settings: {
        ...local.settings,
        pin: "4242",
        pinEnabled: true,
        biometric: true,
        biometricCredentialId: "cred-local",
      },
    } as AppData;
    cloud.remote = {
      payload: {
        ...data({ shifts: shifts(2, "c") }),
        settings: {
          autoBackup: false,
          onboarded: true,
          pin: "9999",
          pinEnabled: true,
          biometricCredentialId: "cred-remote",
        },
      },
      updated_at: T1,
    };
    const mod = await started(false);
    await mod.restoreNow();
    const applied = replaced[0]!.settings as { pin?: string; biometricCredentialId?: string };
    expect(applied.pin).toBe("4242");
    expect(applied.biometricCredentialId).toBe("cred-local");
    // Auch der Snapshot enthält keine Gerätesperre.
    const text = [...doubles.storage.records.values()][0]!.payload;
    expect(text).not.toContain("4242");
    expect(text).not.toContain("cred-local");
  });

  it("dirty nach der Wiederherstellung: sauber (Basis = Cloud-Stand)", async () => {
    cloudAhead();
    const mod = await started(false);
    expect(mod.getSyncState().dirty).toBe(true);
    await mod.restoreNow();
    expect(mod.getSyncState().dirty).toBe(false);
    expect(readMeta().remoteToken).toBe(T1);
  });

  it("alle acht Sammlungen + verwaiste Zahlung bleiben unverändert erhalten (Integrität wird nur gemeldet)", async () => {
    const full = data({
      shifts: shifts(1),
      jobs: [{ id: "j1" }],
      customers: [{ id: "cu1" }],
      projects: [{ id: "p1" }],
      payments: [{ id: "pay1", jobId: "j-gone", year: 2026, month: 1, actual: 5 }], // verwaist
      goals: [{ id: "g1" }],
      orders: [{ id: "o1" }],
      objects: [{ id: "ob1" }],
    });
    local = data({}, false);
    cloud.remote = { payload: full, updated_at: T1 };
    const mod = await started(false);
    const result = await mod.restoreNow();
    expect(result.status).toBe("done");
    const applied = replaced[0]!;
    for (const name of COLLECTION_NAMES) expect((applied as never)[name]).toHaveLength(1);
    expect(applied.payments[0]).toMatchObject({ id: "pay1", jobId: "j-gone", actual: 5 });
    expect(doubles.previews[0]!.integrity).toContainEqual({
      code: "payment-job-missing",
      collection: "payments",
    });
    expect(fullFingerprint(applied as never)).toBe(
      fullFingerprint({ ...full, settings: applied.settings } as never),
    );
  });
});

/* ============================================================= Konfliktentscheidung */

describe("Konfliktentscheidung (beide Richtungen)", () => {
  async function conflict() {
    local = data({ shifts: shifts(2) }, false);
    cloud.remote = { payload: data({ shifts: shifts(9, "c") }), updated_at: T1 };
    setMeta({ localChangedAt: 1, localWorkChangedAt: 1, lastSyncedAt: null, remoteSeenAt: null });
    const mod = await started(false);
    expect(mod.getSyncState().status).toBe("conflict");
    return mod;
  }

  it("Lokal behalten: Cloud-Kopie als cloud_pre_overwrite, dann bedingtes Schreiben (CAS)", async () => {
    const mod = await conflict();
    const result = await mod.resolveConflict("local");
    expect(result.status).toBe("done");
    expect(doubles.previews[0]!.kind).toBe("conflict-keep-local");
    const snap = [...doubles.storage.records.values()];
    expect(snap[0]).toMatchObject({ kind: "cloud_pre_overwrite" });
    expect(snap[0]!.counts.shifts).toBe(9);
    expect(cloud.writes).toEqual(["update"]);
    expect((cloud.remote?.payload as AppData).shifts).toHaveLength(2);
  });

  it("Cloud behalten: lokaler Stand als local_pre_restore, Token geprüft, dann lokal übernommen", async () => {
    const mod = await conflict();
    const result = await mod.resolveConflict("cloud");
    expect(result.status).toBe("done");
    expect(doubles.previews[0]!.kind).toBe("conflict-keep-cloud");
    const snap = [...doubles.storage.records.values()];
    expect(snap[0]).toMatchObject({ kind: "local_pre_restore" });
    expect(snap[0]!.counts.shifts).toBe(2);
    expect(cloud.writes).toEqual([]);
    expect(replaced[0]!.shifts).toHaveLength(9);
  });

  it("ohne Bestätigung bleiben beide Seiten unverändert (beide Richtungen)", async () => {
    const mod = await conflict();
    doubles.setAnswer(false);
    expect((await mod.resolveConflict("local")).status).toBe("cancelled");
    expect((await mod.resolveConflict("cloud")).status).toBe("cancelled");
    expect(cloud.writes).toEqual([]);
    expect(replaced).toHaveLength(0);
    expect(local.shifts).toHaveLength(2);
    expect((cloud.remote?.payload as AppData).shifts).toHaveLength(9);
  });
});

/* ======================================================= Kontowechsel während Operation */

describe("Konto-/Scope-Wechsel während einer Operation", () => {
  it("Abmeldung während der Bestätigung: nichts geschrieben, nichts ersetzt", async () => {
    dirtyBaseline(false);
    const mod = await started(false);
    doubles.setAnswer(() => {
      authCallback?.("SIGNED_OUT", null);
      return true;
    });
    const result = await mod.backupNow();
    expect(result).toMatchObject({ status: "aborted", reason: "scope-changed" });
    expect(cloud.writes).toEqual([]);
    expect(replaced).toHaveLength(0);
  });

  it("Kontowechsel während der Bestätigung (Restore): nichts ersetzt", async () => {
    local = data({ shifts: shifts(3) }, false);
    cloud.remote = { payload: data({ shifts: shifts(2, "c") }), updated_at: T1 };
    setMeta({
      localChangedAt: 1,
      localWorkChangedAt: 1,
      lastSyncedAt: ms(T0),
      remoteSeenAt: ms(T0),
      remoteToken: T0,
    });
    const mod = await started(false);
    doubles.setAnswer(() => {
      authCallback?.("SIGNED_OUT", null);
      session = { user: { id: "user-2" } };
      authCallback?.("SIGNED_IN", session);
      return true;
    });
    const result = await mod.restoreNow();
    expect(result).toMatchObject({ status: "aborted", reason: "scope-changed" });
    expect(replaced.filter((d) => d.shifts.some((s) => s.id === "c0"))).toHaveLength(0);
  });
});

/* ====================================================== Gerätesperre (PIN-Richtlinie) */

describe("Gerätesperre bei Cloud-Wiederherstellung und Upload (Phase 5, PIN-Richtlinie)", () => {
  const remoteWith = (settings: Record<string, unknown>): Remote => ({
    payload: {
      ...data({ shifts: shifts(2, "c") }),
      settings: { autoBackup: false, onboarded: true, ...settings },
    },
    updated_at: T1,
  });
  const localWith = (settings: Record<string, unknown>) => {
    local = {
      ...data({ shifts: shifts(3) }, false),
      settings: { autoBackup: false, onboarded: true, ...settings },
    } as AppData;
    setMeta({
      localChangedAt: 1,
      localWorkChangedAt: 1,
      lastSyncedAt: ms(T0),
      remoteSeenAt: ms(T0),
      remoteToken: T0,
    });
  };

  it("lokale PIN vorhanden: die Cloud-PIN wird NIE übernommen, der Dialog sagt 'unverändert'", async () => {
    localWith({ pin: "4242", pinEnabled: true });
    cloud.remote = remoteWith({ pin: "9999", pinEnabled: true });
    const mod = await started(false);
    await mod.restoreNow();
    expect(doubles.previews[0]!.deviceAuth).toBe("kept");
    expect((replaced[0]!.settings as { pin?: string }).pin).toBe("4242");
  });

  it("Cloud ohne PIN: keine PIN entsteht, deviceAuth = kept", async () => {
    localWith({});
    cloud.remote = remoteWith({});
    const mod = await started(false);
    await mod.restoreNow();
    expect(doubles.previews[0]!.deviceAuth).toBe("kept");
    expect((replaced[0]!.settings as { pin?: string }).pin).toBeUndefined();
  });

  it("DOKUMENTIERTES Altverhalten: ein alter Klartext-PIN im Cloud-Stand wird auf einem Gerät OHNE PIN gesetzt – aber nur nach sichtbarer Warnung", async () => {
    localWith({});
    cloud.remote = remoteWith({ pin: "9999", pinEnabled: true });
    const mod = await started(false);
    await mod.restoreNow();
    // Der Nutzer wurde vor der Bestätigung gewarnt (Dialog zeigt die Warnung statt "unverändert").
    expect(doubles.previews[0]!.deviceAuth).toBe("adopted");
    expect((replaced[0]!.settings as { pin?: string }).pin).toBe("9999");
    // Der Snapshot des lokalen Standes enthält keine Gerätesperre.
    expect([...doubles.storage.records.values()][0]!.payload).not.toContain("9999");
  });

  it("Upload: PIN und Biometrie-ID verlassen das Gerät nie (Cloud-Payload ohne Gerätesperre)", async () => {
    dirtyBaseline(false);
    local = {
      ...local,
      settings: {
        ...local.settings,
        pin: "4242",
        pinEnabled: true,
        biometric: true,
        biometricCredentialId: "cred-1",
      },
    } as AppData;
    const mod = await started(false);
    await mod.backupNow();
    const sent = JSON.stringify((cloud.remote as Remote)!.payload);
    expect(sent).not.toContain("4242");
    expect(sent).not.toContain("cred-1");
    const settings = ((cloud.remote as Remote)!.payload as AppData).settings as {
      pinEnabled?: boolean;
      biometric?: boolean;
    };
    expect(settings.pinEnabled).toBe(false);
    expect(settings.biometric).toBe(false);
  });
});

/* ============================================================ JSON-Import im Konto */

describe("JSON-Import im angemeldeten Konto: dirty ja, Upload nie automatisch (Auto-Backup AUS)", () => {
  const file = JSON.stringify({
    shifts: [
      {
        id: "f1",
        kind: "arbeit",
        date: "2026-05-01",
        start: "08:00",
        end: "09:00",
        breakMinutes: 0,
      },
    ],
    jobs: [{ id: "fj", name: "Datei-Job", color: "#000", mode: "flex" }],
    settings: { onboarded: true, pin: "7777", pinEnabled: true },
  });

  it("beide Importwege: Auto-Backup AUS → dirty, null Schreibzugriffe, lokale PIN bleibt", async () => {
    baseline(false);
    local = {
      ...data({ shifts: shifts(2) }, false),
      settings: { autoBackup: false, onboarded: true, pin: "4242", pinEnabled: true },
    } as AppData;
    const mod = await started(false);
    const gl = await import("./guarded-local");
    const { importJsonBackupFile } = await import("./json-backup-import");

    expect((await gl.importBackupText(file)).status).toBe("done");
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(local.shifts.map((x) => x.id)).toEqual(["f1"]);
    expect(cloud.writes).toEqual([]);
    expect(mod.getSyncState().dirty).toBe(true);
    expect((local.settings as { pin?: string }).pin).toBe("4242");

    // ImportDialog-Pfad: derselbe Ablauf.
    local = { ...local, shifts: shifts(2) } as AppData;
    expect((await importJsonBackupFile({ text: async () => file })).status).toBe("done");
    expect(cloud.writes).toEqual([]);
    expect(mod.getSyncState().dirty).toBe(true);
    expect(doubles.previews.map((p) => p.kind)).toEqual(["local-import", "local-import"]);
    // Die Daten vor dem Import sind je Import gesichert.
    expect([...doubles.storage.records.values()].every((r) => r.kind === "local_pre_import")).toBe(
      true,
    );
  });

  it("der Import löscht dirty nicht still (auch nicht bei einem vorher sauberen Stand)", async () => {
    baseline(false);
    const mod = await started(false);
    expect(mod.getSyncState().dirty).toBe(false);
    const gl = await import("./guarded-local");
    await gl.importBackupText(file);
    expect(mod.getSyncState().dirty).toBe(true);
  });

  it("danach bleibt das manuelle Cloud-Backup verfügbar und schreibt bedingt", async () => {
    baseline(false);
    const mod = await started(false);
    const gl = await import("./guarded-local");
    await gl.importBackupText(file);
    await settle(); // die automatische Inspektion nach dem Import ist abgeschlossen
    expect(cloud.writes).toEqual([]);
    // Der Import setzt die Basis zurück; die Cloud-Zeile existiert → der Nutzer vergleicht und bestätigt.
    expect((await mod.backupNow()).status).toBe("done");
    expect(cloud.writes).toEqual(["update"]);
  });
});

/* ================================================================= Kein Alt-Pfad */

describe("kein ungeschützter Weg, Daten zu ersetzen", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("replaceAll( wird in src/ nur von den erlaubten Modulen aufgerufen", async () => {
    const { execSync } = await import("node:child_process");
    const out = execSync(`grep -rln "replaceAll(" src --include=*.ts --include=*.tsx || true`, {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const files = out
      .split("\n")
      .filter(Boolean)
      .filter((f) => !/\.test\.|test-utils|test-harness|\/dict\//.test(f))
      .map((f) => f.replace(/^src\/(lib\/minijob\/)?/, ""))
      .sort();
    // store (Definition), cloud (applyRemote), guarded-local (Import/Snapshot), local-data-import (Legacy).
    expect(files).toEqual(
      ["cloud.ts", "guarded-local.ts", "local-data-import.ts", "store.ts"].sort(),
    );
  });

  it("cloud.ts: applyRemote hat nur drei Aufrufer – geschützter Restore, Leer-Gerät, unveränderter lokaler Stand", async () => {
    const { readFileSync } = await import("node:fs");
    const src = strip(readFileSync(`${process.cwd()}/src/lib/minijob/cloud.ts`, "utf8"));
    const calls = src.match(/\bapplyRemote\(/g) ?? [];
    expect(calls).toHaveLength(1 + 3); // 1 Definition + 3 Aufrufer
    expect(src.match(/replaceAll\(/g)).toHaveLength(1); // nur in applyRemote
  });

  it("local-data-import.ts: replaceAll nur für ein LEERES Ziel; sonst der geschützte Ablauf", async () => {
    const { readFileSync } = await import("node:fs");
    const src = strip(
      readFileSync(`${process.cwd()}/src/lib/minijob/local-data-import.ts`, "utf8"),
    );
    expect(src).toMatch(/hasMeaningfulData\(target\)[\s\S]{0,200}runGuardedOperation/);
  });

  it("die UI-Importmodule enthalten kein replaceAll mehr", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["json-backup-import.ts", "local-backup-restore.ts"]) {
      expect(readFileSync(`${process.cwd()}/src/lib/minijob/${f}`, "utf8")).not.toMatch(
        /replaceAll/,
      );
    }
  });
});

void changeHook;
