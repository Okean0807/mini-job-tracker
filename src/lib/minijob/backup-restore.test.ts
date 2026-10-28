/**
 * JSON-Wiederherstellung mit ECHTEM Store und echter localStorage-Anbindung (kein Store-Mock):
 * strenge Prüfung vor dem Anwenden, Größenlimit vor dem Lesen, Ersetzen nur nach apply,
 * Rollback bei Speicher-/Aufbaufehlern, Rückgängig und Kompatibilität mit dem Export-Format.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyPreparedBackup,
  MAX_BACKUP_BYTES,
  prepareBackupFile,
  undoBackupRestore,
  type PreparedBackup,
} from "./backup-restore";
import { validateBackup } from "./backup-validate";
import {
  dataStorageKey,
  getData,
  isPersistFailed,
  replaceAll,
  saveJob,
  saveShift,
  updateSettings,
} from "./store";
import type { Job, Shift } from "./types";

const job = (id: string, extra: Partial<Job> = {}): Job => ({
  id,
  name: `Job ${id}`,
  color: "#0d9488",
  mode: "flex",
  ...extra,
});
const shift = (id: string, extra: Partial<Shift> = {}): Shift => ({
  id,
  jobId: "j1",
  kind: "arbeit",
  date: "2026-09-01",
  start: "09:00",
  end: "13:00",
  breakMinutes: 0,
  ...extra,
});
const backup = (over: Record<string, unknown> = {}) => ({
  shifts: [shift("s1")],
  jobs: [job("j1")],
  ...over,
});
const file = (value: unknown) => ({
  text: async () => (typeof value === "string" ? value : JSON.stringify(value)),
});

function seed(count = 5) {
  replaceAll({ shifts: [], jobs: [] });
  updateSettings({ language: "de" });
  saveJob(job("old-job"));
  for (let i = 0; i < count; i += 1) saveShift(shift(`old-${i}`, { jobId: "old-job" }));
}
const snapshot = () => JSON.stringify(getData());
const stored = () => window.localStorage.getItem(dataStorageKey());

async function ready(value: unknown): Promise<PreparedBackup> {
  const r = await prepareBackupFile(file(value));
  if (r.status !== "ready") throw new Error(`expected ready, got ${r.status}`);
  return r.prepared;
}

beforeEach(() => {
  window.localStorage.clear();
  seed();
});
afterEach(() => vi.restoreAllMocks());

describe("validateBackup — strict, nothing repaired", () => {
  const issues = (raw: unknown) => {
    const r = validateBackup(raw);
    return r.ok ? [] : r.issues.map((i) => `${i.path}:${i.code}`);
  };

  it("accepts a minimal and an old-format backup (no kind/breakMinutes/settings/timer)", () => {
    expect(validateBackup(backup()).ok).toBe(true);
    const old = {
      shifts: [{ id: "a", jobId: "j1", date: "2025-01-02", start: "08:00", end: "12:30" }],
      jobs: [{ id: "j1", name: "Altjob", color: "#000", rate: 0 }],
    };
    expect(validateBackup(old).ok).toBe(true);
  });

  it("tolerates a stale settings.activeJobId (own exports can contain one)", () => {
    expect(validateBackup(backup({ settings: { activeJobId: "ghost" } })).ok).toBe(true);
  });

  it("accepts empty lists (a legitimate empty backup)", () => {
    expect(validateBackup({ shifts: [], jobs: [] }).ok).toBe(true);
  });

  it.each([
    ["not an object", [], "$:not-object"],
    ["missing shifts", { jobs: [] }, "shifts:missing"],
    ["missing jobs", { shifts: [] }, "jobs:missing"],
    ["shifts not an array", backup({ shifts: "x" }), "shifts:not-array"],
    ["null row", backup({ shifts: [null] }), "shifts[0]:not-record"],
    ["missing shift id", backup({ shifts: [shift("", {})] }), "shifts[0].id:missing"],
    [
      "missing date",
      backup({ shifts: [{ ...shift("s1"), date: undefined }] }),
      "shifts[0].date:missing",
    ],
    [
      "impossible date",
      backup({ shifts: [shift("s1", { date: "2026-02-30" })] }),
      "shifts[0].date:format",
    ],
    ["bad time", backup({ shifts: [shift("s1", { start: "25:00" })] }), "shifts[0].start:format"],
    [
      "unknown kind",
      backup({ shifts: [shift("s1", { kind: "x" as never })] }),
      "shifts[0].kind:format",
    ],
    [
      "negative break",
      backup({ shifts: [shift("s1", { breakMinutes: -5 })] }),
      "shifts[0].breakMinutes:range",
    ],
    [
      "string rate",
      backup({ shifts: [shift("s1", { rate: "9" as never })] }),
      "shifts[0].rate:type",
    ],
    [
      "unknown jobId",
      backup({ shifts: [shift("s1", { jobId: "ghost" })] }),
      "shifts[0].jobId:unknown-ref",
    ],
    ["job without name", backup({ jobs: [{ id: "j1", color: "#000" }] }), "jobs[0].name:missing"],
    ["negative job rate", backup({ jobs: [job("j1", { rate: -1 })] }), "jobs[0].rate:range"],
    ["NaN-like rate", backup({ jobs: [{ ...job("j1"), rate: null }] }), "jobs[0].rate:type"],
    [
      "unknown work mode",
      backup({ jobs: [job("j1", { mode: "x" as never })] }),
      "jobs[0].mode:format",
    ],
    ["settings not an object", backup({ settings: [] }), "settings:not-record"],
    [
      "settings.monthlyLimit string",
      backup({ settings: { monthlyLimit: "603" } }),
      "settings.monthlyLimit:type",
    ],
    ["timer wrong shape", backup({ timer: "läuft" }), "timer:not-record"],
    [
      "timer bad start",
      backup({ timer: { startedAt: 0, breakMinutes: 0 } }),
      "timer.startedAt:format",
    ],
    [
      "timer unknown job",
      backup({ timer: { startedAt: 5, breakMinutes: 0, jobId: "ghost" } }),
      "timer.jobId:unknown-ref",
    ],
    [
      "payment unknown job",
      backup({ payments: [{ id: "p", jobId: "ghost" }] }),
      "payments[0].jobId:unknown-ref",
    ],
    ["side list not records", backup({ goals: [1] }), "goals[0]:not-record"],
  ])("rejects: %s", (_name, raw, expected) => {
    expect(issues(raw)).toContain(expected);
  });

  it("rejects duplicate ids (shifts, jobs, side lists)", () => {
    expect(issues(backup({ shifts: [shift("s1"), shift("s1")] }))).toContain(
      "shifts[1].id:duplicate",
    );
    expect(issues(backup({ jobs: [job("j1"), job("j1")] }))).toContain("jobs[1].id:duplicate");
    expect(issues(backup({ goals: [{ id: "g" }, { id: "g" }] }))).toContain(
      "goals[1].id:duplicate",
    );
  });

  it("does not mutate the input", () => {
    const raw = backup({ shifts: [{ ...shift("s1"), kind: undefined }] });
    const copy = JSON.stringify(raw);
    validateBackup(raw);
    expect(JSON.stringify(raw)).toBe(copy);
  });
});

describe("prepareBackupFile — nothing is written, size is checked before reading", () => {
  it("a valid file is prepared with counts; stored data is untouched", async () => {
    const before = snapshot();
    const stored0 = stored();
    const prepared = await ready(backup());
    expect(prepared.current).toEqual({ shifts: 5, jobs: 1 });
    expect(prepared.incoming).toEqual({ shifts: 1, jobs: 1 });
    expect(snapshot()).toBe(before);
    expect(stored()).toBe(stored0);
  });

  it("a file above 2 MiB is rejected from its size alone — text() is never called", async () => {
    const text = vi.fn(async () => "{}");
    const r = await prepareBackupFile({ size: MAX_BACKUP_BYTES + 1, text });
    expect(r.status).toBe("too-large");
    expect(text).not.toHaveBeenCalled();
  });

  it("without a reported size, an oversized text is rejected before JSON.parse", async () => {
    const parse = vi.spyOn(JSON, "parse");
    const r = await prepareBackupFile({ text: async () => " ".repeat(MAX_BACKUP_BYTES + 1) });
    expect(r.status).toBe("too-large");
    expect(parse).not.toHaveBeenCalled();
  });

  it("malformed and truncated JSON → parse-error, data unchanged", async () => {
    const before = snapshot();
    expect((await prepareBackupFile(file("{not json"))).status).toBe("parse-error");
    const full = JSON.stringify(backup());
    expect((await prepareBackupFile(file(full.slice(0, full.length - 7)))).status).toBe(
      "parse-error",
    );
    expect(snapshot()).toBe(before);
  });

  it("a failing file read → read-error", async () => {
    const r = await prepareBackupFile({ text: () => Promise.reject(new Error("denied")) });
    expect(r.status).toBe("read-error");
  });

  it("invalid content → invalid with issue paths, data unchanged", async () => {
    const before = snapshot();
    const r = await prepareBackupFile(file(backup({ shifts: [shift("s1", { jobId: "ghost" })] })));
    expect(r.status).toBe("invalid");
    if (r.status === "invalid")
      expect(r.issues[0]).toEqual({ path: "shifts[0].jobId", code: "unknown-ref" });
    expect(snapshot()).toBe(before);
  });
});

describe("applyPreparedBackup — replaces, never merges", () => {
  it("restoring over non-empty data replaces shifts and jobs (5 → 1)", async () => {
    expect(getData().shifts).toHaveLength(5);
    const prepared = await ready(backup());
    expect(getData().shifts).toHaveLength(5); // still untouched before apply
    expect(applyPreparedBackup(prepared).status).toBe("restored");
    expect(getData().shifts.map((s) => s.id)).toEqual(["s1"]);
    expect(getData().jobs.map((j) => j.id)).toEqual(["j1"]);
    expect(stored()).toContain('"s1"');
    expect(stored()).not.toContain("old-0");
  });

  it("empty arrays over non-empty data clear shifts and jobs (explicitly reported in the counts)", async () => {
    const prepared = await ready({ shifts: [], jobs: [] });
    expect(prepared.current.shifts).toBe(5);
    expect(prepared.incoming).toEqual({ shifts: 0, jobs: 0 });
    expect(applyPreparedBackup(prepared).status).toBe("restored");
    expect(getData().shifts).toHaveLength(0);
    expect(getData().jobs).toHaveLength(0);
  });

  it("undo brings the previous state back", async () => {
    const before = snapshot();
    const prepared = await ready(backup());
    const result = applyPreparedBackup(prepared);
    if (result.status !== "restored") throw new Error("expected restored");
    expect(undoBackupRestore(result.previous, prepared.generation).status).toBe("restored");
    expect(snapshot()).toBe(before);
    expect(stored()).toContain("old-0");
  });

  it("a storage write failure keeps the previous state in memory and on disk — no false success", async () => {
    const prepared = await ready(backup());
    const before = snapshot();
    const storedBefore = stored();
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    let status;
    try {
      status = applyPreparedBackup(prepared).status;
    } finally {
      setItem.mockRestore();
    }
    expect(status).toBe("persist-failed");
    expect(snapshot()).toBe(before);
    expect(stored()).toBe(storedBefore);
    expect(isPersistFailed()).toBe(false); // state in memory equals disk again
  });

  it("an error while building the new state changes nothing", async () => {
    const before = snapshot();
    const storedBefore = stored();
    const hostile = {
      shifts: [],
      jobs: [],
      get settings(): never {
        throw new Error("boom");
      },
    };
    const result = applyPreparedBackup({
      data: hostile as never,
      current: { shifts: 5, jobs: 1 },
      incoming: { shifts: 0, jobs: 0 },
      generation: (await ready(backup())).generation,
    });
    expect(result.status).toBe("error");
    expect(snapshot()).toBe(before);
    expect(stored()).toBe(storedBefore);
  });
});

describe("compatibility with the current export format", () => {
  it("the app's own JSON export (getData) validates, prepares and round-trips", async () => {
    const exported = JSON.parse(JSON.stringify(getData()));
    expect(validateBackup(exported).ok).toBe(true);
    const prepared = await ready(exported);
    expect(prepared.incoming).toEqual({ shifts: 5, jobs: 1 });
    replaceAll({ shifts: [], jobs: [] });
    expect(applyPreparedBackup(prepared).status).toBe("restored");
    expect(
      getData()
        .shifts.map((s) => s.id)
        .sort(),
    ).toEqual(["old-0", "old-1", "old-2", "old-3", "old-4"]);
  });
});
