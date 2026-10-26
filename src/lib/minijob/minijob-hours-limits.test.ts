/** Einstellungen: Stundengrenze je Minijob nach eigenem Satz (nicht nach defaultRate). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { tl } from "@/lib/i18n";
import { minijobHoursLimits, monthlyHoursLimit, monthlyLimitOf } from "./limits";
import { DEFAULT_SETTINGS, type Job } from "./types";

const settings = { ...DEFAULT_SETTINGS, defaultRate: 12 };
const LIMIT = monthlyLimitOf(settings, 2026, 9);
const job = (id: string, extra: Partial<Job>): Job => ({
  id,
  name: id,
  color: "#000",
  mode: "flex",
  employmentType: "minijob",
  ...extra,
});

describe("minijobHoursLimits", () => {
  it("rechnet je Minijob mit dessen eigenem Satz", () => {
    const rows = minijobHoursLimits(
      [job("A", { rate: 13.9 }), job("B", { rate: 15 })],
      settings,
      2026,
      9,
    );
    expect(rows.map((r) => [r.jobId, r.rate])).toEqual([
      ["A", 13.9],
      ["B", 15],
    ]);
    expect(rows[0]!.hours).toBeCloseTo(LIMIT / 13.9, 6);
    expect(rows[1]!.hours).toBeCloseTo(LIMIT / 15, 6);
  });

  it("Job ohne eigenen Satz nutzt den Standardsatz – wie die Lohnberechnung", () => {
    const [row] = minijobHoursLimits([job("A", {})], settings, 2026, 9);
    expect(row!.rate).toBe(12);
  });

  it("Hauptbeschäftigung, archivierte und ungeklärte Jobs erhalten keine Minijob-Stundengrenze", () => {
    const rows = minijobHoursLimits(
      [
        job("HB", { rate: 20, employmentType: "hauptbeschaeftigung" }),
        job("ARCH", { rate: 14, archived: true }),
        { id: "L", name: "L", color: "#000", mode: "fest", rate: 14 },
        job("A", { rate: 15 }),
      ],
      settings,
      2026,
      9,
    );
    expect(rows.map((r) => r.jobId)).toEqual(["A"]);
  });

  it("verändert gespeicherte Sätze nicht", () => {
    const jobs = [job("A", { rate: 15 })];
    minijobHoursLimits(jobs, settings, 2026, 9);
    expect(jobs[0]!.rate).toBe(15);
    expect(settings.defaultRate).toBe(12);
  });

  it("ohne Minijob bleibt nur der Orientierungswert über den Standardsatz", () => {
    expect(minijobHoursLimits([], settings, 2026, 9)).toEqual([]);
    expect(monthlyHoursLimit(settings, 2026, 9)).toBeCloseTo(LIMIT / 12, 6);
  });
});

describe("Einstellungen zeigen die Stundengrenze je Minijob", () => {
  const src = readFileSync(resolve(process.cwd(), "src/routes/einstellungen.tsx"), "utf8");

  it("nutzt minijobHoursLimits für die Anzeige und kennzeichnet den Standardsatz-Fallback", () => {
    expect(src).toMatch(/const perJobHours = minijobHoursLimits\(jobs, settings\)/);
    expect(src).toMatch(/perJobHours\.map\(/);
    expect(src).toMatch(/set\.limits\.hoursForJob/);
    expect(src).toMatch(
      /perJobHours\.length > 0 \? \([\s\S]*?\) : \([\s\S]*?set\.limits\.hoursAtDefaultRate/,
    );
  });

  it("Texte für alle Sprachen vorhanden; Fallback ist als Orientierung beschriftet", () => {
    for (const lang of ["de", "en", "ru", "tr", "pl"] as const) {
      for (const key of [
        "set.limits.hoursPerJob",
        "set.limits.hoursForJob",
        "set.limits.hoursAtDefaultRate",
      ]) {
        expect(tl(lang, key), `${lang} ${key}`).not.toBe(key);
      }
    }
    expect(tl("de", "set.limits.hoursAtDefaultRate", { rate: "12,00 €" })).toBe(
      "Orientierung beim Standardsatz 12,00 €/h (noch kein Minijob)",
    );
  });
});
