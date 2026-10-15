/**
 * Owner R5 – D6 Variante B: Ein Minijob ist in einem Monat aktiv, wenn die
 * Beschäftigung besteht UND Arbeit oder eine bezahlte Abwesenheit vorliegt.
 * Beliebige Einträge (frei/sonstige, unbezahlte Abwesenheit) sind keine
 * Aktivität. Unsichere Bezahlung → expliziter Zustand "uncertain".
 */
import { describe, expect, it } from "vitest";

import { buildAssistantContext } from "./ai-context";
import { annualO4Lines } from "./annual-export";
import { buildAnnualReport } from "./annual";
import {
  limitReliabilityFlags,
  limitReliabilityMonths,
  minijobActivity,
  monthPeriod,
  multipleMinijobMonths,
  o4MonthStatus,
  statusUnreliable,
  uncertainMinijobMonths,
  yearPeriod,
} from "./multi-minijob";
import { makeResolver } from "./resolve";
import { buildSystemInstruction } from "@/lib/ai/gemini-provider";
import { DEFAULT_SETTINGS, type AppData, type Job, type Shift } from "./types";

const day = { start: "09:00", end: "14:00", breakMinutes: 0 };
const MON_FRI = [true, true, true, true, true, false, false].map((active) => ({ active, ...day }));
const mk = (id: string, employmentType: string, extra: Record<string, unknown> = {}): Job =>
  ({
    id,
    name: id,
    color: "#000",
    mode: employmentType === "minijob" ? "flex" : "fest",
    employmentType,
    rate: 15,
    startDate: "2025-01-01",
    week: MON_FRI,
    ...extra,
  }) as unknown as Job;
const HB = mk("hb", "hauptbeschaeftigung");
const A = mk("a", "minijob");
const B = mk("b", "minijob");
const C = mk("c", "minijob");
const e = (
  jobId: string,
  date: string,
  kind: Shift["kind"] = "arbeit",
  extra: Partial<Shift> = {},
) => ({ id: `${jobId}-${date}-${kind}`, jobId, kind, date, ...day, ...extra }) as Shift;
const MARCH = monthPeriod(2026, 2);

describe("minijobActivity (Variante B)", () => {
  it("Arbeit → aktiv", () => {
    expect(minijobActivity(A, [e("a", "2026-03-02")], MARCH)).toBe("active");
  });
  it("Urlaub (bezahlte Abwesenheit) → aktiv", () => {
    expect(minijobActivity(A, [e("a", "2026-03-02", "urlaub")], MARCH)).toBe("active");
  });
  it("Krank an Arbeitstag laut Plan, Beginn bekannt → bezahlt → aktiv", () => {
    expect(minijobActivity(A, [e("a", "2026-03-02", "krank")], MARCH)).toBe("active");
  });
  it("Krank an planfreiem Tag (unbezahlt) → nicht aktiv", () => {
    expect(minijobActivity(A, [e("a", "2026-03-07", "krank")], MARCH)).toBe("inactive");
  });
  it("Krank in der 4-Wochen-Wartezeit (unbezahlt) → nicht aktiv", () => {
    const fresh = mk("a", "minijob", { startDate: "2026-03-01" });
    expect(minijobActivity(fresh, [e("a", "2026-03-10", "krank")], MARCH)).toBe("inactive");
  });
  it("Krank ohne Beschäftigungsbeginn (Wartezeit nicht prüfbar) → unsicher", () => {
    const noStart = mk("a", "minijob", { startDate: undefined });
    expect(minijobActivity(noStart, [e("a", "2026-03-02", "krank")], MARCH)).toBe("uncertain");
  });
  it("Feiertag an Arbeitstag laut Plan → aktiv; ohne Wochenplan (geschätzt) → unsicher", () => {
    expect(minijobActivity(A, [e("a", "2026-04-06", "feiertag")], monthPeriod(2026, 3))).toBe(
      "active",
    );
    const noPlan = mk("a", "minijob", { week: undefined });
    expect(minijobActivity(noPlan, [e("a", "2026-04-06", "feiertag")], monthPeriod(2026, 3))).toBe(
      "uncertain",
    );
  });
  it("frei / sonstige sind keine Aktivität (beliebiger Eintrag reicht nicht mehr)", () => {
    const shifts = [e("a", "2026-03-02", "frei"), e("a", "2026-03-03", "sonstige")];
    expect(minijobActivity(A, shifts, MARCH)).toBe("inactive");
  });
  it("leerer Monat → nicht aktiv", () => {
    expect(minijobActivity(A, [], MARCH)).toBe("inactive");
  });
  it("Einträge vor Beginn / nach Ende der Beschäftigung zählen nicht", () => {
    const late = mk("a", "minijob", { startDate: "2026-03-15" });
    expect(minijobActivity(late, [e("a", "2026-03-02")], MARCH)).toBe("inactive");
    const ended = mk("a", "minijob", { endDate: "2026-03-01" });
    expect(minijobActivity(ended, [e("a", "2026-03-02")], MARCH)).toBe("inactive");
    expect(minijobActivity(ended, [e("a", "2026-03-01", "urlaub")], MARCH)).toBe("active"); // Endtag inklusive
  });
});

describe("Monatsstatus O4 (HB + ≥ 2 aktive Minijobs)", () => {
  it("Arbeit + Urlaub zweier Minijobs neben HB → betroffen", () => {
    const shifts = [e("a", "2026-03-02"), e("b", "2026-03-04", "urlaub")];
    expect(o4MonthStatus([HB, A, B], shifts, MARCH)).toBe("affected");
  });
  it("zweiter Minijob nur 'frei' → nicht betroffen (früher: betroffen)", () => {
    const shifts = [e("a", "2026-03-02"), e("b", "2026-03-04", "frei")];
    expect(o4MonthStatus([HB, A, B], shifts, MARCH)).toBe("none");
  });
  it("zweiter Minijob nur mit unsicherer Bezahlung → 'uncertain' (keine Annahme)", () => {
    const Bns = mk("b", "minijob", { startDate: undefined });
    const shifts = [e("a", "2026-03-02"), e("b", "2026-03-04", "krank")];
    expect(o4MonthStatus([HB, A, Bns], shifts, MARCH)).toBe("uncertain");
    const flags = limitReliabilityFlags([HB, A, Bns], shifts, 2026, 2);
    expect(flags).toMatchObject({ month: false, monthUncertain: true, yearUncertain: true });
    expect(statusUnreliable(flags)).toEqual({ month: true, year: true, forecast: true });
    expect(uncertainMinijobMonths([HB, A, Bns], shifts, yearPeriod(2026))).toEqual(["2026-03"]);
  });
  it("drei Minijobs: zwei aktiv + einer unsicher → betroffen (sicher)", () => {
    const Cns = mk("c", "minijob", { startDate: undefined });
    const shifts = [e("a", "2026-03-02"), e("b", "2026-03-03"), e("c", "2026-03-04", "krank")];
    expect(o4MonthStatus([HB, A, B, Cns], shifts, MARCH)).toBe("affected");
  });
  it("ohne Hauptbeschäftigung → nie betroffen/unsicher (O4 unverändert)", () => {
    const shifts = [e("a", "2026-03-02"), e("b", "2026-03-04")];
    expect(o4MonthStatus([A, B], shifts, MARCH)).toBe("none");
  });
  it("Hauptbeschäftigung ohne Einträge zählt weiter, solange beschäftigt (bisherige Regel)", () => {
    const shifts = [e("a", "2026-03-02"), e("b", "2026-03-04")];
    expect(o4MonthStatus([HB, A, B], shifts, MARCH)).toBe("affected");
    const hbEnded = mk("hb", "hauptbeschaeftigung", { endDate: "2026-02-28" });
    expect(o4MonthStatus([hbEnded, A, B], shifts, MARCH)).toBe("none");
  });
  it("Krank über 6 Wochen, O-2 noch offen → unsicher; nach Bestätigung unbezahlt → nicht aktiv", () => {
    const ALL7 = Array.from({ length: 7 }, () => ({ active: true, ...day }));
    const Bk = mk("b", "minijob", { week: ALL7 });
    const sick: Shift[] = [];
    for (let i = 0; i < 61; i += 1) {
      const d = new Date(2026, 1, 1 + i); // 01.02.–02.04.
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      sick.push(e("b", iso, "krank"));
    }
    const shifts = [e("a", "2026-03-30"), ...sick.filter((s) => s.date >= "2026-03-15")];
    const all = [e("a", "2026-03-30"), ...sick];
    const period = { from: "2026-03-20", to: "2026-03-31" };
    expect(minijobActivity(Bk, all, period)).toBe("uncertain");
    expect(minijobActivity(Bk, all, period, { sickContinuousConfirmed: ["2026-03"] })).toBe(
      "inactive",
    );
    expect(shifts.length).toBeGreaterThan(0);
  });
});

describe("Jahr, Prognose, Jahresbericht, Export, KI", () => {
  const Bns = mk("b", "minijob", { startDate: undefined });
  const shifts = [
    e("a", "2026-03-02"),
    e("b", "2026-03-04"), // März: sicher betroffen
    e("a", "2026-05-04"),
    e("b", "2026-05-06", "krank"), // Mai: B nur Krank → mit Bns unsicher
  ];
  it("Jahreshinweis nennt die Monate; unsichere Monate getrennt", () => {
    expect(multipleMinijobMonths([HB, A, Bns], shifts, yearPeriod(2026))).toEqual(["2026-03"]);
    expect(limitReliabilityMonths([HB, A, Bns], shifts, 2026, 5)).toEqual({
      year: ["2026-03"],
      forecast: ["2026-03"],
      yearUncertain: ["2026-05"],
      forecastUncertain: ["2026-05"],
    });
  });
  it("Prognose blickt nur zurück: im April ist der Mai nicht enthalten", () => {
    expect(limitReliabilityMonths([HB, A, Bns], shifts, 2026, 3).forecastUncertain).toEqual([]);
  });
  it("Jahresbericht + Export nennen sichere und unsichere Monate", () => {
    const settings = { ...DEFAULT_SETTINGS };
    const jobs = [HB, A, Bns];
    const report = buildAnnualReport(shifts, jobs, settings, 2026, makeResolver(jobs, settings));
    expect(report.multipleMinijobMonths).toEqual(["2026-03"]);
    expect(report.o4UncertainMonths).toEqual(["2026-05"]);
    if (report.limit > 0) expect(annualO4Lines(report).length).toBe(2);
  });
  it("KI-Kontext meldet Unsicherheit; Prompt verlangt 'nicht bestimmbar'", () => {
    const data = {
      jobs: [HB, A, Bns],
      shifts,
      customers: [],
      projects: [],
      payments: [],
      goals: [],
      orders: [],
      objects: [],
      settings: { ...DEFAULT_SETTINGS, onboarded: true },
      timer: null,
    } as unknown as AppData;
    const ctx = JSON.parse(buildAssistantContext(data, new Date(2026, 4, 20, 12)));
    expect(ctx.currentMonth.multipleMinijobsWithMainJob).toBe(false);
    expect(ctx.currentMonth.minijobActivityUncertain).toBe(true);
    expect(ctx.year.multipleMinijobsWithMainJob).toBe(true);
    const prompt = buildSystemInstruction("de");
    expect(prompt).toContain("minijobActivityUncertain");
    expect(prompt).toContain("nicht bestimmen lässt, ob die Minijob-Grenze überschritten wurde");
  });
});
