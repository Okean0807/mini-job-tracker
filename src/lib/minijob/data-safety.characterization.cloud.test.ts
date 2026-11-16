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
 *
 * STATUS NACH PHASE 2: Behoben und durch Tests in `cloud.data-safety.test.ts` ersetzt sind
 * (a) die Restore-Entscheidung ohne Nicht-Schicht-Sammlungen, (b) Auto-Backup AUS mit
 * automatischem Upload, (c) die Schichten-only-Leer-Prüfung. Die entsprechenden
 * Charakterisierungs-Tests wurden entfernt. NOCH OFFEN (bleibt hier dokumentiert, bis Phase 4
 * den geführten Ablauf mit bedingtem Schreiben liefert): das blinde Überschreiben durch
 * `backupNow`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
