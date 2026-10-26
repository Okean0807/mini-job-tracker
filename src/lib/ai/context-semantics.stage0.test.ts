/**
 * Stage 0 (AI context semantics): the system instruction explains which aggregates may
 * contain future-dated entries. Documentation/instruction only: the context values, the
 * privacy gate (ALLOWED_CONTEXT_KEYS) and the forecast schema are pinned unchanged here.
 */
import { describe, expect, it } from "vitest";

import { buildAssistantContext } from "@/lib/minijob/ai-context";
import { DEFAULT_SETTINGS, type AppData, type Job, type Shift } from "@/lib/minijob/types";

import { checkForecastBlock } from "./forecast-context-schema";
import { buildSystemInstruction } from "./gemini-provider";
import { ALLOWED_CONTEXT_KEYS, checkContext } from "./health-privacy-gate";

const prompt = buildSystemInstruction("Deutsch");

/** Instruction sentences that existed before Stage 0 (verbatim, in this order). */
const PRE_STAGE0_SENTENCES: string[] = [
  "Du bist KEIN Anwalt und gibst keine Rechtsberatung. Unterscheide ausdrücklich zwischen allgemeiner Information und rechtlicher Beratung. ",
  "Erfinde niemals Gesetze, Paragraphen, Grenzwerte, Urteile oder URLs. ",
  "Wenn dir Suchergebnisse bereitgestellt werden, stütze aktuelle Grenzwerte und Rechtsangaben bevorzugt darauf und nenne nur URLs aus diesen Ergebnissen. ",
  "Bevorzuge Tier1-offizielle Quellen; bei Widersprüchen zuerst offizielle Behördenquellen, dann die frischere Angabe. Social/UGC nie als primäre Rechtsgrundlage. ",
  "Behaupte niemals „web-geprüft“ / „aktuell geprüft“, wenn keine Suchergebnisse vorliegen. ",
  "Wenn Suchergebnisse vorliegen, strukturiere die Antwort idealerweise mit: 🌐 Aktuell geprüft (oder 🔎 Aktuelle Information), 📊 Deine Daten (wenn Nutzer-Stunden/Verdienst in der Datenbasis vorkommen), 📈 Einschätzung. ",
  "Wenn keine Suchergebnisse vorliegen, kennzeichne Unsicherheit offen und erfinde keine Quellen. ",
  "Unterscheide bundesweite Regeln von betrieblichen/tariflichen Regelungen. ",
  "Du erhältst die Arbeitszeit-Daten des Nutzers als JSON-Zusammenfassung: nutze sie für persönliche Berechnungen, nenne Zahlen mit Einheit (Stunden bzw. Euro) und weise auf Trends, Muster oder die Minijob-Grenze hin. ",
  "Für jeden Vergleich mit der Minijob-Grenze verwende ausschließlich minijobEarnings/minijobHours; earnings/hours umfassen alle Jobs inklusive Hauptbeschäftigung. ",
  "Wenn multipleMinijobsWithMainJob true ist (Hauptbeschäftigung plus mehrere Minijobs), bewerte minijobEarnings NICHT eindeutig als „über“ oder „unter“ der Grenze: neben einer Hauptbeschäftigung bleibt in der Regel nur der zuerst aufgenommene Minijob geringfügig, weitere werden mit der Hauptbeschäftigung zusammengerechnet. Weise darauf hin und empfiehl eine Prüfung (z. B. Minijob-Zentrale oder Krankenkasse). ",
  "Wenn minijobActivityUncertain true ist, lässt sich anhand der Daten nicht sicher bestimmen, ob mehrere Minijobs neben der Hauptbeschäftigung gleichzeitig ausgeübt wurden: sage ausdrücklich, dass sich nicht bestimmen lässt, ob die Minijob-Grenze überschritten wurde, und bewerte minijobEarnings nicht als „über“ oder „unter“. ",
  "months und historicalYears sind Gesamtsummen ALLER Jobs (inklusive Hauptbeschäftigung); jobs enthält Gesamtsummen je einzelnem Job über alle Zeiträume (nicht nach Monat oder Jahr aufgeteilt, daher nicht grenzrelevant). ",
  "Historischer Gesamtverdienst ist KEIN Minijob-Einkommen: stelle ihn niemals als Minijob-Verdienst dar und ziehe daraus keinen kategorischen Schluss, die Minijob-Grenze sei überschritten oder eingehalten. ",
  "Für vergangene Monate und Jahre liegt kein grenzrelevanter Minijob-Wert vor. Wenn für einen Zeitraum kein getrennter Minijob-Wert (minijobEarnings) vorliegt, sage ausdrücklich, dass sich anhand dieser Daten nicht bestimmen lässt, ob die Minijob-Grenze überschritten wurde. ",
  "Für Prognosen nutze Durchschnitte der vorhandenen Monate und kennzeichne sie als Schätzung. Wenn Daten fehlen, sage das offen. ",
  "Formatierung: einfaches Markdown (fett, Listen). Verwende kein LaTeX und keine Formel-Syntax wie $$…$$, \\(…\\), \\text{…} oder \\frac; schreibe Rechnungen als Klartext, z. B. „Betrag ÷ Tage × Tage ≈ Ergebnis“.",
];

const FORECAST_LINE_START = "Für Prognosen nutze Durchschnitte";
const STAGE0_START = "Datenbasis der Summen:";

describe("Stage 0 instruction: existing rules are preserved", () => {
  it("keeps every pre-Stage-0 sentence verbatim and in order", () => {
    let from = 0;
    for (const sentence of PRE_STAGE0_SENTENCES) {
      const at = prompt.indexOf(sentence, from);
      expect(at, sentence.slice(0, 60)).toBeGreaterThanOrEqual(from);
      from = at + sentence.length;
    }
  });

  it("keeps the O4 rules", () => {
    expect(prompt).toMatch(/ausschließlich minijobEarnings\/minijobHours/);
    expect(prompt).toMatch(/Wenn multipleMinijobsWithMainJob true ist/);
    expect(prompt).toMatch(/Wenn minijobActivityUncertain true ist/);
    expect(prompt).toMatch(/bewerte minijobEarnings NICHT eindeutig/);
    expect(prompt).toMatch(/Historischer Gesamtverdienst ist KEIN Minijob-Einkommen/);
  });
});

describe("Stage 0 instruction: new clauses", () => {
  const stage0 = prompt.slice(prompt.indexOf(STAGE0_START), prompt.indexOf(FORECAST_LINE_START));

  it("sits between the historical rules and the forecast line", () => {
    expect(prompt.indexOf(STAGE0_START)).toBeGreaterThan(
      prompt.indexOf("Für vergangene Monate und Jahre"),
    );
    expect(prompt.indexOf(STAGE0_START)).toBeLessThan(prompt.indexOf(FORECAST_LINE_START));
  });

  it("1: names the aggregates that may contain future-dated entries", () => {
    for (const field of [
      "currentMonth.hours",
      "currentMonth.earnings",
      "currentMonth.entriesCount",
      "year.hours",
      "year.earnings",
      "historicalYears",
      "months",
      "jobs",
    ]) {
      expect(stage0, field).toContain(field);
    }
    expect(stage0).toMatch(/Einträge enthalten, die nach currentDate datiert sind/);
    expect(stage0).toMatch(/das laufende Jahr in historicalYears/);
    expect(stage0).toMatch(/der aktuelle und spätere Monate in months/);
  });

  it("2: values are recorded entries, not necessarily performed work or received money", () => {
    expect(stage0).toMatch(
      /in der App erfassten Einträge wieder, nicht zwingend bereits geleistete Arbeit oder bereits erhaltenes Geld/,
    );
  });

  it("3: never describe future-dated entries as completed work or received income", () => {
    expect(stage0).toMatch(
      /Beschreibe nach currentDate datierte Einträge niemals als erledigte Arbeit oder als erhaltenes Einkommen/,
    );
  });

  it("4: the Minijob fields only use entries up to and including currentDate", () => {
    expect(stage0).toMatch(
      /currentMonth\.minijobEarnings, currentMonth\.minijobHours, year\.minijobEarnings und year\.minijobHours berücksichtigen nur Einträge mit Datum bis einschließlich currentDate/,
    );
  });

  it("5: hours are worked hours, earnings may include absence pay, bases may differ", () => {
    expect(stage0).toMatch(
      /hours sind gearbeitete Stunden; earnings können auch Vergütung für Abwesenheiten enthalten/,
    );
    expect(stage0).toMatch(/nicht davon aus, dass beide Felder dieselbe Grundlage haben/);
  });

  it("6: O4 flags prohibit definitive limit statements from the affected aggregates", () => {
    expect(stage0).toMatch(
      /Treffen die Kennzeichen multipleMinijobsWithMainJob oder minijobActivityUncertain zu, triff aus den betroffenen Minijob-Werten keine endgültige Aussage zum Stand der Minijob-Grenze/,
    );
  });

  it("7: no planned Minijob earnings may be estimated, not even from expectedAdditional", () => {
    expect(stage0).toMatch(
      /Schätze, ergänze oder folgere keinen geplanten Minijob-Verdienst, auch nicht aus expectedAdditional/,
    );
  });

  it("8: uncertainty about planned vs. completed must be stated, not guessed", () => {
    expect(stage0).toMatch(
      /nicht hervorgeht, ob ein Eintrag geplant oder bereits erledigt ist, sage das ausdrücklich und rate nicht/,
    );
  });

  it("adds no legal claim: no statute, no number, no money amount", () => {
    expect(stage0).not.toMatch(/§|SGB|Minijob-Zentrale|Rentenversicherung/);
    expect(stage0).not.toMatch(/\d/);
    expect(stage0).not.toMatch(/€|Euro/);
  });

  it("does not mention Stage 1/2 or forecast fields", () => {
    expect(prompt).not.toMatch(
      /entryBasis|recordedToDate|plannedAfterToday|paceProjection|forecast\./,
    );
  });

  it("has no missing space between sentences", () => {
    expect(stage0).not.toMatch(/[a-zäöüß]\.[A-ZÄÖÜ]/);
  });
});

const mj = (id: string, startDate: string): Job => ({
  id,
  name: id,
  color: "#000",
  mode: "flex",
  employmentType: "minijob",
  rate: 14,
  startDate,
});
const hb: Job = {
  id: "hb",
  name: "HB",
  color: "#111",
  mode: "fest",
  employmentType: "hauptbeschaeftigung",
  rate: 20,
};
const shift = (id: string, date: string, jobId: string): Shift => ({
  id,
  date,
  jobId,
  start: "08:00",
  end: "12:00",
  kind: "arbeit",
  breakMinutes: 0,
});
const data = (jobs: Job[], shifts: Shift[]): AppData => ({
  shifts,
  jobs,
  customers: [],
  projects: [],
  payments: [],
  goals: [],
  orders: [],
  objects: [],
  settings: { ...DEFAULT_SETTINGS, defaultRate: 14 },
  timer: null,
});
const NOW = new Date("2026-10-10T12:00:00");
const SHIFTS = [
  shift("lastyear", "2025-06-01", "j1"),
  shift("sep", "2026-09-15", "j1"),
  shift("past", "2026-10-05", "j1"),
  shift("hbpast", "2026-10-06", "hb"),
  shift("today", "2026-10-10", "j1"),
  shift("future", "2026-10-20", "j1"),
  shift("hbfuture", "2026-10-21", "hb"),
  shift("nov", "2026-11-03", "j1"),
];

describe("Stage 0: context construction is unchanged", () => {
  const ctx = JSON.parse(buildAssistantContext(data([mj("j1", "2025-01-01"), hb], SHIFTS), NOW));

  it("has exactly the existing keys at every level (no entryBasis, no forecast)", () => {
    expect(Object.keys(ctx)).toEqual([
      "currentDate",
      "settings",
      "currentMonth",
      "year",
      "historicalYears",
      "months",
      "jobs",
    ]);
    expect(Object.keys(ctx.settings)).toEqual([
      "hourlyRate",
      "legalMonthlyLimit",
      "automaticMonthlyHours",
      "annualLimit",
      "workMode",
      "minijobLimitApplies",
    ]);
    expect(Object.keys(ctx.currentMonth)).toEqual([
      "year",
      "month",
      "monthName",
      "hours",
      "earnings",
      "minijobEarnings",
      "minijobHours",
      "multipleMinijobsWithMainJob",
      "minijobActivityUncertain",
      "entriesCount",
    ]);
    expect(Object.keys(ctx.year)).toEqual([
      "year",
      "hours",
      "earnings",
      "minijobEarnings",
      "minijobHours",
      "multipleMinijobsWithMainJob",
      "minijobActivityUncertain",
    ]);
    expect(Object.keys(ctx.historicalYears[0])).toEqual(["year", "hours", "earnings"]);
    expect(Object.keys(ctx.months[0])).toEqual([
      "year",
      "month",
      "monthName",
      "hours",
      "earnings",
      "entriesCount",
    ]);
    expect(Object.keys(ctx.jobs[0])).toEqual([
      "id",
      "name",
      "mode",
      "hourlyRate",
      "hours",
      "earnings",
      "employmentType",
      "minijobLimitApplies",
    ]);
  });

  it("keeps the documented semantics: whole-period totals include future entries, Minijob values stop at currentDate", () => {
    // Whole October: 3 Minijob + 2 HB entries = 3 x 56 + 2 x 80, planned ones included.
    expect(ctx.currentDate).toBe("2026-10-10");
    expect(ctx.currentMonth).toMatchObject({ hours: 20, earnings: 328, entriesCount: 5 });
    // Minijob values: only 2026-10-05 and 2026-10-10 (today counts as recorded).
    expect(ctx.currentMonth).toMatchObject({
      minijobHours: 8,
      minijobEarnings: 112,
      multipleMinijobsWithMainJob: false,
      minijobActivityUncertain: false,
    });
    expect(ctx.year).toMatchObject({
      hours: 28,
      earnings: 440,
      minijobHours: 12,
      minijobEarnings: 168,
    });
    expect(
      ctx.historicalYears.map((y: { year: number; hours: number; earnings: number }) => [
        y.year,
        y.hours,
        y.earnings,
      ]),
    ).toEqual([
      [2024, 0, 0],
      [2025, 4, 56],
      [2026, 28, 440],
    ]);
    expect(
      ctx.months.map(
        (m: { month: number; hours: number; earnings: number; entriesCount: number }) => [
          m.month + 1,
          m.hours,
          m.earnings,
          m.entriesCount,
        ],
      ),
    ).toEqual([
      [9, 4, 56, 1],
      [10, 20, 328, 5],
      [11, 4, 56, 1],
    ]);
    expect(
      ctx.jobs.map((j: { id: string; hours: number; earnings: number }) => [
        j.id,
        j.hours,
        j.earnings,
      ]),
    ).toEqual([
      ["j1", 24, 336],
      ["hb", 8, 160],
    ]);
  });

  it("O4 constellation still sets the flags and still reports the summed Minijob values", () => {
    const o4 = JSON.parse(
      buildAssistantContext(
        data(
          [mj("j1", "2025-01-01"), mj("j2", "2026-01-01"), hb],
          [...SHIFTS, shift("j2past", "2026-10-07", "j2"), shift("j2future", "2026-10-22", "j2")],
        ),
        NOW,
      ),
    );
    expect(o4.currentMonth).toMatchObject({
      multipleMinijobsWithMainJob: true,
      minijobEarnings: 168,
      minijobHours: 12,
    });
    expect(o4.year.multipleMinijobsWithMainJob).toBe(true);
  });

  it("passes the unchanged privacy gate", () => {
    expect(checkContext(JSON.stringify(ctx))).toEqual({ allowed: true });
  });
});

describe("Stage 0: privacy gate and forecast schema are unchanged", () => {
  it("global allowlist is exactly the pre-Stage-0 set", () => {
    expect([...ALLOWED_CONTEXT_KEYS].sort()).toEqual(
      [
        "currentDate",
        "settings",
        "hourlyRate",
        "legalMonthlyLimit",
        "automaticMonthlyHours",
        "annualLimit",
        "workMode",
        "minijobLimitApplies",
        "currentMonth",
        "year",
        "month",
        "monthName",
        "hours",
        "earnings",
        "minijobEarnings",
        "minijobHours",
        "multipleMinijobsWithMainJob",
        "minijobActivityUncertain",
        "entriesCount",
        "historicalYears",
        "months",
        "jobs",
        "id",
        "name",
        "mode",
        "employmentType",
      ].sort(),
    );
  });

  it("still rejects entryBasis and forecast blocks (nothing from Stage 1/2 is wired)", () => {
    for (const key of ["entryBasis", "forecast"]) {
      expect(
        checkContext(JSON.stringify({ currentDate: "2026-10-10", [key]: { hours: 1 } })),
      ).toMatchObject({
        allowed: false,
        code: "CONTEXT_INVALID",
      });
    }
  });

  it("forecast schema behaves as before", () => {
    expect(checkForecastBlock(undefined)).toEqual({ ok: true, forecast: undefined });
    expect(checkForecastBlock({})).toEqual({ ok: false, reason: "forecast_invalid" });
    expect(
      checkForecastBlock({ plannedAfterToday: { entriesCount: 0, hours: 0, earnings: 0 } }).ok,
    ).toBe(false);
  });
});
