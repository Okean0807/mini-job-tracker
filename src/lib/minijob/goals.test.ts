import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { autoSaved, goalProgress, goalsProgress } from "./goals";
import { makeResolver } from "./resolve";
import {
  DEFAULT_SETTINGS,
  type Goal,
  type Job,
  type Settings,
  type Shift,
} from "./types";

const RATE = 15;

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultRate: RATE,
  bundesland: "NW",
};

const jobA: Job = {
  id: "j1",
  name: "Reinigung",
  color: "#111",
  rate: RATE,
  mode: "flex",
};

const jobB: Job = {
  id: "j2",
  name: "Büro",
  color: "#222",
  rate: 20,
  mode: "flex",
};

const jobs = [jobA, jobB];
const resolve = makeResolver(jobs, settings);

function shift(
  partial: Partial<Omit<Shift, "jobId">> & { date: string; jobId?: string | undefined },
): Shift {
  return {
    id: partial.date + (partial.kind ?? "arbeit") + (partial.jobId ?? "j1"),
    start: "09:00",
    end: "14:00",
    breakMinutes: 0,
    kind: "arbeit",
    jobId: "j1",
    ...partial,
  } as Shift;
}

function goal(partial: Partial<Goal> & Pick<Goal, "id" | "name" | "target" | "kind">): Goal {
  return { ...partial };
}

/** 5h × 15 EUR = 75 EUR pro Schicht bei Job A. */
const shifts = [
  shift({ date: "2026-03-02" }),
  shift({ date: "2026-03-09" }),
  shift({ date: "2026-04-06", jobId: "j2" }), // 5h × 20 = 100
  shift({ date: "2026-05-04" }),
];

describe("autoSaved", () => {
  it("summiert den Verdienst aller Schichten bei Anteil 100", () => {
    const g = goal({ id: "g1", name: "Urlaub", target: 1000, kind: "auto" });
    // 75 + 75 + 100 + 75 = 325
    expect(autoSaved(g, shifts, resolve)).toBeCloseTo(325, 10);
  });

  it("wendet den Anteil (share) an", () => {
    const g = goal({ id: "g1", name: "Urlaub", target: 1000, kind: "auto", share: 50 });
    expect(autoSaved(g, shifts, resolve)).toBeCloseTo(162.5, 10);
  });

  it("filtert nach jobId", () => {
    const g = goal({ id: "g1", name: "JobB", target: 500, kind: "auto", jobId: "j2" });
    expect(autoSaved(g, shifts, resolve)).toBeCloseTo(100, 10);
  });

  it("filtert nach from und deadline", () => {
    const g = goal({
      id: "g1",
      name: "März",
      target: 500,
      kind: "auto",
      from: "2026-03-01",
      deadline: "2026-03-31",
    });
    // nur 02.03 und 09.03 → 150
    expect(autoSaved(g, shifts, resolve)).toBeCloseTo(150, 10);
  });

  it("liefert 0 ohne passende Schichten", () => {
    const g = goal({
      id: "g1",
      name: "Leer",
      target: 100,
      kind: "auto",
      jobId: "missing",
    });
    expect(autoSaved(g, [], resolve)).toBe(0);
    expect(autoSaved(g, shifts, resolve)).toBe(0);
  });
});

describe("goalProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15)); // 2026-03-15
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("nutzt manualSaved bei kind=manual", () => {
    const g = goal({
      id: "g1",
      name: "Manuell",
      target: 200,
      kind: "manual",
      manualSaved: 80,
    });
    const p = goalProgress(g, shifts, jobs, resolve);
    expect(p.saved).toBe(80);
    expect(p.share).toBeCloseTo(40, 10);
    expect(p.remaining).toBe(120);
    expect(p.reached).toBe(false);
  });

  it("behandelt fehlendes manualSaved als 0", () => {
    const g = goal({ id: "g1", name: "Manuell", target: 100, kind: "manual" });
    const p = goalProgress(g, shifts, jobs, resolve);
    expect(p.saved).toBe(0);
    expect(p.share).toBe(0);
    expect(p.remaining).toBe(100);
    expect(p.reached).toBe(false);
  });

  it("berechnet auto-Fortschritt und markiert erreicht", () => {
    const g = goal({ id: "g1", name: "Klein", target: 300, kind: "auto" });
    const p = goalProgress(g, shifts, jobs, resolve);
    expect(p.saved).toBeCloseTo(325, 10);
    expect(p.share).toBeCloseTo((325 / 300) * 100, 10);
    expect(p.remaining).toBe(0);
    expect(p.reached).toBe(true);
  });

  it("liefert share 0 und nicht erreicht bei target <= 0", () => {
    const g = goal({ id: "g1", name: "Null", target: 0, kind: "manual", manualSaved: 50 });
    const p = goalProgress(g, shifts, jobs, resolve);
    expect(p.share).toBe(0);
    expect(p.reached).toBe(false);
    expect(p.remaining).toBe(0);
    expect(p.saved).toBe(50);
  });

  it("hängt den Job an, wenn jobId gesetzt ist", () => {
    const g = goal({
      id: "g1",
      name: "Job",
      target: 100,
      kind: "auto",
      jobId: "j2",
    });
    const p = goalProgress(g, shifts, jobs, resolve);
    expect(p.job).toEqual(jobB);
  });

  it("setzt daysLeft und perMonth anhand der Frist", () => {
    const g = goal({
      id: "g1",
      name: "Frist",
      target: 500,
      kind: "manual",
      manualSaved: 100,
      deadline: "2026-05-14", // 60 Tage ab 15.03.
    });
    const p = goalProgress(g, shifts, jobs, resolve);
    expect(p.daysLeft).toBe(60);
    // remaining 400 / max(1, 60/30.4) ≈ 400 / 1.97368...
    expect(p.perMonth).toBeCloseTo(400 / (60 / 30.4), 6);
  });

  it("setzt kein perMonth bei abgelaufener oder erreichter Frist", () => {
    const past = goal({
      id: "g1",
      name: "Vergangen",
      target: 500,
      kind: "manual",
      manualSaved: 100,
      deadline: "2026-03-01",
    });
    const pastP = goalProgress(past, shifts, jobs, resolve);
    expect(pastP.daysLeft).toBeLessThan(0);
    expect(pastP.perMonth).toBeUndefined();

    const done = goal({
      id: "g2",
      name: "Fertig",
      target: 50,
      kind: "manual",
      manualSaved: 50,
      deadline: "2026-05-14",
    });
    const doneP = goalProgress(done, shifts, jobs, resolve);
    expect(doneP.reached).toBe(true);
    expect(doneP.daysLeft).toBe(60);
    expect(doneP.perMonth).toBeUndefined();
  });
});

describe("goalsProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sortiert offene Ziele vor erreichten, dann nach Frist", () => {
    const list = [
      goal({
        id: "reached-late",
        name: "Erreicht spät",
        target: 10,
        kind: "manual",
        manualSaved: 10,
        deadline: "2026-12-01",
      }),
      goal({
        id: "open-late",
        name: "Offen spät",
        target: 1000,
        kind: "manual",
        manualSaved: 1,
        deadline: "2026-08-01",
      }),
      goal({
        id: "open-soon",
        name: "Offen bald",
        target: 1000,
        kind: "manual",
        manualSaved: 1,
        deadline: "2026-04-01",
      }),
      goal({
        id: "reached-soon",
        name: "Erreicht bald",
        target: 10,
        kind: "manual",
        manualSaved: 10,
        deadline: "2026-05-01",
      }),
      goal({
        id: "open-none",
        name: "Ohne Frist",
        target: 1000,
        kind: "manual",
        manualSaved: 1,
      }),
    ];
    const progress = goalsProgress(list, shifts, jobs, resolve);
    expect(progress.map((p) => p.goal.id)).toEqual([
      "open-soon",
      "open-late",
      "open-none",
      "reached-soon",
      "reached-late",
    ]);
  });

  it("liefert leeres Array ohne Ziele", () => {
    expect(goalsProgress([], shifts, jobs, resolve)).toEqual([]);
  });
});
