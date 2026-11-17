/**
 * Phase 5 – Audit der AUTOMATISCHEN Cloud→lokal-Übernahmen (`applyRemote` ohne Bestätigung):
 *   (1) Erst-Wiederherstellung auf einem nachweislich leeren Gerät,
 *   (2) automatischer Abgleich, wenn lokal seit dem letzten Abgleich nichts geändert wurde.
 *
 * Echter Store, gemocktes Supabase (CAS-Double). Zwei "Tabs" = zwei frische Modulinstanzen mit
 * demselben localStorage (so verhalten sich zwei Tabs desselben Browsers).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installGuardedDoubles } from "@/test-utils/guarded-doubles";

import type { AppData, Shift } from "./types";

type Row = { payload: unknown; updated_at: string };
const backups = new Map<string, Row>();
const writes: string[] = [];
let session: { user: { id: string } } | null = null;
/** Alle registrierten Auth-Callbacks (einer je "Tab"), in Registrierungsreihenfolge. */
const authCallbacks: ((event: string, s: unknown) => void)[] = [];
let selectGate: Promise<void> | null = null;

vi.mock("@/integrations/supabase/client", async () => {
  const { makeBackupsTable } = await import("@/test-utils/backups-double");
  return {
    supabase: {
      from: () =>
        makeBackupsTable({
          read: (uid) => backups.get(uid ?? "") ?? null,
          write: (uid, row) => {
            backups.set(uid, row);
          },
          onWrite: async (kind) => {
            writes.push(kind);
            return null;
          },
          onSelect: async () => {
            if (selectGate) await selectGate;
            return null;
          },
        }),
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
        onAuthStateChange: (cb: (event: string, s: unknown) => void) => {
          authCallbacks.push(cb);
          return { data: { subscription: { unsubscribe() {} } } };
        },
        signOut: async () => ({ error: null }),
      },
    },
  };
});
vi.mock("./notify", () => ({ markBackup: vi.fn() }));

const A = "user-a-uuid";
const B = "user-b-uuid";
const T = (n: number) => new Date(Date.UTC(2026, 10, 1, 10, 0, n)).toISOString();

function shift(id: string, date = "2026-09-01"): Shift {
  return {
    id,
    date,
    start: "09:00",
    end: "12:00",
    jobId: "j1",
    kind: "arbeit",
    breakMinutes: 0,
  } as Shift;
}
function payload(ids: string[], autoBackup = true): AppData {
  return {
    shifts: ids.map((i) => shift(i)),
    jobs: [{ id: "j1", name: "Job", color: "#000", mode: "flex" }],
    customers: [],
    projects: [],
    payments: [],
    goals: [],
    orders: [],
    objects: [],
    settings: { onboarded: true, wizardCompletedAt: 1, autoBackup },
    timer: null,
  } as unknown as AppData;
}
const dataKey = (id: string) => `minijob-tracker-v1:u:${id}`;
const metaKey = (id: string) => `minijob-sync-meta-v1:u:${id}`;
const storedShiftIds = (id: string): string[] =>
  (JSON.parse(window.localStorage.getItem(dataKey(id)) ?? "{}").shifts ?? []).map(
    (s: Shift) => s.id,
  );

async function settle() {
  for (let i = 0; i < 16; i += 1) await Promise.resolve();
}

/** Ein "Tab": frische Module, gleicher localStorage. */
async function openTab() {
  vi.resetModules();
  const doubles = await installGuardedDoubles();
  const store = await import("./store");
  const cloud = await import("./cloud");
  const scope = await import("./storage-scope");
  store.loadFromStorage();
  const before = authCallbacks.length;
  cloud.initCloudSync();
  await settle();
  return { store, cloud, scope, doubles, authCallback: authCallbacks[before]! };
}

beforeEach(() => {
  backups.clear();
  writes.length = 0;
  authCallbacks.length = 0;
  selectGate = null;
  session = { user: { id: A } };
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const k = window.localStorage.key(i);
    if (k?.startsWith("minijob-")) window.localStorage.removeItem(k);
  }
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

/** Cloud hält `ids`; dieses Gerät hat sie bereits abgeglichen (Basis = Cloud-Token). */
async function syncedDevice(ids: string[]) {
  backups.set(A, { payload: payload(ids), updated_at: T(1) });
  const tab = await openTab();
  await vi.advanceTimersByTimeAsync(100);
  await settle();
  expect(
    tab.store
      .getData()
      .shifts.map((s) => s.id)
      .sort(),
  ).toEqual([...ids].sort());
  expect(tab.cloud.getSyncState().dirty).toBe(false);
  writes.length = 0;
  return tab;
}

/** Löst bei einem "Tab" einen frischen Abgleich aus (wie ein erneutes SIGNED_IN). */
async function resync(tab: Awaited<ReturnType<typeof openTab>>) {
  tab.authCallback("SIGNED_IN", session);
  await settle();
  await vi.advanceTimersByTimeAsync(100);
  await settle();
}

/* ======================================================= (2) lokal unverändert → Übernahme */

describe("Pfad 2: automatische Übernahme nur bei wirklich unverändertem lokalem Stand", () => {
  it("Normalfall: Cloud neuer, lokal unverändert → übernommen (Funktion bleibt erhalten)", async () => {
    const tab = await syncedDevice(["s1"]);
    backups.set(A, { payload: payload(["s1", "s2"]), updated_at: T(5) });
    await resync(tab);
    expect(
      tab.store
        .getData()
        .shifts.map((s) => s.id)
        .sort(),
    ).toEqual(["s1", "s2"]);
    expect(writes).toEqual([]);
    expect(tab.cloud.getSyncState().dirty).toBe(false);
  });

  it("lokale Änderung WÄHREND des Cloud-Lesens → kein stilles Überschreiben (Konflikt, Änderung bleibt)", async () => {
    const tab = await syncedDevice(["s1"]);
    backups.set(A, { payload: payload(["s1", "x9"]), updated_at: T(5) });
    let release!: () => void;
    selectGate = new Promise<void>((r) => (release = r));
    tab.authCallback("SIGNED_IN", session);
    await settle();
    tab.store.saveShift(shift("mine"));
    release();
    selectGate = null;
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(tab.store.getData().shifts.map((s) => s.id)).toContain("mine");
    expect(storedShiftIds(A)).toContain("mine");
    expect(tab.cloud.getSyncState().status).toBe("conflict");
  });

  it("Konto wechselt während des Cloud-Lesens → nichts in den neuen Scope, kein Schreiben", async () => {
    const tab = await syncedDevice(["s1"]);
    backups.set(A, { payload: payload(["s1", "a-new"]), updated_at: T(5) });
    backups.set(B, { payload: payload(["b-cloud"]), updated_at: T(2) });
    let release!: () => void;
    selectGate = new Promise<void>((r) => (release = r));
    tab.authCallback("SIGNED_IN", session);
    await settle();
    tab.authCallback("SIGNED_OUT", null);
    session = { user: { id: B } };
    tab.authCallback("SIGNED_IN", session);
    await settle();
    selectGate = null;
    release();
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(tab.store.getActiveScopeOwner()).toBe(B);
    expect(tab.store.getData().shifts.map((s) => s.id)).not.toContain("a-new");
    expect(storedShiftIds(B)).not.toContain("a-new");
    expect(writes).toEqual([]);
  });

  it("[ZWEITER TAB] ungesicherte Änderung in einem anderen Tab darf nicht überschrieben werden", async () => {
    const tabA = await syncedDevice(["s1"]);
    const tabB = await openTab(); // gleicher Account, gleicher localStorage
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    tabB.store.saveShift(shift("b-unsynced")); // Tab B: Änderung, Cloud noch nicht informiert
    expect(storedShiftIds(A)).toContain("b-unsynced");
    // Ein anderes Gerät ändert inzwischen die Cloud.
    backups.set(A, { payload: payload(["s1", "other-device"]), updated_at: T(9) });
    await resync(tabA); // Tab A weiß nichts von Tab Bs Änderung

    // Invariante: Tab Bs ungesicherte Schicht ist im Speicher NICHT verloren gegangen.
    expect(storedShiftIds(A)).toContain("b-unsynced");
    expect(writes).toEqual([]);
  });

  it("[ZWEITER TAB] storage-Ereignis: Tab A übernimmt den Stand und die Änderungsmarken von Tab B", async () => {
    const tabA = await syncedDevice(["s1"]);
    const tabB = await openTab();
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    tabB.store.saveShift(shift("b-unsynced"));
    // Der Browser meldet Tab A die Schreibzugriffe von Tab B.
    for (const key of [dataKey(A), metaKey(A)]) {
      window.dispatchEvent(
        new StorageEvent("storage", { key, newValue: window.localStorage.getItem(key) }),
      );
    }
    await settle();
    expect(tabA.store.getData().shifts.map((s) => s.id)).toContain("b-unsynced");
    expect(tabA.cloud.getSyncState().dirty).toBe(true);
  });

  it("[ZWEITER TAB] ein Tab ohne Marken-Wissen (veraltet) lädt nie automatisch über fremde Änderungen (Speicher ≠ Arbeitsspeicher)", async () => {
    const tabA = await syncedDevice(["s1"]);
    // Ein anderer Schreiber ändert nur die Daten im Speicher (kein Ereignis zugestellt).
    const stored = JSON.parse(window.localStorage.getItem(dataKey(A))!);
    stored.shifts.push(shift("foreign-write"));
    window.localStorage.setItem(dataKey(A), JSON.stringify(stored));
    backups.set(A, { payload: payload(["s1", "other-device"]), updated_at: T(9) });
    await resync(tabA);
    expect(storedShiftIds(A)).toContain("foreign-write");
  });
});

/* ===================================================== Rückschritt des Cloud-Tokens */

describe("Pfad 2: ein Cloud-Stand mit ÄLTEREM Token als der zuletzt gesehene wird nicht automatisch übernommen", () => {
  it("Rollback der Cloud (z. B. Datenbank-Wiederherstellung): lokal neueres Wissen bleibt, Nutzer entscheidet", async () => {
    const tab = await syncedDevice(["s1", "s2", "s3"]); // Basis-Token T(1)
    // Dieses Gerät hat später selbst gesichert (Token wächst) und ist sauber.
    tab.store.saveShift(shift("s4"));
    await vi.advanceTimersByTimeAsync(3000);
    await settle();
    expect(tab.cloud.getSyncState().dirty).toBe(false);
    const known = backups.get(A)!;
    expect(new Date(known.updated_at).getTime()).toBeGreaterThan(new Date(T(1)).getTime());
    // Die Cloud wird auf einen ÄLTEREN Stand zurückgesetzt (Token früher als der bekannte).
    backups.set(A, { payload: payload(["s1"]), updated_at: T(0) });
    writes.length = 0;
    await resync(tab);
    // Der neuere lokale Stand darf nicht still durch den älteren ersetzt werden.
    expect(
      tab.store
        .getData()
        .shifts.map((s) => s.id)
        .sort(),
    ).toEqual(["s1", "s2", "s3", "s4"]);
    expect(storedShiftIds(A).sort()).toEqual(["s1", "s2", "s3", "s4"]);
    expect(tab.cloud.getSyncState().remoteAhead).toBe(true);
    expect(writes).toEqual([]);
  });

  it("nicht rückläufig: normaler Fortschritt der Cloud wird weiterhin automatisch übernommen", async () => {
    const tab = await syncedDevice(["s1"]);
    backups.set(A, { payload: payload(["s1", "s2"]), updated_at: T(30) });
    await resync(tab);
    expect(tab.store.getData().shifts).toHaveLength(2);
  });
});

/* ===================================================== (1) Erst-Wiederherstellung (leer) */

describe("Pfad 1: Erst-Wiederherstellung nur auf nachweislich leerem Gerät und nur im selben Konto", () => {
  it("leeres Gerät: Cloud wird übernommen", async () => {
    backups.set(A, { payload: payload(["c1", "c2"]), updated_at: T(1) });
    const tab = await openTab();
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(
      tab.store
        .getData()
        .shifts.map((s) => s.id)
        .sort(),
    ).toEqual(["c1", "c2"]);
  });

  it("Daten entstehen WÄHREND des Cloud-Lesens → nicht mehr leer → kein Überschreiben", async () => {
    backups.set(A, { payload: payload(["c1"]), updated_at: T(1) });
    let release!: () => void;
    selectGate = new Promise<void>((r) => (release = r));
    vi.resetModules();
    await installGuardedDoubles();
    const store = await import("./store");
    const cloud = await import("./cloud");
    store.loadFromStorage();
    cloud.initCloudSync();
    await settle();
    store.saveShift(shift("typed-meanwhile"));
    selectGate = null;
    release();
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(store.getData().shifts.map((s) => s.id)).toContain("typed-meanwhile");
    expect(storedShiftIds(A)).toContain("typed-meanwhile");
  });

  it("Konto wechselt während des Cloud-Lesens: kein Übernehmen in den neuen Scope", async () => {
    backups.set(A, { payload: payload(["a-cloud"]), updated_at: T(1) });
    let release!: () => void;
    selectGate = new Promise<void>((r) => (release = r));
    vi.resetModules();
    await installGuardedDoubles();
    const store = await import("./store");
    const cloud = await import("./cloud");
    store.loadFromStorage();
    const before = authCallbacks.length;
    cloud.initCloudSync();
    await settle();
    const cb = authCallbacks[before]!;
    cb("SIGNED_OUT", null);
    session = { user: { id: B } };
    selectGate = null;
    cb("SIGNED_IN", session);
    release();
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(store.getData().shifts.map((s) => s.id)).not.toContain("a-cloud");
    expect(storedShiftIds(B)).not.toContain("a-cloud");
  });
});
