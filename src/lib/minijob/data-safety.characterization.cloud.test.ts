/**
 * TEMPORARY CHARACTERIZATION TESTS (Data-safety Phase 1).
 *
 * Diese Tests halten das HEUTIGE, nachweislich unsichere Verhalten von `cloud.ts` fest – sie
 * erklären es nicht für richtig. Jeder Test nennt das erwartete sichere Verhalten
 * ("EXPECTED SECURE BEHAVIOUR"). Sobald die Phasen 2–4 die Lücken schließen, werden diese Tests
 * bewusst ausfallen und müssen durch die Sicherheits-Tests der jeweiligen Phase ersetzt (nicht
 * einfach angepasst) werden. Kein bestehender Test wurde dafür verändert.
 *
 * Verifiziert (Phase 0): blindes Überschreiben durch `backupNow`, Restore-Entscheidung nur auf
 * Schichten/Jobs, Auto-Backup AUS verhindert nicht jeden automatischen Upload, "leeres Gerät"
 * schaut nur auf Schichten.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fullFingerprint, isUserDataEmpty } from "./backup-compare";
import type { AppData } from "./types";

type Remote = { payload: unknown; updated_at: string } | null;

const cloud = {
  remote: null as Remote,
  /** Reihenfolge der Tabellenzugriffe ("select" = Lesen, "upsert" = Schreiben). */
  calls: [] as string[],
};

let session: { user: { id: string } } | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: async (row: { payload: unknown; updated_at: string }) => {
        cloud.calls.push("upsert");
        cloud.remote = { payload: row.payload, updated_at: row.updated_at };
        return { error: null };
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            cloud.calls.push("select");
            return { data: cloud.remote, error: null };
          },
        }),
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));

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

async function loadModule() {
  vi.resetModules();
  return await import("./cloud");
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  cloud.remote = null;
  cloud.calls = [];
  replaced.length = 0;
  session = { user: { id: "user-1" } };
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TEMPORARY CHARACTERIZATION: blindes Überschreiben (backupNow)", () => {
  it("backupNow schreibt ohne vorheriges Lesen und ersetzt eine neuere Cloud-Kopie", async () => {
    local = data({ shifts: shifts(2) });
    cloud.remote = { payload: data({ shifts: shifts(9) }), updated_at: new Date().toISOString() };
    window.localStorage.setItem(
      META_KEY,
      JSON.stringify({
        userId: "user-1",
        localChangedAt: Date.now(),
        lastSyncedAt: null,
        remoteSeenAt: null,
      }),
    );
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();
    expect(mod.getSyncState().status).toBe("conflict"); // der automatische Abgleich schützt noch
    cloud.calls.length = 0;

    await mod.backupNow(); // der manuelle Knopf "Sichern" im Konfliktfall

    // CURRENT: kein Lesezugriff, nur der Schreibzugriff – keine Vergleichs- oder Versionsprüfung.
    expect(cloud.calls).toEqual(["upsert"]);
    // CURRENT: die 9 Schichten der Cloud sind durch die 2 lokalen ersetzt.
    expect((cloud.remote?.payload as AppData).shifts).toHaveLength(2);
    // EXPECTED SECURE BEHAVIOUR: prepare (lesen + vergleichen) → Bestätigung mit Anzeige der
    // 9 nur-Cloud-Datensätze → Snapshot der Cloud-Kopie → bedingter Schreibzugriff (CAS).
  });
});

describe("TEMPORARY CHARACTERIZATION: Restore ignoriert Nicht-Schicht-Sammlungen", () => {
  it("lokale Zahlung/Ziel/Objekt gehen bei neuerer Cloud ohne Konflikt verloren", async () => {
    const localOnly = {
      payments: [{ id: "pay-lokal", jobId: "j", year: 2026, month: 9, actual: 5 }],
      goals: [{ id: "g-lokal", name: "Ziel", target: 10, kind: "manual" }],
      objects: [{ id: "o-lokal", name: "Objekt" }],
    };
    local = data({ shifts: shifts(1), ...localOnly });
    cloud.remote = {
      payload: data({ shifts: shifts(1) }), // gleiche Schichten, aber ohne Zahlung/Ziel/Objekt
      updated_at: new Date(300_000).toISOString(),
    };
    window.localStorage.setItem(
      META_KEY,
      JSON.stringify({
        userId: "user-1",
        localChangedAt: 200_000,
        localWorkChangedAt: null,
        lastSyncedAt: 100_000,
        remoteSeenAt: 100_000,
      }),
    );
    const mod = await loadModule();
    const before = local;
    mod.initCloudSync();
    await settle();

    // CURRENT: Schicht-/Job-Prüfsumme gleich, obwohl sich die Datensätze unterscheiden.
    expect(mod.workFingerprint(before)).toBe(mod.workFingerprint(cloud.remote.payload as AppData));
    expect(fullFingerprint(before as never)).not.toBe(
      fullFingerprint(cloud.remote.payload as never),
    );
    // CURRENT: "restore" – lokale Nicht-Schicht-Daten werden still überschrieben, kein Konflikt.
    expect(mod.getSyncState().status).toBe("synced");
    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.payments).toHaveLength(0);
    expect(replaced[0]!.goals).toHaveLength(0);
    expect(replaced[0]!.objects).toHaveLength(0);
    // EXPECTED SECURE BEHAVIOUR: lokale Zahlungen/Ziele/Objekte zählen als Daten → Konflikt, Dialog
    // mit Anzeige der nur-lokalen Datensätze, Snapshot, keine stille Überschreibung.
  });
});

describe("TEMPORARY CHARACTERIZATION: 'leeres Gerät' schaut nur auf Schichten", () => {
  it("Gerät mit Zahlungen/Zielen/Objekten/Kunden, aber ohne Schichten und Jobs, wird wiederhergestellt", async () => {
    local = data({
      payments: [{ id: "pay-lokal", jobId: "j", year: 2026, month: 9, actual: 5 }],
      goals: [{ id: "g-lokal", name: "Ziel", target: 10, kind: "manual" }],
      objects: [{ id: "o-lokal", name: "Objekt" }],
      customers: [{ id: "c-lokal", name: "Kunde" }],
    });
    // CONTRAST: nach dem neuen Maßstab ist dieses Gerät NICHT leer.
    expect(isUserDataEmpty(local as never)).toBe(false);
    cloud.remote = { payload: data({ shifts: shifts(3) }), updated_at: new Date().toISOString() };

    const mod = await loadModule();
    mod.initCloudSync();
    await settle();

    // CURRENT: first-sync-restore, weil `hasLocalWorkData` (nur Schichten) false ist.
    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.shifts).toHaveLength(3);
    expect(local.payments).toHaveLength(0);
    expect(local.goals).toHaveLength(0);
    expect(local.objects).toHaveLength(0);
    expect(local.customers).toHaveLength(0);
    // EXPECTED SECURE BEHAVIOUR: automatische Wiederherstellung nur bei `isUserDataEmpty` (alle
    // acht Sammlungen nachweislich leer); sonst geführter Dialog mit Snapshot.
  });
});

describe("TEMPORARY CHARACTERIZATION: Auto-Backup AUS verhindert nicht jeden automatischen Upload", () => {
  it("Start ohne Cloud-Stand lädt trotz autoBackup=false hoch", async () => {
    local = data({ shifts: shifts(1) }, false);
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();

    expect(local.settings.autoBackup).toBe(false);
    // CURRENT: ungegateter Start-Abgleich → Upload.
    expect(cloud.calls).toContain("upsert");
    // EXPECTED SECURE BEHAVIOUR: autoBackup=false = absolut kein automatischer Upload
    // (inspect-only: nur lesen, Status anzeigen).
  });

  it("Start mit unveränderter Cloud und lokalen Änderungen lädt trotz autoBackup=false hoch", async () => {
    local = data({ shifts: shifts(2) }, false);
    cloud.remote = {
      payload: data({ shifts: shifts(1) }),
      updated_at: new Date(1_000_000).toISOString(),
    };
    window.localStorage.setItem(
      META_KEY,
      JSON.stringify({
        userId: "user-1",
        localChangedAt: 2_000_000,
        localWorkChangedAt: 2_000_000,
        lastSyncedAt: 1_000_000,
        remoteSeenAt: 1_000_000,
      }),
    );
    const mod = await loadModule();
    mod.initCloudSync();
    await settle();

    // CURRENT: Entscheidung "push" – unabhängig vom Schalter.
    expect(cloud.calls.filter((c) => c === "upsert")).toHaveLength(1);
    expect((cloud.remote?.payload as AppData).shifts).toHaveLength(2);
    // EXPECTED SECURE BEHAVIOUR: kein Upload; Status "dirty-autobackup-off" sichtbar.
  });
});
