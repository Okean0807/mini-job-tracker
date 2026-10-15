/**
 * QA R1 (#142): P2-142-b O4-Abgleich mit #145, P3-142-a Tippfehler,
 * P3-142-b Testlücken (Jahr ≠ Monat, Prompt, currentDate), Vormonate (N2).
 */
import { describe, expect, it } from "vitest";

import { buildSystemInstruction } from "../ai/gemini-provider";
import { buildAssistantContext } from "./ai-context";
import { DEFAULT_SETTINGS, type AppData, type Job, type Shift } from "./types";

const HB: Job = {
  id: "hb",
  name: "HB",
  color: "#111",
  mode: "fest",
  employmentType: "hauptbeschaeftigung",
  rate: 25,
};
const MJ_A: Job = {
  id: "mj-a",
  name: "A",
  color: "#000",
  mode: "flex",
  employmentType: "minijob",
  rate: 20,
  startDate: "2026-01-01",
};
const MJ_B: Job = {
  id: "mj-b",
  name: "B",
  color: "#222",
  mode: "flex",
  employmentType: "minijob",
  rate: 25,
  startDate: "2026-03-01",
};

const shift = (id: string, jobId: string, date: string, hours: number): Shift => ({
  id,
  jobId,
  kind: "arbeit",
  date,
  start: "08:00",
  end: `${String(8 + hours).padStart(2, "0")}:00`,
  breakMinutes: 0,
});

function data(jobs: Job[], shifts: Shift[]): AppData {
  return {
    shifts,
    jobs,
    customers: [],
    projects: [],
    payments: [],
    goals: [],
    orders: [],
    objects: [],
    settings: { ...DEFAULT_SETTINGS, limitAuto: true },
    timer: null,
  } as AppData;
}

const ctx = (jobs: Job[], shifts: Shift[], now: Date) =>
  JSON.parse(buildAssistantContext(data(jobs, shifts), now));

// DECISIONS-Beispiel: HB + MJ-A 400 € + MJ-B 250 € im September 2026.
const SEPT = [
  shift("h", "hb", "2026-09-09", 8),
  shift("a1", "mj-a", "2026-09-10", 10),
  shift("a2", "mj-a", "2026-09-17", 10),
  shift("b", "mj-b", "2026-09-11", 10),
];
const NOW = new Date("2026-09-30T12:00:00");

describe("P2-142-b: O4 im KI-Kontext", () => {
  it("HB + 2 Minijobs: 650 € > 603 €, aber Flag gesetzt (kein eindeutiges 'überschritten')", () => {
    const c = ctx([HB, MJ_A, MJ_B], SEPT, NOW);
    expect(c.currentMonth.minijobEarnings).toBe(650);
    expect(c.settings.legalMonthlyLimit).toBe(603);
    expect(c.currentMonth.multipleMinijobsWithMainJob).toBe(true);
    expect(c.year.multipleMinijobsWithMainJob).toBe(true);
  });

  it("einzelner Minijob neben HB: Flag false", () => {
    const c = ctx([HB, MJ_A], SEPT.slice(0, 3), NOW);
    expect(c.currentMonth.multipleMinijobsWithMainJob).toBe(false);
    expect(c.year.multipleMinijobsWithMainJob).toBe(false);
  });

  it("2 Minijobs ohne HB: Flag false (Summe gegen eine Grenze, unverändert)", () => {
    const c = ctx([MJ_A, MJ_B], SEPT.slice(1), NOW);
    expect(c.currentMonth.minijobEarnings).toBe(650);
    expect(c.currentMonth.multipleMinijobsWithMainJob).toBe(false);
  });

  it("inaktiver zweiter Minijob (keine Einträge) zählt nicht", () => {
    const c = ctx([HB, MJ_A, MJ_B], SEPT.slice(0, 3), NOW);
    expect(c.currentMonth.multipleMinijobsWithMainJob).toBe(false);
  });

  it("Monat vs. Jahr: zweiter Minijob nur im März → Monat false, Jahr true", () => {
    const shifts = [...SEPT.slice(0, 3), shift("b3", "mj-b", "2026-03-11", 4)];
    const c = ctx([HB, MJ_A, MJ_B], shifts, NOW);
    expect(c.currentMonth.multipleMinijobsWithMainJob).toBe(false);
    expect(c.year.multipleMinijobsWithMainJob).toBe(true);
  });

  it("ohne Minijob-Grenze: Flags false", () => {
    const c = ctx([HB], [SEPT[0]!], NOW);
    expect(c.currentMonth.minijobEarnings).toBeNull();
    expect(c.currentMonth.multipleMinijobsWithMainJob).toBe(false);
  });
});

describe("Vormonate (N2: Summen aller Jobs bleiben)", () => {
  it("August (Vormonat) in months[] = alle Jobs inkl. HB, ohne Minijob-Aufteilung", () => {
    const shifts = [
      shift("h8", "hb", "2026-08-05", 8), // 200 €
      shift("a8", "mj-a", "2026-08-06", 10), // 200 €
      ...SEPT,
    ];
    const c = ctx([HB, MJ_A, MJ_B], shifts, NOW);
    const aug = c.months.find((m: { month: number }) => m.month === 7);
    expect(aug.earnings).toBe(400);
    expect(aug).not.toHaveProperty("minijobEarnings");
    expect(aug).not.toHaveProperty("multipleMinijobsWithMainJob");
    const y = c.historicalYears.find((h: { year: number }) => h.year === 2026);
    expect(y.earnings).toBe(c.year.earnings);
  });

  it("Jahr ≠ Monat: year.minijobEarnings summiert Vormonate, currentMonth nur September (M142-2)", () => {
    const shifts = [shift("a3", "mj-a", "2026-03-10", 5), ...SEPT.slice(0, 3)]; // März 100 €, Sept 400 €
    const c = ctx([HB, MJ_A], shifts, NOW);
    expect(c.currentMonth.minijobEarnings).toBe(400);
    expect(c.year.minijobEarnings).toBe(500);
  });

  it("currentDate ist die Grenze für minijobEarnings, nicht die Systemzeit (M142-3)", () => {
    const shifts = [shift("p", "mj-a", "2026-03-05", 5), shift("f", "mj-a", "2026-03-20", 5)];
    const c = ctx([MJ_A], shifts, new Date("2026-03-10T12:00:00"));
    expect(c.currentDate).toBe("2026-03-10");
    expect(c.currentMonth.minijobEarnings).toBe(100);
    expect(c.currentMonth.earnings).toBe(200);
  });
});

describe("Prompt (M142-5, P3-142-a)", () => {
  const prompt = buildSystemInstruction("Deutsch");
  it("verlangt minijobEarnings für Grenzvergleiche", () => {
    expect(prompt).toMatch(/ausschließlich minijobEarnings\/minijobHours/);
  });
  it("verbietet bei multipleMinijobsWithMainJob eine eindeutige Über/Unter-Aussage", () => {
    expect(prompt).toMatch(/multipleMinijobsWithMainJob true/);
    expect(prompt).toMatch(/NICHT eindeutig/);
  });
  it("kein fehlendes Leerzeichen zwischen Sätzen ('hin.Für')", () => {
    expect(prompt).not.toMatch(/hin\.Für/);
    expect(prompt).not.toMatch(/[a-zäöü]\.[A-ZÄÖÜ]/);
  });
});
