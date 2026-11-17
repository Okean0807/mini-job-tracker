/**
 * Data-safety Phase 3 – Snapshot-Modul (In-Memory-Double). Die echte IndexedDB wird zusätzlich
 * im Browser-Test geprüft (`scripts/browser/backup-safety.browser.mjs`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createSnapshot,
  deleteAllSnapshots,
  deleteSnapshot,
  getSnapshotFile,
  listSnapshots,
  mapIdbError,
  MAX_VERIFIED_PER_KIND,
  PENDING_TTL_MS,
  purgeScopeSnapshots,
  recoverPendingSnapshots,
  runPendingScopePurges,
  SnapshotError,
  createIndexedDbStorage,
  type PurgeMarkerStore,
  type SnapshotDeps,
  type SnapshotKind,
} from "./backup-safety";
import { createMemoryStorage, type MemoryStorage } from "./backup-safety.memory";
import { DEMO_SCOPE, GUEST_SCOPE, userScope } from "./storage-scope";
import type { AppData } from "./types";

const A = userScope("user-a");
const B = userScope("user-b");
const AB = userScope("user-a-b"); // Präfix-Falle zu "user-a"

function data(over: Record<string, unknown> = {}): AppData {
  return {
    shifts: [{ id: "s1", date: "2026-01-02" }],
    jobs: [{ id: "j1" }],
    customers: [],
    projects: [],
    payments: [],
    goals: [],
    orders: [],
    objects: [],
    settings: {
      onboarded: true,
      pin: "1234",
      pinEnabled: true,
      biometric: true,
      biometricCredentialId: "cred",
    },
    timer: null,
    ...over,
  } as unknown as AppData;
}

let backend: MemoryStorage;
let clock: number;
let seq: number;
let deps: SnapshotDeps;

beforeEach(() => {
  backend = createMemoryStorage();
  clock = 1_000;
  seq = 0;
  deps = { backend, now: () => (clock += 10), newId: () => `id${++seq}` };
});

const make = (kind: SnapshotKind = "local_pre_restore", scope = A, d: AppData = data()) =>
  createSnapshot({ kind, scope, data: d }, deps);

describe("Erstellen", () => {
  it("legt einen verifizierten Snapshot an (pending → verified) mit Zählwerten und SHA-256", async () => {
    const { summary, pruneFailed } = await make();
    expect(pruneFailed).toBe(false);
    expect(summary.counts.shifts).toBe(1);
    expect(summary.totalRecords).toBe(2);
    expect(summary.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.shiftDateRange).toEqual({ earliest: "2026-01-02", latest: "2026-01-02" });
    const stored = backend.records.get(summary.id)!;
    expect(stored.state).toBe("verified");
    expect(backend.calls.slice(0, 3)).toEqual(["put", "get", "markVerified"]);
  });

  it("Gerätesperre (PIN, Biometrie) ist nicht im Snapshot", async () => {
    const { summary } = await make();
    const text = backend.records.get(summary.id)!.payload;
    expect(text).not.toContain("1234");
    expect(text).not.toContain("cred");
    const settings = JSON.parse(text).settings;
    expect(settings.pin).toBeUndefined();
    expect(settings.biometricCredentialId).toBeUndefined();
    expect(settings.pinEnabled).toBe(false);
    expect(settings.biometric).toBe(false);
  });

  it("SHA-256 stimmt mit crypto.subtle überein", async () => {
    const { summary } = await make();
    const bytes = new TextEncoder().encode(backend.records.get(summary.id)!.payload);
    const hex = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(summary.sha256).toBe(hex);
  });

  it("SHA-256-Abweichung beim Zurücklesen → verification-failed, pending wird entfernt", async () => {
    const origGet = backend.get.bind(backend);
    backend.get = async (id) => {
      const r = await origGet(id);
      return r ? { ...r, payload: r.payload.replace("s1", "sX") } : r;
    };
    await expect(make()).rejects.toMatchObject({
      code: "verification-failed",
      reason: "sha256-mismatch",
    });
    expect(backend.records.size).toBe(0);
  });

  it("ungültige Nutzlast wird abgelehnt (nichts geschrieben)", async () => {
    await expect(
      make("local_pre_import", A, { shifts: "x", jobs: [] } as unknown as AppData),
    ).rejects.toMatchObject({
      code: "invalid-payload",
    });
    expect(backend.records.size).toBe(0);
    expect(backend.calls).not.toContain("put");
  });

  it("Manifest-Abweichung (Zählwerte) → verification-failed", async () => {
    const origGet = backend.get.bind(backend);
    backend.get = async (id) => {
      const r = await origGet(id);
      return r ? { ...r, counts: { ...r.counts, shifts: 5 } } : r;
    };
    await expect(make()).rejects.toMatchObject({
      code: "verification-failed",
      reason: "manifest-mismatch",
    });
    expect(backend.records.size).toBe(0);
  });

  it("Quota-Fehler beim Schreiben → typisierter Fehler, nichts bleibt zurück", async () => {
    backend.failNext("put", mapIdbError({ name: "QuotaExceededError" }));
    await expect(make()).rejects.toMatchObject({ code: "quota" });
    expect(backend.records.size).toBe(0);
  });

  it("Transaktionsabbruch → code aborted", async () => {
    backend.failNext("markVerified", mapIdbError({ name: "AbortError" }));
    await expect(make()).rejects.toMatchObject({ code: "aborted" });
    expect(backend.records.size).toBe(0);
  });

  it("IndexedDB nicht verfügbar → code unavailable, kein localStorage-Rückfall", async () => {
    const before = window.localStorage.length;
    const unavailable = createIndexedDbStorage(null);
    await expect(
      createSnapshot(
        { kind: "local_pre_restore", scope: A, data: data() },
        { backend: unavailable },
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(window.localStorage.length).toBe(before);
  });

  it("scheitert eine Verifikation, bleiben bereits verifizierte Snapshots unangetastet", async () => {
    const ok = await make();
    backend.failNext("get", new SnapshotError("io-error"));
    await expect(make()).rejects.toMatchObject({ code: "io-error" });
    expect([...backend.records.values()].map((r) => r.id)).toEqual([ok.summary.id]);
    expect(backend.records.get(ok.summary.id)!.state).toBe("verified");
  });

  it("Scope-Wechsel während des Schreibens → scope-changed, nichts bleibt", async () => {
    let current = true;
    const d: SnapshotDeps = { ...deps, isScopeCurrent: () => current };
    const origPut = backend.put.bind(backend);
    backend.put = async (r) => {
      await origPut(r);
      current = false;
    };
    await expect(
      createSnapshot({ kind: "local_pre_restore", scope: A, data: data() }, d),
    ).rejects.toMatchObject({
      code: "scope-changed",
    });
    expect(backend.records.size).toBe(0);
  });
});

describe("Aufräumen (Ring aus zwei)", () => {
  it("behält die zwei neuesten verifizierten je Art", async () => {
    for (let i = 0; i < 4; i++) await make("local_pre_restore");
    const list = await listSnapshots(A, deps);
    expect(list).toHaveLength(MAX_VERIFIED_PER_KIND);
    expect(list.map((s) => s.id)).toEqual(["id4", "id3"]);
  });

  it("Arten sind getrennt (drei Arten à zwei)", async () => {
    for (const kind of ["local_pre_restore", "cloud_pre_overwrite", "local_pre_import"] as const) {
      for (let i = 0; i < 3; i++) await make(kind);
    }
    const list = await listSnapshots(A, deps);
    expect(list).toHaveLength(6);
    for (const kind of ["local_pre_restore", "cloud_pre_overwrite", "local_pre_import"]) {
      expect(list.filter((s) => s.kind === kind)).toHaveLength(2);
    }
  });

  it("aufgeräumt wird erst NACH der Verifikation", async () => {
    await make();
    await make();
    const origGet = backend.get.bind(backend);
    backend.get = async (id) => {
      const r = await origGet(id);
      return r ? { ...r, payload: "{}" } : r;
    };
    await expect(make()).rejects.toBeInstanceOf(SnapshotError);
    expect(backend.records.size).toBe(2);
    expect(backend.calls).not.toContain("deleteMany");
  });

  it("Aufräumfehler: neuer Snapshot bleibt verifiziert, pruneFailed gesetzt, alte bleiben", async () => {
    await make();
    await make();
    backend.failNext("deleteMany", new SnapshotError("io-error"));
    const { summary, pruneFailed } = await make();
    expect(pruneFailed).toBe(true);
    expect(backend.records.get(summary.id)!.state).toBe("verified");
    expect(backend.records.size).toBe(3);
  });

  it("pending-Snapshots zählen nicht und werden nie als 'letzter verifizierter' gelöscht", async () => {
    const only = await make();
    backend.records.set("p1", {
      ...backend.records.get(only.summary.id)!,
      id: "p1",
      state: "pending",
    });
    await make();
    await make();
    expect((await listSnapshots(A, deps)).length).toBe(2);
    expect(backend.records.has("p1")).toBe(true);
  });
});

describe("Unterbrochene pending-Snapshots", () => {
  it("alte pending werden entfernt, frische und verifizierte bleiben", async () => {
    const ok = await make();
    const base = backend.records.get(ok.summary.id)!;
    backend.records.set("old", {
      ...base,
      id: "old",
      state: "pending",
      createdAt: clock - PENDING_TTL_MS - 1,
    });
    backend.records.set("fresh", { ...base, id: "fresh", state: "pending", createdAt: clock });
    const n = await recoverPendingSnapshots({ backend, now: () => clock });
    expect(n).toBe(1);
    expect(backend.records.has("old")).toBe(false);
    expect(backend.records.has("fresh")).toBe(true);
    expect(backend.records.get(ok.summary.id)!.state).toBe("verified");
  });

  it("pending werden nie aufgelistet oder heruntergeladen", async () => {
    const ok = await make();
    backend.records.set("p", { ...backend.records.get(ok.summary.id)!, id: "p", state: "pending" });
    expect((await listSnapshots(A, deps)).map((s) => s.id)).toEqual([ok.summary.id]);
    await expect(getSnapshotFile("p", A, deps)).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("Scope-Isolation", () => {
  it("jeder Scope sieht nur seine eigenen Snapshots (inkl. Präfix-Falle, Demo, Gast)", async () => {
    const a = await make("local_pre_restore", A);
    const b = await make("local_pre_restore", B);
    const ab = await make("local_pre_restore", AB);
    const g = await make("local_pre_restore", GUEST_SCOPE);
    const d = await make("local_pre_restore", DEMO_SCOPE);
    expect((await listSnapshots(A, deps)).map((s) => s.id)).toEqual([a.summary.id]);
    expect((await listSnapshots(B, deps)).map((s) => s.id)).toEqual([b.summary.id]);
    expect((await listSnapshots(AB, deps)).map((s) => s.id)).toEqual([ab.summary.id]);
    expect((await listSnapshots(GUEST_SCOPE, deps)).map((s) => s.id)).toEqual([g.summary.id]);
    expect((await listSnapshots(DEMO_SCOPE, deps)).map((s) => s.id)).toEqual([d.summary.id]);
  });

  it("Pruning in einem Scope berührt einen anderen nie", async () => {
    const b = await make("local_pre_restore", B);
    for (let i = 0; i < 4; i++) await make("local_pre_restore", A);
    expect((await listSnapshots(B, deps)).map((s) => s.id)).toEqual([b.summary.id]);
  });

  it("fremde Snapshots lassen sich weder herunterladen noch löschen (wie 'nicht vorhanden')", async () => {
    const b = await make("local_pre_restore", B);
    await expect(getSnapshotFile(b.summary.id, A, deps)).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(deleteSnapshot(b.summary.id, A, deps)).rejects.toMatchObject({
      code: "not-found",
    });
    expect(backend.records.has(b.summary.id)).toBe(true);
  });

  it("Liste enthält weder Scope noch Nutzlast", async () => {
    await make();
    const [s] = await listSnapshots(A, deps);
    expect(s).not.toHaveProperty("payload");
    expect(s).not.toHaveProperty("scope");
  });

  it("'alle löschen' trifft nur den aktiven Scope", async () => {
    await make("local_pre_restore", A);
    await make("local_pre_import", A);
    const ab = await make("local_pre_restore", AB);
    const b = await make("local_pre_restore", B);
    expect(await deleteAllSnapshots(A, deps)).toBe(2);
    expect(await listSnapshots(A, deps)).toEqual([]);
    expect((await listSnapshots(AB, deps)).map((s) => s.id)).toEqual([ab.summary.id]);
    expect((await listSnapshots(B, deps)).map((s) => s.id)).toEqual([b.summary.id]);
  });

  it("einzelnes Löschen entfernt genau einen Snapshot", async () => {
    const x = await make();
    const y = await make();
    await deleteSnapshot(x.summary.id, A, deps);
    expect((await listSnapshots(A, deps)).map((s) => s.id)).toEqual([y.summary.id]);
  });
});

describe("Download", () => {
  it("liefert die verifizierte Nutzlast ohne Gerätesperre", async () => {
    const { summary } = await make("cloud_pre_overwrite");
    const file = await getSnapshotFile(summary.id, A, deps);
    expect(file.filename).toMatch(/^minijob-snapshot-cloud_pre_overwrite-\d{4}-\d{2}-\d{2}\.json$/);
    expect(file.text).not.toContain("1234");
    expect(JSON.parse(file.text).shifts).toHaveLength(1);
    expect(file.bytes).toBe(new TextEncoder().encode(file.text).length);
  });

  it("beschädigte Nutzlast wird vor dem Download erkannt", async () => {
    const { summary } = await make();
    const r = backend.records.get(summary.id)!;
    backend.tamper(summary.id, { payload: r.payload.replace("s1", "sX") });
    await expect(getSnapshotFile(summary.id, A, deps)).rejects.toMatchObject({
      code: "verification-failed",
      reason: "sha256-mismatch",
    });
  });
});

function memoryMarkers(initial: string[] = []): PurgeMarkerStore & { value: string[] } {
  const m = {
    value: initial,
    read: () => [...m.value],
    write: (s: string[]) => {
      m.value = [...new Set(s)];
    },
  };
  return m;
}

describe("Konto-Löschung (lokal)", () => {
  it("löscht genau den Scope des gelöschten Kontos, setzt und entfernt den Marker", async () => {
    await make("local_pre_restore", A);
    const ab = await make("local_pre_restore", AB);
    const b = await make("local_pre_restore", B);
    const markers = memoryMarkers();
    await purgeScopeSnapshots(A, { backend }, markers);
    expect(await listSnapshots(A, deps)).toEqual([]);
    expect((await listSnapshots(AB, deps)).map((s) => s.id)).toEqual([ab.summary.id]);
    expect((await listSnapshots(B, deps)).map((s) => s.id)).toEqual([b.summary.id]);
    expect(markers.value).toEqual([]);
  });

  it("unterbrochene Bereinigung bleibt markiert und lässt sich wiederholen", async () => {
    await make("local_pre_restore", A);
    const b = await make("local_pre_restore", B);
    const markers = memoryMarkers();
    backend.failNext("deleteByScope", new SnapshotError("aborted"));
    await expect(purgeScopeSnapshots(A, { backend }, markers)).rejects.toMatchObject({
      code: "aborted",
    });
    expect(markers.value).toEqual(["u:user-a"]);
    expect((await listSnapshots(A, deps)).length).toBe(1);

    expect(await runPendingScopePurges({ backend }, markers)).toBe(1);
    expect(await listSnapshots(A, deps)).toEqual([]);
    expect(markers.value).toEqual([]);
    expect((await listSnapshots(B, deps)).map((s) => s.id)).toEqual([b.summary.id]);
  });

  it("fehlschlagender Wiederholungsversuch behält den Marker", async () => {
    await make("local_pre_restore", A);
    const markers = memoryMarkers(["u:user-a"]);
    backend.failAlways("deleteByScope", new SnapshotError("io-error"));
    expect(await runPendingScopePurges({ backend }, markers)).toBe(0);
    expect(markers.value).toEqual(["u:user-a"]);
  });

  it("Marker enthält nur Scope-Suffixe, keine Daten", async () => {
    const markers = memoryMarkers();
    backend.failNext("deleteByScope", new SnapshotError("aborted"));
    await purgeScopeSnapshots(A, { backend }, markers).catch(() => undefined);
    expect(JSON.stringify(markers.value)).toBe('["u:user-a"]');
  });
});

describe("Fehlerabbildung", () => {
  it("bildet DOMException-Namen auf Codes ab", () => {
    expect(mapIdbError({ name: "QuotaExceededError" }).code).toBe("quota");
    expect(mapIdbError({ name: "AbortError" }).code).toBe("aborted");
    expect(mapIdbError({ name: "SecurityError" }).code).toBe("unavailable");
    expect(mapIdbError(new Error("x")).code).toBe("io-error");
  });
  it("Fehlermeldungen enthalten keine Nutzdaten", async () => {
    backend.failNext(
      "put",
      mapIdbError({ name: "QuotaExceededError", message: "Anna Muster 12345" }),
    );
    const err = await make().then(
      () => null,
      (e: unknown) => e as SnapshotError,
    );
    expect(err?.message).toBe("quota");
  });
});

describe("Grenzen des Moduls (Quelltext-Verträge)", () => {
  const root = resolve(process.cwd(), "src/lib/minijob");
  const src = (f: string) => readFileSync(resolve(root, f), "utf8");

  it("kein Cloud-/Supabase-/Premium-/Store-Zugriff im Kernmodul", () => {
    const code = src("backup-safety.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const noKinds = code.replace(/cloud_pre_overwrite|stripDeviceAuthForCloud/g, "");
    expect(noKinds).not.toMatch(/supabase|cloud|premium|subscription|fetch\(|from "\.\/store"/i);
  });

  it("kein localStorage für Snapshot-Daten (nur der Bereinigungs-Marker)", () => {
    const code = src("backup-safety.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    const uses = code.match(/localStorage/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    // Nur in createLocalStoragePurgeMarkers.
    const start = code.indexOf("export function createLocalStoragePurgeMarkers");
    const end = code.indexOf("export async function purgeScopeSnapshots");
    const outside = code.slice(0, start) + code.slice(end);
    expect(outside).not.toMatch(/localStorage/);
  });

  it("keine Konsolenausgabe", () => {
    expect(src("backup-safety.ts")).not.toMatch(/console\./);
    expect(src("backup-safety-active.ts")).not.toMatch(/console\./);
  });

  it("keine Restore-/Ersetzen-Funktion exportiert", () => {
    const code = src("backup-safety.ts") + src("backup-safety-active.ts");
    expect(code).not.toMatch(/export (async )?function \w*(restore|replaceAll|applySnapshot)\w*/i);
    expect(code).not.toMatch(/replaceAll\(/);
  });

  it("Abmelden löscht keine Snapshots (Auth-/Sign-out-Pfade rufen das Modul nicht auf)", () => {
    for (const f of ["cloud.ts", "storage-scope.ts", "store.ts"]) {
      expect(src(f)).not.toMatch(/backup-safety/);
    }
  });

  it("Konto-Löschung räumt nur nach serverseitigem Erfolg auf", () => {
    const code = src("account-delete.ts");
    expect(code.indexOf('functions.invoke("delete-account"')).toBeLessThan(
      code.indexOf("await purgeScopeSnapshots"),
    );
    expect(code).toMatch(/purgeScopeSnapshots\(userScope\(userId\)/);
  });
});
