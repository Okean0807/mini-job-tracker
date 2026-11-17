/**
 * Phase 5 – Absturz-/Unterbrechungs-Konsistenz der geschützten lokalen Ersetzung (JSON-Import) mit
 * dem ECHTEN Store und demselben localStorage über einen simulierten Neustart.
 *
 * "Absturz" = die Stufe kehrt nie zurück (`new Promise(() => {})`), der Lauf wird verlassen, alle
 * Module werden verworfen und frisch geladen (`vi.resetModules()`); localStorage und die
 * Snapshot-Ablage (steht für IndexedDB) bleiben bestehen.
 *
 * Es wird KEINE Atomarität über mehrere Speicherschlüssel behauptet: ein Schlüssel (`setItem`) ist
 * alles-oder-nichts, Daten und Sync-Metadaten sind zwei Schlüssel (siehe Reihenfolge-Test).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStorage, type MemoryStorage } from "./backup-safety.memory";
import type { GuardedPorts } from "./guarded-operation";
import type { AppData } from "./types";

const OLD_PIN = "4321";
const FILE_PIN = "8765";
const hang = () => new Promise<never>(() => {});

function fileJson(): string {
  return JSON.stringify({
    shifts: [
      {
        id: "file-s1",
        kind: "arbeit",
        date: "2026-09-16",
        start: "08:00",
        end: "12:00",
        breakMinutes: 0,
        jobId: "fj",
      },
    ],
    jobs: [{ id: "fj", name: "Datei", color: "#222", mode: "flex" }],
    settings: { onboarded: true, pin: FILE_PIN, pinEnabled: true },
  });
}

let shared: MemoryStorage; // steht für IndexedDB: überlebt den "Neustart"
const KEY = "minijob-tracker-v1:demo";

/** Frische Modulinstanz (= Neustart): gleicher localStorage, gleiche Snapshot-Ablage. */
async function boot() {
  vi.resetModules();
  const store = await import("./store");
  const safety = await import("./backup-safety");
  const confirm = await import("./guarded-confirm");
  const local = await import("./guarded-local");
  const ports = await import("./guarded-ports");
  const op = await import("./guarded-operation");
  const scope = await import("./storage-scope");
  safety.setDefaultSnapshotStorageForTests(shared);
  confirm.setConfirmationHandlerForTests(async () => true);
  store.loadFromStorage();
  store.activateScope(scope.DEMO_SCOPE);
  return { store, safety, confirm, local, ports, op, scope };
}
type Tab = Awaited<ReturnType<typeof boot>>;

const stored = (): AppData => JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as AppData;
const storedIds = () => (stored().shifts ?? []).map((s) => s.id);

async function seedOldState(tab: Tab) {
  tab.store.replaceAll({ shifts: [], jobs: [] });
  tab.store.updateSettings({ pin: OLD_PIN, pinEnabled: true });
  tab.store.saveJob({ id: "j", name: "Alt", color: "#111", mode: "flex" });
  tab.store.saveShift({
    id: "old-1",
    kind: "arbeit",
    date: "2026-01-05",
    start: "09:00",
    end: "10:00",
    breakMinutes: 0,
    jobId: "j",
  } as never);
  // ein bereits vorhandener, verifizierter Wiederherstellungspunkt desselben Scopes
  const { summary } = await tab.safety.createSnapshot(
    { kind: "cloud_pre_overwrite", scope: tab.scope.DEMO_SCOPE, data: tab.store.getData() },
    { backend: shared },
  );
  return summary.id;
}

/** Startet den Import mit überschriebenen Ports (für die Absturzstelle). */
function startImport(tab: Tab, override: Partial<GuardedPorts>) {
  const ports: GuardedPorts = { ...tab.ports.createActivePorts(), ...override };
  return tab.op.runGuardedOperation(
    tab.local.localReplaceOperation({
      kind: "local-import",
      snapshotKind: "local_pre_import",
      load: async () => ({ raw: JSON.parse(fileJson()) as unknown }),
    }),
    ports,
  );
}

/** Invarianten nach jedem Neustart. */
async function expectConsistentAfterReboot(opts: {
  seededId: string;
  expect: "old" | "new" | "either";
}) {
  const tab = await boot();
  const ids = storedIds();
  // Kein gemischter Stand: entweder genau der alte oder genau der neue.
  const isOld = JSON.stringify(ids) === JSON.stringify(["old-1"]);
  const isNew = JSON.stringify(ids) === JSON.stringify(["file-s1"]);
  expect(isOld || isNew).toBe(true);
  if (opts.expect === "old") expect(isOld).toBe(true);
  if (opts.expect === "new") expect(isNew).toBe(true);
  // Die Gerätesperre wurde nie ersetzt (die PIN der Datei erscheint nirgends).
  expect(stored().settings?.pin).toBe(OLD_PIN);
  expect(JSON.stringify(tab.store.getData())).not.toContain(FILE_PIN);
  // Der zuvor vorhandene verifizierte Snapshot ist unverändert wiederherstellbar.
  const list = await tab.safety.listSnapshots(tab.scope.DEMO_SCOPE, { backend: shared });
  expect(list.map((s) => s.id)).toContain(opts.seededId);
  const file = await tab.safety.getSnapshotFile(opts.seededId, tab.scope.DEMO_SCOPE, {
    backend: shared,
  });
  expect(JSON.parse(file.text).shifts.map((s: { id: string }) => s.id)).toEqual(["old-1"]);
  // Kein anderer Scope sieht irgendetwas davon.
  expect(
    await tab.safety.listSnapshots(tab.scope.userScope("someone-else"), { backend: shared }),
  ).toEqual([]);
  expect(await tab.safety.listSnapshots(tab.scope.GUEST_SCOPE, { backend: shared })).toEqual([]);
  // Unterbrochene pending-Snapshots werden nach der Frist entfernt, verifizierte nie.
  await tab.safety.recoverPendingSnapshots({
    backend: shared,
    now: () => Date.now() + 11 * 60 * 1000,
  });
  const after = [...shared.records.values()];
  expect(after.some((r) => r.state === "pending")).toBe(false);
  expect(after.find((r) => r.id === opts.seededId)?.state).toBe("verified");
  return tab;
}

beforeEach(() => {
  window.localStorage.clear();
  shared = createMemoryStorage();
});
afterEach(() => vi.useRealTimers());

describe("Absturz an jeder kritischen Stelle des Imports", () => {
  it("vor dem Snapshot (während der Vorbereitung) → alter Stand, nichts angelegt", async () => {
    const tab = await boot();
    const seeded = await seedOldState(tab);
    void tab.op.runGuardedOperation(
      { kind: "local-import", prepare: hang, commit: () => undefined } as never,
      tab.ports.createActivePorts(),
    );
    await Promise.resolve();
    await expectConsistentAfterReboot({ seededId: seeded, expect: "old" });
    expect(shared.records.size).toBe(1);
  });

  it("während der Bestätigung → alter Stand, kein neuer Snapshot", async () => {
    const tab = await boot();
    const seeded = await seedOldState(tab);
    void startImport(tab, { confirm: hang });
    await vi.waitFor(() => expect(shared.records.size).toBe(1));
    await expectConsistentAfterReboot({ seededId: seeded, expect: "old" });
    expect(shared.records.size).toBe(1);
  });

  it("während der Snapshot-Erstellung (pending geschrieben, nie verifiziert) → alter Stand; pending wird bereinigt, der alte Snapshot bleibt", async () => {
    const tab = await boot();
    const seeded = await seedOldState(tab);
    const realGet = shared.get.bind(shared);
    let first = true;
    shared.get = async (id) => {
      if (id !== seeded && first) {
        first = false;
        return hang(); // Rücklesen der Verifikation kehrt nie zurück
      }
      return realGet(id);
    };
    void startImport(tab, {});
    await vi.waitFor(() =>
      expect([...shared.records.values()].some((r) => r.state === "pending")).toBe(true),
    );
    shared.get = realGet;
    await expectConsistentAfterReboot({ seededId: seeded, expect: "old" });
  });

  it("nach der Snapshot-Verifikation, vor dem Prüfen/Commit → alter Stand, der neue Snapshot ist wiederherstellbar", async () => {
    const tab = await boot();
    const seeded = await seedOldState(tab);
    void startImport(tab, { verifySnapshot: hang });
    await vi.waitFor(() => expect(shared.records.size).toBe(2));
    const newSnap = [...shared.records.values()].find((r) => r.id !== seeded)!;
    expect(newSnap.state).toBe("verified");
    await expectConsistentAfterReboot({ seededId: seeded, expect: "old" });
    // Auch der neue Snapshot ist nach dem Neustart noch vollständig lesbar (der Stand VOR dem Import).
    const t2 = await boot();
    const file = await t2.safety.getSnapshotFile(newSnap.id, t2.scope.DEMO_SCOPE, {
      backend: shared,
    });
    expect(JSON.parse(file.text).shifts.map((s: { id: string }) => s.id)).toEqual(["old-1"]);
  });

  it("unmittelbar vor dem Commit (Prüfung der lokalen Daten hängt) → alter Stand", async () => {
    const tab = await boot();
    const seeded = await seedOldState(tab);
    const base = tab.ports.createActivePorts();
    let reads = 0;
    void startImport(tab, {
      readLocal: () => {
        reads += 1;
        if (reads >= 2) return hang() as never; // zweite Lektüre = Revalidierung vor dem Commit
        return base.readLocal();
      },
    });
    await vi.waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
    await expectConsistentAfterReboot({ seededId: seeded, expect: "old" });
  });

  it("Speichern des neuen Stands schlägt fehl (Quota) → Fehler gemeldet, Speicher bleibt der ALTE Stand (kein halber Stand), PIN unverändert", async () => {
    const tab = await boot();
    const seeded = await seedOldState(tab);
    const realSet = window.localStorage.setItem.bind(window.localStorage);
    const spy = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation((key: string, value: string) => {
        if (key === KEY) throw new DOMException("quota", "QuotaExceededError");
        realSet(key, value);
      });
    try {
      const result = await startImport(tab, {});
      expect(result).toMatchObject({ status: "aborted", reason: "commit-failed" });
    } finally {
      spy.mockRestore();
    }
    expect(storedIds()).toEqual(["old-1"]);
    await expectConsistentAfterReboot({ seededId: seeded, expect: "old" });
  });

  it("kein Absturz: der Import gelingt vollständig – der neue Stand steht in EINEM Schlüssel, die alten Snapshots bleiben", async () => {
    const tab = await boot();
    const seeded = await seedOldState(tab);
    const result = await startImport(tab, {});
    expect(result.status).toBe("done");
    expect(storedIds()).toEqual(["file-s1"]);
    await expectConsistentAfterReboot({ seededId: seeded, expect: "new" });
    // Zusätzlich: der Vorab-Snapshot des alten Stands existiert (local_pre_import).
    expect(
      [...shared.records.values()].some(
        (r) => r.kind === "local_pre_import" && r.state === "verified",
      ),
    ).toBe(true);
  });
});

describe("Reihenfolge beim Commit (Absturzsicherheit zwischen Sync-Metadaten und Daten)", () => {
  it("die Änderungsmarke wird VOR dem Datenwechsel gesetzt, nie danach (Quelltext-Vertrag)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${process.cwd()}/src/lib/minijob/guarded-local.ts`, "utf8");
    const commit = src.slice(src.indexOf("commit(prepared"), src.indexOf("args.after?.()"));
    const mark = commit.indexOf("markLocalReplacementForSync()");
    const replace = commit.indexOf("replaceAll(");
    expect(mark).toBeGreaterThan(-1);
    expect(mark).toBeLessThan(replace);
  });
});
