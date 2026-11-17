/**
 * Stage 1 – serverseitige Revision im Client: Inspektion mit `rev`, bedingtes Schreiben auf
 * `user_id` + beobachtete Revision, Rückfall auf den `updated_at`-CAS bei einem Schema ohne `rev`,
 * Erkennen älterer/fremder Schreiber und Zähler-Beobachtbarkeit.
 *
 * Supabase ist ein Double (`backups-double`, mit Revisions-/Altschema-Simulation). Die SQL-Seite
 * (Trigger, Sequenz, Rechte, Rollback) wird in `scripts/db-tests/rev_run.sh` gegen eine echte lokale
 * PostgreSQL geprüft – nicht hier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installGuardedDoubles, type GuardedDoubles } from "@/test-utils/guarded-doubles";

import type { AppData } from "./types";

type Remote = { payload: unknown; updated_at: string } | null;

const cloud = {
  remote: null as Remote,
  writes: [] as string[],
  filters: [] as string[],
  selectColumns: [] as string[],
  selectError: null as null | { code?: string; message?: string },
  writeError: null as null | { code?: string; message?: string },
  beforeWrite: null as null | (() => void),
  writeGate: null as Promise<void> | null,
  gated: 0,
};
const rev = {
  enabled: true,
  map: new Map<string, number>(),
  counter: 1000,
};

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
          rev: {
            enabled: () => rev.enabled,
            get: (uid) => rev.map.get(uid),
            next: (uid) => {
              rev.counter += 1 + Math.floor(Math.random() * 3); // Lücken sind erlaubt
              rev.map.set(uid, rev.counter);
              return rev.counter;
            },
          },
          onFilter: ({ kind, filter }) => cloud.filters.push(`${kind}:${filter}`),
          onUpsert: () => cloud.writes.push("upsert"),
          onWrite: async (kind) => {
            cloud.writes.push(kind);
            cloud.beforeWrite?.();
            if (cloud.writeGate) {
              cloud.gated += 1;
              await cloud.writeGate;
            }
            return cloud.writeError ? { error: cloud.writeError } : null;
          },
          onSelect: async () => (cloud.selectError ? { error: cloud.selectError } : null),
        }),
      auth: {
        getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});

let local: AppData;
const replaced: AppData[] = [];
vi.mock("./store", async () => {
  const actual = await vi.importActual<typeof import("./store")>("./store");
  return {
    ...actual,
    getData: () => local,
    onDataChange: () => {},
    replaceAll: (data: AppData) => {
      replaced.push(data);
      local = data;
    },
  };
});
vi.mock("./notify", () => ({ markBackup: vi.fn() }));

const META_KEY = "minijob-sync-meta-v1:u:user-1";
const DIAG_KEY = "minijob-sync-diagnostics-v1:u:user-1";
const T0 = "2026-10-27T19:28:52.738+00:00";
const T1 = "2026-11-16T18:16:36.894+00:00";
const ms = (iso: string) => new Date(iso).getTime();

function data(over: Record<string, unknown> = {}, autoBackup = false): AppData {
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
const shifts = (n: number, p = "s") =>
  Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, date: "2026-01-01" }));
const readMeta = () => JSON.parse(window.localStorage.getItem(META_KEY) ?? "{}");
const readDiag = () => JSON.parse(window.localStorage.getItem(DIAG_KEY) ?? "{}");
const setMeta = (m: Record<string, unknown>) =>
  window.localStorage.setItem(META_KEY, JSON.stringify({ userId: "user-1", ...m }));

let doubles: GuardedDoubles;
async function load() {
  vi.resetModules();
  doubles = await installGuardedDoubles();
  return await import("./cloud");
}
async function settle() {
  for (let i = 0; i < 14; i += 1) await Promise.resolve();
}
async function untilReal(cond: () => boolean, timeoutMs = 20_000) {
  const { setTimeout: sleep } = await import("node:timers/promises");
  const deadline = performance.now() + timeoutMs;
  while (!cond() && performance.now() < deadline) await sleep(2);
}

/** Lokal und Cloud gleich; Cloud-Token T0, Cloud-Revision 100 (bekannt, falls `known`). */
function baseline(known = true) {
  local = data({ shifts: shifts(2) });
  cloud.remote = { payload: data({ shifts: shifts(2) }), updated_at: T0 };
  rev.map.set("user-1", 100);
  setMeta({
    localChangedAt: null,
    localWorkChangedAt: null,
    lastSyncedAt: ms(T0) + 1000,
    remoteSeenAt: ms(T0),
    remoteToken: T0,
    ...(known ? { remoteRev: "100" } : {}),
  });
}
/** Lokal geändert (3 Schichten). */
function dirty() {
  baseline();
  local = data({ shifts: shifts(3) });
  setMeta({ ...readMeta(), localChangedAt: ms(T0) + 5000, localWorkChangedAt: ms(T0) + 5000 });
}
/** Älterer Client / direkter API-Aufruf: blinder Schreiber – die Datenbank vergibt eine neue Revision. */
function legacyWrite(payload: AppData, updatedAt: string | null) {
  cloud.remote = { payload, updated_at: updatedAt ?? (cloud.remote as Remote)!.updated_at };
  rev.counter += 1;
  rev.map.set("user-1", rev.counter);
}
async function started() {
  const mod = await load();
  mod.initCloudSync();
  await settle();
  cloud.writes = [];
  cloud.filters = [];
  return mod;
}

beforeEach(() => {
  cloud.remote = null;
  cloud.writes = [];
  cloud.filters = [];
  cloud.selectColumns = [];
  cloud.selectError = null;
  cloud.writeError = null;
  cloud.beforeWrite = null;
  cloud.writeGate = null;
  cloud.gated = 0;
  rev.enabled = true;
  rev.map.clear();
  rev.counter = 1000;
  replaced.length = 0;
  local = data();
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  window.localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("neues Schema: Revision wird gelesen, gespeichert und zum Filter", () => {
  it("Inspektion fragt rev an; ein manuelles Backup filtert auf user_id + rev (nicht auf updated_at) und speichert die neue Revision exakt", async () => {
    dirty();
    cloud.remote = { payload: data({ shifts: [...shifts(2), ...shifts(2, "c")] }), updated_at: T0 };
    const mod = await started();
    const result = await mod.backupNow();
    expect(result.status).toBe("done");
    expect(cloud.writes).toEqual(["update"]);
    expect(cloud.filters).toEqual(["update:rev"]);
    const meta = readMeta();
    expect(meta.remoteRev).toBe(String(rev.map.get("user-1")));
    expect(Number(meta.remoteRev)).toBeGreaterThan(100);
    expect(meta.remoteToken).toBe((cloud.remote as Remote)!.updated_at);
    expect(mod.getSyncState().dirty).toBe(false);
  });

  it("ohne Cloud-Zeile: einfaches Insert (kein Upsert); die vergebene Revision wird übernommen", async () => {
    local = data({ shifts: shifts(2) });
    cloud.remote = null;
    const mod = await started();
    expect((await mod.backupNow()).status).toBe("done");
    expect(cloud.writes).toEqual(["insert"]);
    expect(readMeta().remoteRev).toBe(String(rev.map.get("user-1")));
  });

  it("exakte Revisionswerte: eine große, aber sichere Revision bleibt Ziffer für Ziffer erhalten", async () => {
    dirty();
    rev.map.set("user-1", 1794901882456066);
    setMeta({ ...readMeta(), remoteRev: "1794901882456066" });
    const mod = await started();
    expect((await mod.backupNow()).status).toBe("done");
    expect(cloud.filters).toEqual(["update:rev"]);
    expect(readMeta().remoteRev).toBe(String(rev.map.get("user-1")));
  });

  it("Revision ändert sich nach dem Vergleich (älterer Client schreibt, Token gleich) → remote-changed, nichts geschrieben", async () => {
    dirty();
    const mod = await started();
    doubles.setAnswer(() => {
      legacyWrite(data({ shifts: shifts(9, "x") }), null); // gleicher updated_at!
      return true;
    });
    const result = await mod.backupNow();
    expect(result).toMatchObject({ status: "aborted", reason: "remote-changed" });
    expect(cloud.writes).toEqual([]);
    expect(mod.getSyncState().dirty).toBe(true);
  });

  it("Revision ändert sich zwischen Prüfung und Schreiben → 0 Zeilen → Konflikt, EIN Versuch, kein Wiederholen", async () => {
    dirty();
    const mod = await started();
    cloud.beforeWrite = () => legacyWrite(data({ shifts: shifts(9, "x") }), null);
    const result = await mod.backupNow();
    expect(result).toMatchObject({ status: "aborted", reason: "commit-failed" });
    expect((result as { error: Error }).error.name).toBe("CasStaleError");
    expect(cloud.writes).toEqual(["update"]);
    expect(mod.getSyncState().status).toBe("conflict");
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(cloud.writes).toEqual(["update"]);
  });

  it("Insert trifft eine inzwischen vorhandene Zeile (23505) → Konflikt, nichts überschrieben", async () => {
    local = data({ shifts: shifts(2) });
    cloud.remote = null;
    const mod = await started();
    cloud.writeError = { code: "23505", message: "duplicate key value violates unique constraint" };
    const result = await mod.backupNow();
    expect((result as { error: Error }).error.name).toBe("CasStaleError");
    expect(cloud.writes).toEqual(["insert"]);
    expect(mod.getSyncState().status).toBe("conflict");
  });
});

describe("Erkennen älterer Schreiber im automatischen Abgleich (Auto-Backup AN)", () => {
  it("Cloud-Revision gestiegen, Token gleich, lokal sauber → übernommen (kein stilles Verpassen), Zähler 'token-flat'", async () => {
    baseline();
    local = data({ shifts: shifts(2) }, true);
    const mod = await load();
    legacyWrite(data({ shifts: [...shifts(2), ...shifts(1, "n")] }, true), null);
    mod.initCloudSync();
    await settle();
    expect(local.shifts).toHaveLength(3);
    expect(readDiag().counts["remote-advanced-token-flat"]).toBe(1);
  });

  it("Cloud-Revision gestiegen, Token gleich, lokal GEÄNDERT → Konflikt (früher: Upload über fremde Änderung)", async () => {
    dirty();
    local = data({ shifts: shifts(3) }, true);
    const mod = await load();
    legacyWrite(data({ shifts: shifts(9, "x") }, true), null);
    mod.initCloudSync();
    await settle();
    expect(mod.getSyncState().status).toBe("conflict");
    expect(cloud.writes).toEqual([]);
  });

  it("Revision UND Token gestiegen (üblicher Schreiber) → Zähler 'remote-advanced'", async () => {
    baseline();
    local = data({ shifts: shifts(2) }, true);
    const mod = await load();
    legacyWrite(data({ shifts: shifts(5, "n") }, true), T1);
    mod.initCloudSync();
    await settle();
    expect(readDiag().counts["remote-advanced"]).toBe(1);
    expect(readDiag().counts["remote-advanced-token-flat"]).toBe(0);
  });

  it("dieselbe Revision wird je Seitenaufruf nur EINMAL gezählt (kein Log-Fluten)", async () => {
    dirty();
    local = data({ shifts: shifts(3) }, true);
    const mod = await load();
    legacyWrite(data({ shifts: shifts(9, "x") }, true), null);
    mod.initCloudSync();
    await settle();
    mod.retryPending();
    await settle();
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    const counts = readDiag().counts;
    expect(counts["remote-advanced"] + counts["remote-advanced-token-flat"]).toBe(1);
  });

  it("Diagnose enthält nur Zähler und Zeitpunkte – keine Nutzlast, PIN, Ids oder Texte", async () => {
    dirty();
    local = {
      ...data({ shifts: shifts(3) }, true),
      settings: { autoBackup: true, onboarded: true, pin: "4242", pinEnabled: true },
    } as AppData;
    const mod = await load();
    legacyWrite(data({ shifts: shifts(9, "x") }, true), null);
    mod.initCloudSync();
    await settle();
    const text = window.localStorage.getItem(DIAG_KEY)!;
    expect(text).not.toContain("4242");
    expect(text).not.toContain("user-1");
    expect(text).not.toContain("s0");
    const diag = JSON.parse(text);
    expect(Object.keys(diag).sort()).toEqual(["counts", "lastAt"]);
    for (const v of Object.values(diag.counts)) expect(typeof v).toBe("number");
  });
});

describe("altes Schema ohne rev: bestätigter Rückfall auf den updated_at-CAS", () => {
  it("erste Inspektion: 42703 mit rev in der Meldung → genau EINE Wiederholung ohne rev, danach nie mehr rev angefragt", async () => {
    dirty();
    rev.enabled = false;
    const selects: string[] = [];
    const mod = await started();
    const before = cloud.filters.length;
    expect((await mod.backupNow()).status).toBe("done");
    // Das manuelle Backup filtert auf updated_at (nicht auf rev) und es gab keinen rev-Versuch beim Schreiben.
    expect(cloud.filters.slice(before)).toEqual(["update:updated_at"]);
    expect(cloud.writes).toEqual(["update"]);
    expect(readDiag().counts["rev-fallback"]).toBe(1);
    expect(readMeta().remoteRev ?? null).toBeNull();
    void selects;
    // Weitere Vorgänge in derselben Sitzung versuchen rev nicht mehr (Zähler bleibt 1).
    cloud.writes = [];
    local = data({ shifts: shifts(5) });
    expect((await mod.backupNow()).status).toBe("done");
    expect(cloud.filters.filter((f) => f === "update:rev")).toEqual([]);
    expect(readDiag().counts["rev-fallback"]).toBe(1);
  });

  it("Insert auf dem alten Schema: einmal ohne rev wiederholt (der gescheiterte Versuch hat nichts geschrieben)", async () => {
    local = data({ shifts: shifts(2) });
    cloud.remote = null;
    rev.enabled = false;
    const mod = await started();
    expect((await mod.backupNow()).status).toBe("done");
    expect(cloud.writes).toEqual(["insert"]); // nur der erfolgreiche Versuch erreicht die Tabelle
    expect(readDiag().counts["rev-fallback"]).toBe(1);
  });

  it("nur BESTÄTIGTE rev-Fehler lösen den Rückfall aus: eine andere fehlende Spalte, 42501 und beliebige Fehler tun es nicht", async () => {
    dirty();
    const mod = await started();
    for (const error of [
      { code: "42703", message: "column backups.payload2 does not exist" },
      { code: "42501", message: "permission denied for table backups" },
      { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
      { code: "XX000", message: "something about revision but not the column" },
      { message: "Failed to fetch" },
    ]) {
      cloud.selectError = error;
      const result = await mod.backupNow();
      expect(result).toMatchObject({ status: "aborted", reason: "prepare-failed" });
    }
    expect(readDiag().counts?.["rev-fallback"] ?? 0).toBe(0);
    expect(cloud.writes).toEqual([]);
  });

  it("Schema verliert rev WÄHREND die App läuft (Rollback): ein Versuch, dann updated_at-CAS; veraltete Revision wird verworfen", async () => {
    dirty();
    const mod = await started();
    expect(readMeta().remoteRev ?? "100").toBeTruthy();
    rev.enabled = false; // Datenbank-Rollback
    const result = await mod.backupNow();
    expect(result.status).toBe("done");
    expect(cloud.filters).toEqual(["update:updated_at"]);
    expect(readMeta().remoteRev ?? null).toBeNull();
    expect(readDiag().counts["rev-fallback"]).toBe(1);
  });

  it("Wiedereinspielen der Migration nach einem Rollback: keine alte Revision, die einen falschen Konflikt erzeugt", async () => {
    dirty();
    const m1 = await started();
    rev.enabled = false;
    await m1.backupNow();
    // Migration erneut ausgeführt: höhere Revisionen; die App wird neu geladen.
    rev.enabled = true;
    rev.counter += 5000;
    rev.map.set("user-1", rev.counter);
    const m2 = await load();
    m2.initCloudSync();
    await settle();
    expect(m2.getSyncState().status).not.toBe("conflict");
    expect(readMeta().remoteRev).toBe(String(rev.map.get("user-1")));
  });

  it("Altschema + Auto-Backup AN: der automatische Abgleich bleibt bedingt (updated_at) und schreibt höchstens einmal", async () => {
    baseline(false);
    local = data({ shifts: shifts(3) }, true);
    rev.enabled = false;
    setMeta({ ...readMeta(), localChangedAt: ms(T0) + 5000, localWorkChangedAt: ms(T0) + 5000 });
    const mod = await load();
    mod.initCloudSync();
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(cloud.writes).toEqual(["update"]);
    expect(cloud.filters).toEqual(["update:updated_at"]);
    expect(mod.getSyncState().dirty).toBe(false);
  });
});

describe("unklares Ergebnis mit Revision", () => {
  async function timeoutWrite() {
    dirty();
    const mod = await started();
    cloud.writeGate = new Promise<void>(() => {});
    const pending = mod.backupNow();
    await untilReal(() => cloud.gated === 1);
    await vi.advanceTimersByTimeAsync(mod.SYNC_TIMEOUT_MS + 50);
    expect(await pending).toMatchObject({ status: "aborted", reason: "commit-failed" });
    const pw = readMeta().pendingWrite as { observedRev: string; attemptedToken: string };
    expect(pw.observedRev).toBe("100");
    cloud.writeGate = null;
    return pw;
  }

  it("Revision unverändert → nicht angekommen: Marke weg, kein automatischer Upload (Auto-Backup AUS)", async () => {
    await timeoutWrite();
    cloud.writes = [];
    const mod = await load();
    mod.initCloudSync();
    await settle();
    expect(readMeta().pendingWrite).toBeNull();
    expect(cloud.writes).toEqual([]);
    expect(mod.getSyncState().dirty).toBe(true);
  });

  it("Revision gestiegen, Token unverändert (anderer Schreiber) → Konflikt, nie 'nicht angekommen'", async () => {
    await timeoutWrite();
    cloud.writes = [];
    legacyWrite(data({ shifts: shifts(9, "x") }), null); // gleicher Token T0, neue Revision
    const mod = await load();
    mod.initCloudSync();
    await settle();
    expect(readMeta().pendingWrite).toBeNull();
    expect(mod.getSyncState().status).toBe("conflict");
    expect(cloud.writes).toEqual([]);
  });

  it("Token UND Inhalt stimmen (der Schreibvorgang kam doch an) → übernommen, Revision gespeichert", async () => {
    const pw = await timeoutWrite();
    cloud.writes = [];
    cloud.remote = { payload: { ...local, timer: null }, updated_at: pw.attemptedToken };
    rev.counter += 1;
    rev.map.set("user-1", rev.counter);
    const mod = await load();
    mod.initCloudSync();
    await settle();
    expect(readMeta().remoteRev).toBe(String(rev.map.get("user-1")));
    expect(mod.getSyncState().dirty).toBe(false);
    expect(cloud.writes).toEqual([]);
  });
});
