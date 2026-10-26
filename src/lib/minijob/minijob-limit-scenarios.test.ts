/**
 * Minijob-Grenze: Regressionsszenarien für mehrere Jobs und Beschäftigungsarten.
 * Prüft die Rechtsschicht (limits.monthUsage) und den KI-Kontext gemeinsam,
 * damit beide dieselbe Population (nur Minijobs) gegen die Grenze rechnen.
 * Stichtag 26.10.2026; Grenze aus den hinterlegten Regelversionen.
 */
import { describe, expect, it } from "vitest";

import { buildAssistantContext } from "./ai-context";
import { minimumWageFor } from "./legal";
import { monthUsage, monthlyLimitOf } from "./limits";
import { makeResolver } from "./resolve";
import { normalize } from "./store";
import { DEFAULT_SETTINGS, type AppData, type Job, type Shift } from "./types";

const TODAY = "2026-10-26";
const NOW = new Date(2026, 9, 26);
const LIMIT = monthlyLimitOf(DEFAULT_SETTINGS, 2026, 9);
// Werktage im Oktober 2026 bis zum Stichtag, ohne 03.10. (Feiertag) und Wochenenden.
const WORKDAYS = ["01", "02", "05", "06", "07", "08", "09", "12", "13", "14", "15", "16"];

const job = (
  id: string,
  rate: number,
  employmentType: NonNullable<Job["employmentType"]>,
): Job => ({
  id,
  name: id,
  color: "#0d9488",
  mode: "flex",
  rate,
  employmentType,
  startDate: "2025-01-01",
});

/** `days` Schichten à 4 h (09:00–13:00) für einen Job. */
function shifts(jobId: string, days: number): Shift[] {
  return WORKDAYS.slice(0, days).map((d) => ({
    id: `${jobId}-${d}`,
    kind: "arbeit",
    date: `2026-10-${d}`,
    start: "09:00",
    end: "13:00",
    breakMinutes: 0,
    jobId,
  }));
}

function appData(jobs: Job[], list: Shift[], settings = DEFAULT_SETTINGS): AppData {
  return {
    shifts: list,
    jobs,
    customers: [],
    projects: [],
    payments: [],
    goals: [],
    orders: [],
    objects: [],
    settings: { ...settings },
    timer: null,
  };
}

function evaluate(data: AppData) {
  const usage = monthUsage(
    data.shifts,
    makeResolver(data.jobs, data.settings),
    data.settings,
    2026,
    9,
    TODAY,
  );
  const ctx = JSON.parse(buildAssistantContext(data, NOW));
  return { usage, ctx, f: ctx.forecast };
}

const MJ_A = job("MJ_A", 13.9, "minijob");
const MJ_B = job("MJ_B", 15, "minijob");
const HB = job("HB", 20, "hauptbeschaeftigung");

describe("Minijob-Grenze — Szenarien", () => {
  it("sanity: Oktober 2026 nutzt die gesetzliche Grenze", () => {
    expect(LIMIT).toBe(603);
  });

  it("1) ein Minijob unter der Monatsgrenze", () => {
    const { usage, f } = evaluate(appData([MJ_A], shifts("MJ_A", 5))); // 20 h × 13,90 €
    expect(usage.earnings).toBe(278);
    expect(usage.earningsLeft).toBe(325);
    expect(usage.earningsShare).toBeLessThan(100);
    expect(f.minijobEarningsEntered).toBe(278);
    expect(f.remainingLimitAmount).toBe(325);
  });

  it("2) zwei Minijobs werden zusammengerechnet und überschreiten die Grenze", () => {
    const data = appData([MJ_A, MJ_B], [...shifts("MJ_A", 6), ...shifts("MJ_B", 5)]);
    const { usage, f } = evaluate(data); // 24 h × 13,90 + 20 h × 15 = 333,60 + 300
    expect(usage.earnings).toBe(633.6);
    expect(usage.earningsShare).toBeGreaterThan(100);
    expect(usage.earningsLeft).toBe(0);
    expect(f.minijobEarningsEntered).toBe(633.6);
    expect(f.remainingLimitAmount).toBe(0);
  });

  it("3) Hauptbeschäftigung + ein Minijob: HB-Gehalt zählt nicht zur Minijob-Summe", () => {
    const data = appData([HB, MJ_A], [...shifts("HB", 12), ...shifts("MJ_A", 5)]);
    const { usage, ctx, f } = evaluate(data); // HB 48 h × 20 € = 960 €
    expect(usage.earnings).toBe(278);
    // Der Gesamtverdienst bleibt sichtbar …
    expect(ctx.currentMonth.earnings).toBe(1238);
    expect(f.recordedToDate.earnings).toBe(1238);
    // … aber Grenze und Spielraum beziehen sich nur auf den Minijob.
    expect(f.minijobEarningsEntered).toBe(278);
    expect(f.remainingLimitAmount).toBe(325);
    expect(ctx.jobs.find((j: { id: string }) => j.id === "HB").minijobLimitApplies).toBe(false);
    expect(f.rules.join(" ")).toMatch(/Hauptbeschäftigung .* zählt nicht zur Grenze/);
  });

  it("4) Hauptbeschäftigung + zwei Minijobs: dokumentiert das aktuelle Verhalten", () => {
    // Aktuell: beide Minijobs werden gegen EINE Grenze zusammengerechnet, die
    // Hauptbeschäftigung bleibt außen vor. Ob neben einer Hauptbeschäftigung nur
    // der zeitlich erste Minijob geringfügig bleibt, bildet die App bisher nicht
    // ab — das ist eine offene fachliche Entscheidung (siehe Bericht).
    const data = appData(
      [HB, MJ_A, MJ_B],
      [...shifts("HB", 12), ...shifts("MJ_A", 5), ...shifts("MJ_B", 5)],
    );
    const { usage, f } = evaluate(data);
    expect(usage.earnings).toBe(578); // 278 + 300, ohne HB
    expect(f.minijobEarningsEntered).toBe(578);
    expect(f.remainingLimitAmount).toBe(25);
  });

  it("5) unterschiedliche Stundensätze: Stundengrenze je Job nach eigenem Satz", () => {
    const data = appData([MJ_A, MJ_B], [...shifts("MJ_A", 2), ...shifts("MJ_B", 2)]);
    const { usage, ctx } = evaluate(data);
    const hoursOf = (id: string) =>
      ctx.jobs.find((j: { id: string }) => j.id === id).monthlyHoursLimit;
    expect(hoursOf("MJ_A")).toBe(Number((LIMIT / 13.9).toFixed(2))); // 43,38 h
    expect(hoursOf("MJ_B")).toBe(Number((LIMIT / 15).toFixed(2))); // 40,2 h
    // Keine künstliche gemeinsame Stundengrenze bei verschiedenen Sätzen.
    expect(ctx.settings.automaticMonthlyHours).toBeNull();
    expect(usage.hoursLimit).toBe(0);
  });

  it("5b) ein Minijob mit eigenem Satz: Stundengrenze nicht aus settings.defaultRate", () => {
    const data = appData([MJ_B], shifts("MJ_B", 2), { ...DEFAULT_SETTINGS, defaultRate: 12 });
    const { usage, ctx } = evaluate(data);
    expect(ctx.settings.automaticMonthlyHours).toBe(Number((LIMIT / 15).toFixed(2)));
    expect(usage.hoursLimit).toBeCloseTo(LIMIT / 15, 6);
    expect(ctx.settings.automaticMonthlyHours).not.toBe(Number((LIMIT / 12).toFixed(2)));
  });

  it("5c) Hauptbeschäftigung bekommt keine Minijob-Stundengrenze", () => {
    const { ctx } = evaluate(appData([HB, MJ_A], shifts("MJ_A", 1)));
    const hb = ctx.jobs.find((j: { id: string }) => j.id === "HB");
    expect(hb.monthlyHoursLimit).toBeNull();
    expect(ctx.settings.automaticMonthlyHours).toBe(Number((LIMIT / 13.9).toFixed(2)));
  });

  it("6) Standard-Stundensatz = Mindestlohn der zum Stichtag gültigen Regelversion", () => {
    expect(DEFAULT_SETTINGS.defaultRate).toBe(minimumWageFor(TODAY));
  });

  it("7) gespeicherte Sätze werden nicht überschrieben", () => {
    const stored = normalize({
      settings: { ...DEFAULT_SETTINGS, defaultRate: 12.82 },
      jobs: [{ ...MJ_A, rate: 12.5 }],
    });
    expect(stored.settings.defaultRate).toBe(12.82);
    expect(stored.jobs[0]!.rate).toBe(12.5);

    const data = appData([{ ...MJ_A, rate: 12.5 }], shifts("MJ_A", 1), {
      ...DEFAULT_SETTINGS,
      defaultRate: 12.82,
    });
    const ctx = JSON.parse(buildAssistantContext(data, NOW));
    expect(ctx.settings.hourlyRate).toBe(12.82);
    expect(ctx.jobs[0].hourlyRate).toBe(12.5);
    // Kontextaufbau verändert die Eingabedaten nicht.
    expect(data.jobs[0]!.rate).toBe(12.5);
    expect(data.settings.defaultRate).toBe(12.82);
  });
});
