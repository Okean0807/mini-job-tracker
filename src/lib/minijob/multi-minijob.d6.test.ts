/**
 * D6 (Owner R4, Regel A): O4-Hinweis je Kalendermonat nach Minijob-Aktivität
 * in genau diesem Monat. Jahres-/Prognosekarte nennen die auslösenden Monate;
 * Prognose = Rückblick 12 Monate bis zum gewählten Monat (keine Vorhersage).
 * "Aktivität" = Owner R5, Variante B: Arbeit oder bezahlte Abwesenheit des
 * Minijobs im Monat innerhalb des Beschäftigungszeitraums (Details und
 * Unsicherheitszustand: multi-minijob.activity-b.test.ts).
 */
import { describe, expect, it } from "vitest";

import { isoDate } from "./calc";
import {
  limitReliabilityFlags,
  limitReliabilityMonths,
  multipleMinijobMonths,
  yearPeriod,
} from "./multi-minijob";
import type { Job, Shift } from "./types";

const day = { start: "09:00", end: "14:00", breakMinutes: 0 };
const mk = (id: string, employmentType: string, extra: Partial<Job> = {}): Job =>
  ({
    id,
    name: id,
    color: "#000",
    mode: "fest",
    employmentType,
    rate: 15,
    startDate: "2025-01-01",
    week: Array.from({ length: 7 }, (_, i) => ({ active: i < 5, ...day })),
    ...extra,
  }) as unknown as Job;
const HB = mk("hb", "hauptbeschaeftigung");
const A = mk("a", "minijob");
const B = mk("b", "minijob");
const C = mk("c", "minijob");
const entry = (jobId: string, date: string, kind: Shift["kind"] = "arbeit"): Shift =>
  ({ id: `${jobId}-${date}-${kind}`, jobId, kind, date, ...day }) as Shift;
const mondays2026 = (() => {
  const out: string[] = [];
  for (let d = new Date(2026, 0, 5); d.getFullYear() === 2026; d.setDate(d.getDate() + 7)) {
    out.push(isoDate(d));
  }
  return out;
})();

/** R3-Probe 2.4: A jeden Montag, B nur 11.03. (Arbeit) und 13.05. (Urlaub). */
const SHIFTS: Shift[] = [
  ...mondays2026.map((d) => entry("a", d)),
  entry("b", "2026-03-11"),
  entry("b", "2026-05-13", "urlaub"),
];
const JOBS = [HB, A, B];

describe("D6 Regel A", () => {
  it("nur Monate, in denen beide Minijobs Einträge haben", () => {
    expect(multipleMinijobMonths(JOBS, SHIFTS, yearPeriod(2026))).toEqual(["2026-03", "2026-05"]);
  });

  it("April: Monat nicht betroffen, Jahr betroffen – Karte erklärt die anderen Monate", () => {
    expect(limitReliabilityFlags(JOBS, SHIFTS, 2026, 3)).toEqual({
      month: false,
      year: true,
      forecast: true,
    });
    expect(limitReliabilityMonths(JOBS, SHIFTS, 2026, 3)).toEqual({
      year: ["2026-03", "2026-05"],
      forecast: ["2026-03"], // Rückblick bis April: Mai liegt in der Zukunft
      yearUncertain: [],
      forecastUncertain: [],
    });
  });

  it("Prognose blickt nur zurück: vor März keine Monate, ab März bis Februar 2027", () => {
    expect(limitReliabilityMonths(JOBS, SHIFTS, 2026, 1).forecast).toEqual([]);
    expect(limitReliabilityMonths(JOBS, SHIFTS, 2027, 1).forecast).toEqual(["2026-03", "2026-05"]);
    expect(limitReliabilityMonths(JOBS, SHIFTS, 2027, 3).forecast).toEqual(["2026-05"]);
    expect(limitReliabilityMonths(JOBS, SHIFTS, 2027, 4).forecast).toEqual([]);
  });

  it("Urlaub zählt als bezahlte Abwesenheit (Variante B, Owner R5)", () => {
    expect(limitReliabilityFlags(JOBS, SHIFTS, 2026, 4).month).toBe(true);
  });

  it("keine Einträge eines Minijobs im Monat → nicht betroffen (auch wenn beschäftigt)", () => {
    expect(limitReliabilityFlags(JOBS, SHIFTS, 2026, 5).month).toBe(false);
  });

  it("drei Minijobs + HB: Monat betroffen, sobald zwei aktiv sind", () => {
    const shifts = [entry("a", "2026-07-06"), entry("c", "2026-07-08")];
    expect(multipleMinijobMonths([HB, A, B, C], shifts, yearPeriod(2026))).toEqual(["2026-07"]);
  });

  it("ohne Hauptbeschäftigung kein O4-Hinweis", () => {
    expect(multipleMinijobMonths([A, B], SHIFTS, yearPeriod(2026))).toEqual([]);
  });

  it("Einträge außerhalb des Beschäftigungszeitraums zählen nicht", () => {
    const Bend = mk("b", "minijob", { endDate: "2026-03-01" } as Partial<Job>);
    expect(multipleMinijobMonths([HB, A, Bend], SHIFTS, yearPeriod(2026))).not.toContain("2026-03");
  });
});
