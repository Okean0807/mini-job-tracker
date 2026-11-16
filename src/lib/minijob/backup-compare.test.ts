/** Data-safety Phase 1 – reine Vergleichs-/Prüflogik (`backup-compare.ts`). */
import { describe, expect, it } from "vitest";

import {
  buildManifest,
  COLLECTION_NAMES,
  diffBackups,
  fullFingerprint,
  isUserDataEmpty,
  userDataFingerprint,
  validateIntegrity,
  type BackupLike,
  type CollectionName,
} from "./backup-compare";

function fixture(): Record<CollectionName, Record<string, unknown>[]> & {
  settings: Record<string, unknown>;
  timer: null;
} {
  return {
    shifts: [
      {
        id: "s1",
        jobId: "j1",
        kind: "arbeit",
        date: "2026-09-16",
        start: "08:00",
        end: "12:00",
        breakMinutes: 0,
        objectId: "o1",
      },
      {
        id: "s2",
        jobId: "j1",
        kind: "urlaub",
        date: "2026-10-27",
        start: "09:00",
        end: "17:00",
        breakMinutes: 30,
      },
    ],
    jobs: [{ id: "j1", name: "Job", color: "#000", mode: "flex", rate: 17 }],
    customers: [{ id: "c1", name: "Kunde" }],
    projects: [{ id: "p1", customerId: "c1", name: "Projekt" }],
    payments: [{ id: "pay1", jobId: "j1", year: 2026, month: 8, actual: 87.75 }],
    goals: [{ id: "g1", name: "Ziel", target: 100, kind: "auto" }],
    orders: [
      {
        id: "ord1",
        title: "A",
        customerName: "K",
        service: "S",
        location: "L",
        dateFrom: "2026-10-01",
        amount: 10,
        status: "open",
      },
    ],
    objects: [{ id: "o1", name: "Objekt" }],
    settings: { autoBackup: false, premium: false, defaultRate: 17, activeJobId: "j1" },
    timer: null,
  };
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("fullFingerprint", () => {
  it("ist deterministisch und unabhängig von der Schlüsselreihenfolge", () => {
    const a = fixture();
    const b: BackupLike = {
      timer: null,
      settings: { activeJobId: "j1", defaultRate: 17, premium: false, autoBackup: false },
      objects: [{ name: "Objekt", id: "o1" }],
      orders: a.orders.map((o) => Object.fromEntries(Object.entries(o).reverse())),
      goals: [{ kind: "auto", target: 100, name: "Ziel", id: "g1" }],
      payments: [{ actual: 87.75, month: 8, year: 2026, jobId: "j1", id: "pay1" }],
      projects: [{ name: "Projekt", customerId: "c1", id: "p1" }],
      customers: [{ name: "Kunde", id: "c1" }],
      jobs: [{ rate: 17, mode: "flex", color: "#000", name: "Job", id: "j1" }],
      shifts: [...a.shifts].reverse().map((s) => Object.fromEntries(Object.entries(s).reverse())),
    };
    expect(fullFingerprint(a)).toBe(fullFingerprint(b));
    expect(fullFingerprint(a)).toBe(fullFingerprint(clone(a)));
    expect(fullFingerprint(a)).toMatch(/^fp1-\d+-[0-9a-f]{28}$/);
  });

  it.each(COLLECTION_NAMES)("eine Änderung in %s ändert die Prüfsumme", (name) => {
    const base = fixture();
    const changed = clone(base);
    const first = changed[name][0]!;
    first["__marker"] = "geändert";
    expect(fullFingerprint(changed)).not.toBe(fullFingerprint(base));
    // auch ein zusätzlicher Datensatz
    const added = clone(base);
    added[name].push({ id: `${name}-neu` });
    expect(fullFingerprint(added)).not.toBe(fullFingerprint(base));
    // und ein entfernter
    const removed = clone(base);
    removed[name].pop();
    expect(fullFingerprint(removed)).not.toBe(fullFingerprint(base));
  });

  it("Geräte-Anmeldedaten und Timer ändern die Prüfsumme nicht", () => {
    const base = fixture();
    const withAuth = clone(base);
    Object.assign(withAuth.settings, {
      pin: "0000",
      pinEnabled: true,
      biometric: true,
      biometricCredentialId: "cred-xyz",
    });
    (withAuth as unknown as { timer: unknown }).timer = { startedAt: 123, breakMinutes: 5 };
    expect(fullFingerprint(withAuth)).toBe(fullFingerprint(base));
  });

  it("Änderungen an Nicht-Geräte-Einstellungen werden erkannt", () => {
    const base = fixture();
    for (const patch of [
      { premium: true },
      { autoBackup: true },
      { defaultRate: 18 },
      { activeJobId: "x" },
    ]) {
      const changed = clone(base);
      Object.assign(changed.settings, patch);
      expect(fullFingerprint(changed)).not.toBe(fullFingerprint(base));
    }
  });

  it("Standardwerte werden gleich behandelt (kind/breakMinutes fehlen, undefined = fehlt)", () => {
    const a = fixture();
    const b = clone(a);
    delete (b.shifts[0] as Record<string, unknown>)["kind"];
    delete (b.shifts[0] as Record<string, unknown>)["breakMinutes"];
    (b.shifts[1] as Record<string, unknown>)["note"] = undefined;
    expect(fullFingerprint(b)).toBe(fullFingerprint(a));
  });

  it("fehlende/kaputte Sammlungen verursachen keinen Absturz", () => {
    expect(() => fullFingerprint(null)).not.toThrow();
    expect(() =>
      fullFingerprint({ shifts: "kaputt", jobs: [null, 5, "x"] } as unknown as BackupLike),
    ).not.toThrow();
    expect(fullFingerprint({})).toBe(fullFingerprint({ shifts: [], jobs: [] }));
  });
});

describe("userDataFingerprint (nur die acht Sammlungen)", () => {
  it.each(COLLECTION_NAMES)("ändert sich bei einer Änderung in %s", (name) => {
    const base = fixture();
    const changed = clone(base);
    changed[name].push({ id: `${name}-neu` });
    expect(userDataFingerprint(changed)).not.toBe(userDataFingerprint(base));
  });

  it("ignoriert Einstellungen, Geräte-Anmeldedaten und Timer", () => {
    const base = fixture();
    const other = clone(base);
    Object.assign(other.settings, { premium: true, defaultRate: 99, pin: "1234" });
    expect(userDataFingerprint(other)).toBe(userDataFingerprint(base));
    expect(fullFingerprint(other)).not.toBe(fullFingerprint(base));
  });

  it("ist deterministisch und hat ein eigenes Präfix", () => {
    expect(userDataFingerprint(fixture())).toBe(userDataFingerprint(clone(fixture())));
    expect(userDataFingerprint(fixture())).toMatch(/^ud1-\d+-[0-9a-f]{28}$/);
  });
});

describe("buildManifest", () => {
  it("zählt alle acht Sammlungen und bestimmt den Schicht-Datumsbereich", () => {
    const m = buildManifest(fixture());
    expect(m.counts).toEqual({
      shifts: 2,
      jobs: 1,
      customers: 1,
      projects: 1,
      payments: 1,
      goals: 1,
      orders: 1,
      objects: 1,
    });
    expect(m.totalRecords).toBe(9);
    expect(m.shiftDateRange).toEqual({ earliest: "2026-09-16", latest: "2026-10-27" });
    expect(Object.keys(m.counts).sort()).toEqual([...COLLECTION_NAMES].sort());
    expect(m.ids.shifts).toEqual(["s1", "s2"]);
  });

  it("meldet doppelte Ids und fehlende Ids; leere Eingabe → Nullwerte", () => {
    const data = fixture();
    data.shifts.push({ id: "s1", date: "2026-09-16" }, { date: "kein-id" });
    const m = buildManifest(data);
    expect(m.duplicateIds.shifts).toEqual(["s1"]);
    expect(m.missingIdCount.shifts).toBe(1);
    const empty = buildManifest(null);
    expect(empty.totalRecords).toBe(0);
    expect(empty.shiftDateRange).toBeNull();
  });
});

describe("diffBackups", () => {
  it("identische Stände → identical", () => {
    const diff = diffBackups(fixture(), clone(fixture()));
    expect(diff.identical).toBe(true);
    expect(diff.hasLocalOnly || diff.hasOtherOnly || diff.hasChanged).toBe(false);
  });

  it("erkennt Datensätze nur lokal / nur auf der anderen Seite je Sammlung", () => {
    const local = fixture();
    const other = clone(local);
    local.payments.push({ id: "pay-lokal", jobId: "j1", year: 2026, month: 9, actual: 1 });
    other.goals.push({ id: "g-cloud", name: "x", target: 1, kind: "manual" });
    const diff = diffBackups(local, other);
    expect(diff.collections.payments.onlyLocal).toEqual(["pay-lokal"]);
    expect(diff.collections.goals.onlyOther).toEqual(["g-cloud"]);
    expect(diff.hasLocalOnly && diff.hasOtherOnly).toBe(true);
    expect(diff.identical).toBe(false);
  });

  it("gleiche Id mit anderen Feldern: nur Feldnamen, nie Werte", () => {
    const local = fixture();
    const other = clone(local);
    (other.shifts[0] as Record<string, unknown>)["end"] = "13:00";
    (other.shifts[0] as Record<string, unknown>)["note"] = "geheim";
    const diff = diffBackups(local, other);
    expect(diff.collections.shifts.changed).toEqual([{ id: "s1", fields: ["end", "note"] }]);
    expect(JSON.stringify(diff)).not.toContain("geheim");
    expect(diff.collections.shifts.unchangedCount).toBe(1);
  });

  it("Einstellungen werden getrennt gemeldet, Geräte-Anmeldedaten nicht", () => {
    const local = fixture();
    const other = clone(local);
    other.settings["premium"] = true;
    other.settings["pin"] = "1111";
    other.settings["biometricCredentialId"] = "abc";
    const diff = diffBackups(local, other);
    expect(diff.settings.changedKeys).toEqual(["premium"]);
    expect(diff.hasLocalOnly || diff.hasOtherOnly || diff.hasChanged).toBe(false);
    expect(diff.identical).toBe(false);
  });

  it("verändert keine der Eingaben", () => {
    const local = fixture();
    const other = clone(local);
    other.shifts.pop();
    local.settings["pin"] = "1234";
    const snapshotA = JSON.stringify(local);
    const snapshotB = JSON.stringify(other);
    diffBackups(local, other);
    fullFingerprint(local);
    buildManifest(other);
    validateIntegrity(local);
    isUserDataEmpty(other);
    expect(JSON.stringify(local)).toBe(snapshotA);
    expect(JSON.stringify(other)).toBe(snapshotB);
  });

  it("deterministisch sortierte Ausgabe; keine Zusammenführung (nur Beschreibung)", () => {
    const local = fixture();
    local.shifts.push({ id: "z" }, { id: "a" });
    const diff = diffBackups(local, { shifts: [] } as BackupLike);
    expect(diff.collections.shifts.onlyLocal).toEqual(["a", "s1", "s2", "z"]);
  });
});

describe("validateIntegrity", () => {
  it("meldet die verwaiste Zahlung, ohne etwas zu verändern", () => {
    const data = fixture();
    data.payments[0]!["jobId"] = "mu1r3ruh-q2zyif";
    const before = JSON.stringify(data);
    const issues = validateIntegrity(data);
    expect(issues).toContainEqual({
      code: "payment-job-missing",
      collection: "payments",
      id: "pay1",
      reference: "mu1r3ruh-q2zyif",
    });
    expect(JSON.stringify(data)).toBe(before);
  });

  it("meldet alle Referenz- und Id-Probleme", () => {
    const data = fixture();
    data.shifts.push({ id: "s3", jobId: "fehlt-job", objectId: "fehlt-obj" });
    data.goals[0]!["jobId"] = "fehlt-job";
    data.jobs.push({ id: "j1", name: "doppelt" });
    data.settings["activeJobId"] = "fehlt-aktiv";
    const codes = validateIntegrity(data)
      .map((i) => i.code)
      .sort();
    expect(codes).toEqual(
      [
        "activeJob-missing",
        "duplicate-id",
        "goal-job-missing",
        "shift-job-missing",
        "shift-object-missing",
      ].sort(),
    );
  });

  it("konsistente Daten → keine Befunde; null → keine Befunde", () => {
    expect(validateIntegrity(fixture())).toEqual([]);
    expect(validateIntegrity(null)).toEqual([]);
  });

  it("Datensätze ohne Id werden als missing-id gemeldet", () => {
    const data = fixture();
    data.customers.push({ name: "ohne id" });
    expect(validateIntegrity(data)).toContainEqual({ code: "missing-id", collection: "customers" });
  });
});

describe("isUserDataEmpty", () => {
  it("true nur, wenn alle acht Sammlungen leer sind (Einstellungen zählen nicht)", () => {
    expect(isUserDataEmpty({})).toBe(true);
    expect(isUserDataEmpty({ settings: { onboarded: true, defaultRate: 99 } })).toBe(true);
    const empty = Object.fromEntries(COLLECTION_NAMES.map((n) => [n, []])) as BackupLike;
    expect(isUserDataEmpty(empty)).toBe(true);
  });

  it.each(COLLECTION_NAMES)("ein einziger Datensatz in %s macht das Gerät nicht leer", (name) => {
    const data = Object.fromEntries(COLLECTION_NAMES.map((n) => [n, []])) as BackupLike;
    (data as Record<string, unknown>)[name] = [{ id: "x" }];
    expect(isUserDataEmpty(data)).toBe(false);
  });

  it("ein vom Assistenten angelegter Job zählt als Nutzerdaten", () => {
    expect(
      isUserDataEmpty({
        jobs: [{ id: "wizard-job", name: "Erster Job" }],
        settings: { onboarded: false },
      }),
    ).toBe(false);
  });

  it("nur Nicht-Schicht-Daten (Zahlung/Ziel/Objekt) reichen – kein 'hasLocalWorkData'-Ersatz", () => {
    expect(isUserDataEmpty({ shifts: [], jobs: [], payments: [{ id: "p" }] })).toBe(false);
    expect(isUserDataEmpty({ shifts: [], jobs: [], goals: [{ id: "g" }] })).toBe(false);
    expect(isUserDataEmpty({ shifts: [], jobs: [], objects: [{ id: "o" }] })).toBe(false);
  });

  it("kaputte Sammlung oder fehlende Daten sind nicht 'nachweislich leer'", () => {
    expect(isUserDataEmpty({ shifts: "kaputt" } as unknown as BackupLike)).toBe(false);
    expect(isUserDataEmpty({ goals: {} } as unknown as BackupLike)).toBe(false);
    expect(isUserDataEmpty(null)).toBe(false);
    expect(isUserDataEmpty(undefined)).toBe(false);
  });
});
