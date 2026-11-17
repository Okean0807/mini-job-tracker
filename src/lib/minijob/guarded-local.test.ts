/**
 * Phase 4 – Snapshot-Wiederherstellung über den geschützten Ablauf (echter Store, Testmodus-Scope,
 * In-Memory-Snapshotablage). Prüft Verifikation, Vorab-Snapshot, Gerätesperre und Scope-Isolation.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { installGuardedDoubles, type GuardedDoubles } from "@/test-utils/guarded-doubles";

import { createActiveSnapshot } from "./backup-safety-active";
import { SnapshotError } from "./backup-safety";
import { restoreSnapshot } from "./guarded-local";
import { DEMO_SCOPE, userScope } from "./storage-scope";
import {
  activateScope,
  getData,
  loadFromStorage,
  replaceAll,
  saveJob,
  saveShift,
  updateSettings,
} from "./store";

const PIN = "4321";

function shiftOf(id: string, date: string) {
  return {
    id,
    kind: "arbeit",
    date,
    start: "09:00",
    end: "10:00",
    breakMinutes: 0,
    jobId: "j",
  } as never;
}

let doubles: GuardedDoubles;

beforeEach(async () => {
  window.localStorage.clear();
  doubles = await installGuardedDoubles();
  loadFromStorage();
  activateScope(DEMO_SCOPE);
  replaceAll({ shifts: [], jobs: [] });
  updateSettings({ pin: PIN, pinEnabled: true });
  saveJob({ id: "j", name: "Job", color: "#111", mode: "flex" });
  saveShift(shiftOf("old-1", "2026-01-05"));
});

/** Snapshot des heutigen Standes ("old-1"), danach arbeitet der Nutzer weiter. */
async function snapshotThenWorkOn(): Promise<string> {
  const { summary } = await createActiveSnapshot("local_pre_import", getData());
  saveShift(shiftOf("new-1", "2026-02-06"));
  saveShift(shiftOf("new-2", "2026-02-07"));
  return summary.id;
}

describe("Snapshot-Wiederherstellung", () => {
  it("prüft den Snapshot erneut, sichert den AKTUELLEN Stand zuerst, ersetzt erst nach Bestätigung", async () => {
    const id = await snapshotThenWorkOn();
    expect(doubles.storage.records.size).toBe(1);

    const result = await restoreSnapshot(id);

    expect(result.status).toBe("done");
    expect(getData().shifts.map((s) => s.id)).toEqual(["old-1"]);
    // Vergleich gezeigt: 2 neuere Schichten gehen verloren.
    expect(doubles.previews[0]).toMatchObject({ kind: "snapshot-restore", replaces: "local" });
    expect(doubles.previews[0]!.collections.find((c) => c.name === "shifts")!.lost).toBe(2);
    // Vorab-Snapshot des Standes vor der Wiederherstellung (zusätzlich zum Quell-Snapshot).
    const kinds = [...doubles.storage.records.values()].map((r) => r.kind).sort();
    expect(kinds).toEqual(["local_pre_import", "local_pre_restore"]);
    const pre = [...doubles.storage.records.values()].find((r) => r.kind === "local_pre_restore")!;
    expect(
      JSON.parse(pre.payload)
        .shifts.map((s: { id: string }) => s.id)
        .sort(),
    ).toEqual(["new-1", "new-2", "old-1"]);
  });

  it("die Gerätesperre (PIN) bleibt lokal – auch wenn der Snapshot keine enthält", async () => {
    const id = await snapshotThenWorkOn();
    await restoreSnapshot(id);
    expect(getData().settings.pin).toBe(PIN);
    expect(getData().settings.pinEnabled).toBe(true);
  });

  it("ohne Bestätigung: nichts verändert, kein Vorab-Snapshot", async () => {
    const id = await snapshotThenWorkOn();
    doubles.setAnswer(false);
    const before = JSON.stringify(getData());
    expect((await restoreSnapshot(id)).status).toBe("cancelled");
    expect(JSON.stringify(getData())).toBe(before);
    expect(doubles.storage.records.size).toBe(1);
  });

  it("beschädigter Snapshot (SHA-256) → blockiert, nichts verändert, kein Vergleich gezeigt", async () => {
    const id = await snapshotThenWorkOn();
    const rec = doubles.storage.records.get(id)!;
    doubles.storage.tamper(id, { payload: rec.payload.replace("old-1", "evil-1") });
    const before = JSON.stringify(getData());
    const result = await restoreSnapshot(id);
    expect(result).toMatchObject({ status: "aborted", reason: "invalid-payload" });
    expect(JSON.stringify(getData())).toBe(before);
    expect(doubles.previews).toHaveLength(0);
  });

  it("Vorab-Snapshot scheitert → nichts ersetzt", async () => {
    const id = await snapshotThenWorkOn();
    doubles.storage.failAlways("put", new SnapshotError("quota"));
    const before = JSON.stringify(getData());
    expect(await restoreSnapshot(id)).toMatchObject({
      status: "aborted",
      reason: "snapshot-failed",
    });
    expect(JSON.stringify(getData())).toBe(before);
  });

  it("Snapshot eines anderen Scopes ist 'nicht vorhanden' und wird nie zurückgespielt", async () => {
    const id = await snapshotThenWorkOn();
    doubles.storage.tamper(id, { scope: "u:somebody-else" });
    const before = JSON.stringify(getData());
    expect(await restoreSnapshot(id)).toMatchObject({
      status: "aborted",
      reason: "invalid-payload",
    });
    expect(JSON.stringify(getData())).toBe(before);
  });

  it("nicht verifizierte (pending) Snapshots lassen sich nicht zurückspielen", async () => {
    const id = await snapshotThenWorkOn();
    doubles.storage.tamper(id, { state: "pending" });
    expect(await restoreSnapshot(id)).toMatchObject({
      status: "aborted",
      reason: "invalid-payload",
    });
    expect(getData().shifts).toHaveLength(3);
  });

  it("Kontowechsel während der Bestätigung → nichts ersetzt", async () => {
    const id = await snapshotThenWorkOn();
    doubles.setAnswer(() => {
      activateScope(userScope("someone-else"));
      return true;
    });
    const result = await restoreSnapshot(id);
    expect(result).toMatchObject({ status: "aborted", reason: "scope-changed" });
    activateScope(DEMO_SCOPE);
    expect(getData().shifts).toHaveLength(3);
  });

  it("der Snapshot-Inhalt (alle acht Sammlungen, verwaiste Zahlung) kommt unverändert zurück", async () => {
    replaceAll({
      shifts: [shiftOf("s", "2026-03-01")],
      jobs: [{ id: "j", name: "Job", color: "#111", mode: "flex" } as never],
      customers: [{ id: "cu" } as never],
      projects: [{ id: "p" } as never],
      payments: [{ id: "pay", jobId: "gone", year: 2026, month: 1, actual: 7 } as never],
      goals: [{ id: "g" } as never],
      orders: [{ id: "o" } as never],
      objects: [{ id: "ob", name: "Obj" } as never],
    });
    const { summary } = await createActiveSnapshot("local_pre_restore", getData());
    replaceAll({ shifts: [], jobs: [] });
    expect((await restoreSnapshot(summary.id)).status).toBe("done");
    const d = getData();
    expect(d.customers).toHaveLength(1);
    expect(d.projects).toHaveLength(1);
    expect(d.goals).toHaveLength(1);
    expect(d.orders).toHaveLength(1);
    expect(d.objects.some((o) => o.id === "ob")).toBe(true);
    expect(d.payments[0]).toMatchObject({ id: "pay", jobId: "gone", actual: 7 });
  });
});
