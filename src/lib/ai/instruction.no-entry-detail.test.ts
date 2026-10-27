/**
 * The assistant only receives aggregates and entriesCount (never single shifts). The system
 * instruction must stop it from inventing per-entry values, passing off entriesCount averages as
 * facts, or claiming an independent Dashboard check, and must point to the Übersicht instead.
 * The context contract and the privacy gate allowlist are pinned unchanged here.
 */
import { describe, expect, it } from "vitest";

import { buildAssistantContext } from "@/lib/minijob/ai-context";
import { DEFAULT_SETTINGS, type AppData, type Job, type Shift } from "@/lib/minijob/types";

import { buildSystemInstruction } from "./gemini-provider";
import { ALLOWED_CONTEXT_KEYS, checkContext } from "./health-privacy-gate";

const prompt = buildSystemInstruction("Deutsch");

const BLOCK_START = "Einzelne Einträge:";
const FORECAST_LINE_START = "Für Prognosen nutze Durchschnitte";
const STAGE0_START = "Datenbasis der Summen:";
const block = prompt.slice(prompt.indexOf(BLOCK_START), prompt.indexOf(FORECAST_LINE_START));

describe("no-entry-detail instruction block", () => {
  it("is present exactly once, after the Datenbasis block and before the forecast line", () => {
    expect(prompt.split(BLOCK_START)).toHaveLength(2);
    expect(prompt.indexOf(BLOCK_START)).toBeGreaterThan(prompt.indexOf(STAGE0_START));
    expect(prompt.indexOf(BLOCK_START)).toBeLessThan(prompt.indexOf(FORECAST_LINE_START));
    expect(block.length).toBeGreaterThan(0);
  });

  it("1: states that only aggregates and the entry count are provided", () => {
    expect(block).toMatch(/nur aggregierte Summen und die Anzahl der Einträge \(entriesCount\)/);
    expect(block).toMatch(/keine einzelnen Schichten oder Einträge/);
  });

  it("2: forbids inventing per-entry values, times, breaks or other missing data", () => {
    expect(block).toMatch(/Erfinde keine Werte einzelner Einträge/);
    expect(block).toMatch(/keine Beginn- und Endzeiten, keine Pausen/);
    expect(block).toMatch(/nicht in der Datenbasis stehen/);
  });

  it("3: forbids dividing sums by entriesCount and presenting that as actual entry data", () => {
    expect(block).toMatch(
      /Teile Summen von Stunden oder Verdienst nicht durch entriesCount und gib das Ergebnis nicht als tatsächliche Werte einzelner Einträge aus/,
    );
  });

  it("4: allows an explicitly requested average, labelled as a calculated average", () => {
    expect(block).toMatch(
      /Nur wenn der Nutzer ausdrücklich einen Durchschnitt je Eintrag verlangt/,
    );
    expect(block).toMatch(/arithmetischen Durchschnitt je Eintrag nennen/);
    expect(block).toMatch(/als rechnerischen Durchschnitt je Eintrag kennzeichnen/);
    expect(block).toMatch(/nicht als tatsächliche Daten der einzelnen Einträge/);
  });

  it("5: forbids claiming an independent Dashboard reconciliation that did not happen", () => {
    expect(block).toMatch(
      /Behaupte nicht, eine Summe sei unabhängig mit dem Dashboard abgeglichen oder bestätigt, solange kein echter Abgleich stattgefunden hat/,
    );
    expect(block).toMatch(/Nenne nur die Werte aus der Datenbasis und weise auf die Grenzen hin/);
  });

  it("6: for a per-entry breakdown, explains the limit and points to the Übersicht", () => {
    expect(block).toMatch(/Aufstellung einzelner Einträge verlangt/);
    expect(block).toMatch(/dir diese Einzeldaten nicht vorliegen/);
    expect(block).toMatch(/verweise auf die Übersicht in der App/);
    expect(block).toMatch(/als Liste oder Kalender/);
  });

  it("names no screen, route or feature beyond the Übersicht", () => {
    expect(block).not.toMatch(/\/[a-z]/i);
    expect(block).not.toMatch(
      /Statistik|Einstellungen|Jobs|Dokumente|Leistungsnachweis|Arbeitsnachweis|Export|PDF|Menü|Tab\b|Button|Schaltfläche/,
    );
    expect((block.match(/Übersicht/g) ?? []).length).toBe(1);
  });

  it("adds no number, amount or legal claim and has no missing sentence spacing", () => {
    expect(block).not.toMatch(/\d/);
    expect(block).not.toMatch(/€|Euro|§|SGB|Minijob-Zentrale/);
    expect(block).not.toMatch(/[a-zäöüß]\.[A-ZÄÖÜ]/);
  });

  it("keeps the existing rules around it", () => {
    expect(prompt).toMatch(
      /Wenn aus den Daten nicht hervorgeht, ob ein Eintrag geplant oder bereits erledigt ist/,
    );
    expect(prompt).toMatch(/Für Prognosen nutze Durchschnitte der vorhandenen Monate/);
    expect(prompt).toMatch(/Wenn multipleMinijobsWithMainJob true ist/);
  });
});

const job: Job = {
  id: "mj-a",
  name: "mj-a",
  color: "#000",
  mode: "flex",
  employmentType: "minijob",
  rate: 14,
  startDate: "2026-01-01",
};
const shift = (id: string, date: string): Shift => ({
  id,
  date,
  jobId: "mj-a",
  start: "09:00",
  end: "13:00",
  kind: "arbeit",
  breakMinutes: 0,
});
const data: AppData = {
  shifts: [shift("s1", "2026-10-05"), shift("s2", "2026-10-12")],
  jobs: [job],
  customers: [],
  projects: [],
  payments: [],
  goals: [],
  orders: [],
  objects: [],
  settings: { ...DEFAULT_SETTINGS, defaultRate: 14 },
  timer: null,
};

describe("context contract and privacy gate are unchanged", () => {
  const ctx = JSON.parse(buildAssistantContext(data, new Date("2026-10-27T12:00:00")));

  it("context has exactly the known top-level keys and no per-entry data", () => {
    expect(Object.keys(ctx).sort()).toEqual(
      [
        "currentDate",
        "currentMonth",
        "historicalYears",
        "jobs",
        "months",
        "settings",
        "year",
      ].sort(),
    );
    const text = JSON.stringify(ctx);
    expect(text).not.toMatch(/"shifts"|"entries"|"start"|"end"|"breakMin"|"notes?"/);
    expect(ctx.currentMonth.entriesCount).toBe(2);
  });

  it("allowlist is exactly the existing set", () => {
    expect([...ALLOWED_CONTEXT_KEYS].sort()).toEqual(
      [
        "annualLimit",
        "automaticMonthlyHours",
        "currentDate",
        "currentMonth",
        "earnings",
        "employmentType",
        "entriesCount",
        "historicalYears",
        "hours",
        "hourlyRate",
        "id",
        "jobs",
        "legalMonthlyLimit",
        "minijobActivityUncertain",
        "minijobEarnings",
        "minijobHours",
        "minijobLimitApplies",
        "mode",
        "month",
        "monthName",
        "months",
        "multipleMinijobsWithMainJob",
        "name",
        "settings",
        "workMode",
        "year",
      ].sort(),
    );
  });

  it("the gate accepts the built context and still rejects single-shift keys", () => {
    expect(checkContext(JSON.stringify(ctx)).allowed).toBe(true);
    for (const forged of [
      { ...ctx, shifts: [{ date: "2026-10-05", hours: 4 }] },
      { ...ctx, entries: [{ hours: 4 }] },
    ]) {
      const r = checkContext(JSON.stringify(forged));
      expect(r.allowed).toBe(false);
    }
  });
});
