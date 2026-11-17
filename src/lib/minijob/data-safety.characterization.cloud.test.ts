/**
 * Phase 4 – `backupNow` im Konfliktfall: lesen, vergleichen, bestätigen, Cloud-Kopie sichern,
 * bedingt schreiben. Ersetzt die Phase-1-Charakterisierung des blinden Überschreibens
 * (alle früheren Lücken sind seit Phase 2–4 geschlossen und durch eigene Tests abgedeckt).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppData } from "./types";
import { installGuardedDoubles, type GuardedDoubles } from "@/test-utils/guarded-doubles";

type Remote = { payload: unknown; updated_at: string } | null;

const cloud = {
  remote: null as Remote,
  /** Reihenfolge der Tabellenzugriffe ("select" = Lesen, "upsert" = Schreiben). */
  calls: [] as string[],
};

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
          onUpsert: () => cloud.calls.push("upsert"),
          onWrite: async (kind) => {
            cloud.calls.push(kind);
            return null;
          },
          onSelect: async () => {
            cloud.calls.push("select");
            return null;
          },
        }),
      auth: {
        getSession: async () => ({ data: { session } }),
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

let doubles: GuardedDoubles;

async function loadModule() {
  vi.resetModules();
  doubles = await installGuardedDoubles();
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

describe("Phase 4: backupNow im Konfliktfall (vorher: blindes Überschreiben)", () => {
  async function conflict() {
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
    expect(mod.getSyncState().status).toBe("conflict"); // der automatische Abgleich schützt
    cloud.calls.length = 0;
    return mod;
  }

  it("liest zuerst, zeigt die nur in der Cloud vorhandenen Datensätze, sichert die Cloud-Kopie, schreibt dann bedingt", async () => {
    const mod = await conflict();

    const result = await mod.backupNow(); // der manuelle Knopf im Konfliktfall

    expect(result.status).toBe("done");
    // Lesen (Inspektion) VOR dem Schreiben, erneute Prüfung des Tokens, bedingter Schreibzugriff.
    expect(cloud.calls[0]).toBe("select");
    expect(cloud.calls.filter((c) => c === "update")).toHaveLength(1);
    expect(cloud.calls).not.toContain("upsert");
    expect(cloud.calls.lastIndexOf("select")).toBeLessThan(cloud.calls.indexOf("update"));
    // Dem Nutzer wurden die 7 nur-Cloud-Schichten (9 in der Cloud, 2 gemeinsame) als VERLUST gezeigt.
    const preview = doubles.previews[0]!;
    expect(preview.replaces).toBe("cloud");
    expect(preview.collections.find((c) => c.name === "shifts")!.lost).toBe(7);
    // Vorher wurde die Cloud-Kopie verifiziert gesichert.
    const snap = [...doubles.storage.records.values()];
    expect(snap).toHaveLength(1);
    expect(snap[0]!.kind).toBe("cloud_pre_overwrite");
    expect(snap[0]!.counts.shifts).toBe(9);
    expect((cloud.remote?.payload as AppData).shifts).toHaveLength(2);
  });

  it("ohne Bestätigung wird weder gesichert noch geschrieben", async () => {
    const mod = await conflict();
    doubles.setAnswer(false);

    const result = await mod.backupNow();

    expect(result.status).toBe("cancelled");
    expect(cloud.calls).not.toContain("update");
    expect((cloud.remote?.payload as AppData).shifts).toHaveLength(9);
    expect(doubles.storage.records.size).toBe(0);
  });
});
