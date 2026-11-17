/**
 * Phase 4 – der geschützte Ablauf (`runGuardedOperation`) mit Test-Ports.
 * Jede Pflichtstufe muss bei Fehlschlag ABBRECHEN, ohne dass `commit` läuft.
 */
import { describe, expect, it } from "vitest";

import { SnapshotError } from "./backup-safety";
import {
  acquireScopeLock,
  GuardedAbort,
  runGuardedOperation,
  type GuardedOperation,
  type GuardedPorts,
  type Prepared,
} from "./guarded-operation";
import type { AppData } from "./types";

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
    settings: { onboarded: true },
    timer: null,
    ...over,
  } as unknown as AppData;
}

const LOCAL = data();
const INCOMING = data({ shifts: [{ id: "s9", date: "2026-02-03" }] });

interface Harness {
  log: string[];
  ports: GuardedPorts;
  op: GuardedOperation;
  state: {
    local: AppData;
    scopeValid: boolean;
    answer: boolean | (() => boolean | Promise<boolean>);
  };
}

function harness(
  over: Partial<GuardedOperation> = {},
  portsOver: Partial<GuardedPorts> = {},
): Harness {
  const log: string[] = [];
  const state = {
    local: LOCAL,
    scopeValid: true,
    answer: true as boolean | (() => boolean | Promise<boolean>),
  };
  let n = 0;
  const ports: GuardedPorts = {
    scopeKey: `scope-${Math.random()}`,
    captureScope: () => ({ isCurrent: () => state.scopeValid }),
    readLocal: () => state.local,
    async confirm() {
      log.push("confirm");
      return typeof state.answer === "function" ? state.answer() : state.answer;
    },
    async createSnapshot(kind) {
      log.push(`snapshot:${kind}`);
      n += 1;
      return { id: `snap${n}`, kind } as never;
    },
    async verifySnapshot(id) {
      log.push(`verify:${id}`);
    },
    ...portsOver,
  };
  const op: GuardedOperation = {
    kind: "local-import",
    async prepare({ local }): Promise<Prepared> {
      log.push("prepare");
      return {
        incoming: INCOMING,
        losing: local,
        snapshotKind: "local_pre_import",
        replaces: "local",
      };
    },
    commit() {
      log.push("commit");
    },
    ...over,
  };
  return { log, ports, op, state };
}

const run = (h: Harness) => runGuardedOperation(h.op, h.ports);

describe("Reihenfolge und Erfolg", () => {
  it("prepare → confirm → snapshot → verify → commit (in genau dieser Reihenfolge)", async () => {
    const h = harness();
    const r = await run(h);
    expect(r.status).toBe("done");
    expect(h.log).toEqual([
      "prepare",
      "confirm",
      "snapshot:local_pre_import",
      "verify:snap1",
      "commit",
    ]);
  });

  it("Vorschau zeigt Verlust und Zugang je Sammlung", async () => {
    const h = harness();
    const r = await run(h);
    if (r.status !== "done") throw new Error("expected done");
    const shifts = r.preview.collections.find((c) => c.name === "shifts")!;
    expect(shifts).toMatchObject({ lost: 1, added: 1 });
    expect(r.preview.snapshot).toEqual({ kind: "local_pre_import", required: true });
  });
});

describe("ausdrückliche Bestätigung", () => {
  it.each([false, "throw"] as const)(
    "Antwort %s → abgebrochen, kein Snapshot, kein Commit",
    async (answer) => {
      const h = harness();
      h.state.answer = answer === "throw" ? () => Promise.reject(new Error("x")) : false;
      const r = await run(h);
      expect(r.status).toBe("cancelled");
      expect(h.log).toEqual(["prepare", "confirm"]);
    },
  );

  it("nur genau `true` bestätigt (keine truthy-Werte)", async () => {
    const h = harness();
    h.state.answer = (() => "yes") as never;
    expect((await run(h)).status).toBe("cancelled");
    expect(h.log).not.toContain("commit");
  });
});

describe("Pflichtstufen brechen OHNE Änderung ab", () => {
  it("Snapshot schlägt fehl → kein Commit", async () => {
    const h = harness(
      {},
      {
        async createSnapshot() {
          h.log.push("snapshot");
          throw new SnapshotError("quota");
        },
      },
    );
    const r = await run(h);
    expect(r).toMatchObject({ status: "aborted", reason: "snapshot-failed" });
    expect(h.log).not.toContain("commit");
  });

  it("Verifikation des Snapshots schlägt fehl → kein Commit", async () => {
    const h = harness(
      {},
      {
        async verifySnapshot() {
          throw new SnapshotError("verification-failed", "sha256-mismatch");
        },
      },
    );
    const r = await run(h);
    expect(r).toMatchObject({ status: "aborted", reason: "verification-failed" });
    expect(h.log).not.toContain("commit");
  });

  it("lokale Daten ändern sich nach dem Vergleich → local-changed, kein Commit", async () => {
    const h = harness();
    h.state.answer = () => {
      h.state.local = data({ jobs: [{ id: "j1" }, { id: "j-new" }] });
      return true;
    };
    expect(await run(h)).toMatchObject({ status: "aborted", reason: "local-changed" });
    expect(h.log).not.toContain("commit");
  });

  it("lokale Änderung WÄHREND des Snapshots wird ebenfalls erkannt", async () => {
    const h = harness(
      {},
      {
        async createSnapshot() {
          h.state.local = data({ goals: [{ id: "g1" }] });
          return { id: "s", kind: "local_pre_import" } as never;
        },
      },
    );
    expect(await run(h)).toMatchObject({ status: "aborted", reason: "local-changed" });
    expect(h.log).not.toContain("commit");
  });

  it("Remote-Token ändert sich nach dem Vergleich → remote-changed, kein Commit", async () => {
    const h = harness({ revalidateRemote: async () => false });
    expect(await run(h)).toMatchObject({ status: "aborted", reason: "remote-changed" });
    expect(h.log).not.toContain("commit");
  });

  it("Fehler bei der Token-Prüfung zählt als Änderung (nie als 'unverändert')", async () => {
    const h = harness({
      revalidateRemote: async () => {
        throw new Error("net");
      },
    });
    expect(await run(h)).toMatchObject({ status: "aborted", reason: "remote-changed" });
    expect(h.log).not.toContain("commit");
  });

  it("Kontowechsel/Scope-Epoche während prepare → scope-changed", async () => {
    const h = harness({
      async prepare({ local }) {
        h.state.scopeValid = false;
        return {
          incoming: INCOMING,
          losing: local,
          snapshotKind: "local_pre_import",
          replaces: "local",
        };
      },
    });
    expect(await run(h)).toMatchObject({ status: "aborted", reason: "scope-changed" });
    expect(h.log).not.toContain("confirm");
  });

  it("Kontowechsel während der Bestätigung → scope-changed, kein Commit", async () => {
    const h = harness();
    h.state.answer = () => {
      h.state.scopeValid = false;
      return true;
    };
    expect(await run(h)).toMatchObject({ status: "aborted", reason: "scope-changed" });
    expect(h.log).not.toContain("commit");
  });

  it("Kontowechsel während des Snapshots → scope-changed, kein Commit", async () => {
    const h = harness(
      {},
      {
        async createSnapshot() {
          h.state.scopeValid = false;
          return { id: "s", kind: "local_pre_import" } as never;
        },
      },
    );
    expect(await run(h)).toMatchObject({ status: "aborted", reason: "scope-changed" });
    expect(h.log).not.toContain("commit");
  });

  it("Scope war schon VOR dem Start überholt (Sperre erst danach frei) → kein prepare", async () => {
    const h = harness();
    h.state.scopeValid = false;
    expect(await run(h)).toMatchObject({ status: "aborted", reason: "scope-changed" });
    expect(h.log).toEqual([]);
  });

  it("ungültige eingehende Nutzlast → invalid-payload, nichts gezeigt", async () => {
    const h = harness({
      async prepare({ local }) {
        return {
          incoming: { shifts: "x" } as never,
          losing: local,
          snapshotKind: "local_pre_import",
          replaces: "local",
        };
      },
    });
    expect(await run(h)).toMatchObject({ status: "aborted", reason: "invalid-payload" });
    expect(h.log).not.toContain("confirm");
  });

  it("ungültige zu sichernde Seite → invalid-payload (kein Snapshot von Müll)", async () => {
    const h = harness({
      async prepare() {
        return {
          incoming: INCOMING,
          losing: { jobs: 1 } as never,
          snapshotKind: "local_pre_import",
          replaces: "local",
        };
      },
    });
    expect(await run(h)).toMatchObject({ status: "aborted", reason: "invalid-payload" });
  });

  it("prepare wirft (z. B. Netzwerk) → prepare-failed; GuardedAbort behält seinen Grund", async () => {
    expect(
      await run(
        harness({
          prepare: async () => {
            throw new Error("net");
          },
        }),
      ),
    ).toMatchObject({ status: "aborted", reason: "prepare-failed" });
    expect(
      await run(
        harness({
          prepare: async () => {
            throw new GuardedAbort("remote-missing");
          },
        }),
      ),
    ).toMatchObject({ status: "aborted", reason: "remote-missing" });
  });

  it("commit wirft → commit-failed (der Fehler wird mitgegeben)", async () => {
    const boom = new Error("boom");
    const r = await run(
      harness({
        commit: () => {
          throw boom;
        },
      }),
    );
    expect(r).toMatchObject({ status: "aborted", reason: "commit-failed", error: boom });
  });
});

describe("gleiche Stände", () => {
  it("identisch: kein Snapshot, onIdentical statt commit", async () => {
    const h = harness({
      async prepare({ local }) {
        return {
          incoming: local,
          losing: local,
          snapshotKind: "local_pre_import",
          replaces: "local",
        };
      },
      onIdentical: () => {
        h.log.push("identical");
      },
    });
    const r = await run(h);
    expect(r).toMatchObject({ status: "done", unchanged: true, snapshot: null });
    expect(h.log).toEqual(["confirm", "identical"]);
  });

  it("nichts zu verlieren (losing = null): kein Snapshot nötig", async () => {
    const h = harness({
      async prepare() {
        return {
          incoming: INCOMING,
          losing: null,
          snapshotKind: "cloud_pre_overwrite",
          replaces: "cloud",
        };
      },
    });
    const r = await run(h);
    expect(r.status).toBe("done");
    expect(h.log.some((l) => l.startsWith("snapshot"))).toBe(false);
  });
});

describe("Sperre je Scope", () => {
  it("zweite gleichzeitige Operation im selben Scope → lock-busy, erste läuft durch", async () => {
    const h1 = harness();
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    h1.state.answer = () => hold.then(() => true);
    const h2 = harness({}, { scopeKey: h1.ports.scopeKey });
    const first = run(h1);
    await Promise.resolve();
    await Promise.resolve();
    expect(await run(h2)).toMatchObject({ status: "aborted", reason: "lock-busy" });
    expect(h2.log).toEqual([]);
    release();
    expect((await first).status).toBe("done");
  });

  it("andere Scopes blockieren sich nicht; die Sperre wird nach Fehlern wieder frei", async () => {
    const a = harness({
      commit: () => {
        throw new Error("x");
      },
    });
    expect((await run(a)).status).toBe("aborted");
    const again = harness({}, { scopeKey: a.ports.scopeKey });
    expect((await run(again)).status).toBe("done");
    const rel = await acquireScopeLock("other-scope");
    expect(rel).not.toBeNull();
    rel!();
  });
});

describe("keine Standard-Zustimmung", () => {
  it("ohne confirm-Antwort true wird nie committet (Quelltext: kein Auto-Confirm im Ablauf)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${process.cwd()}/src/lib/minijob/guarded-operation.ts`, "utf8");
    expect(src).toMatch(/\(await ports\.confirm\(preview\)\) === true/);
    const confirmSrc = readFileSync(`${process.cwd()}/src/lib/minijob/guarded-confirm.ts`, "utf8");
    expect(confirmSrc).toMatch(/if \(mounted === 0\) return Promise\.resolve\(false\)/);
  });
});
