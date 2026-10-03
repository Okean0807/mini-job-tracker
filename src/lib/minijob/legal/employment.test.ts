import { describe, expect, it } from "vitest";

import {
  employmentTypeOf,
  isEligibleMinijobShift,
  isMinijobEmployment,
  jobActiveOn,
  jobsNeedingEmploymentType,
  minijobJobs,
  needsEmploymentTypeReview,
} from "./employment";
import { EMPLOYMENT_TYPES } from "../types";
import type { Job, Shift } from "../types";

const baseJob = (overrides: Partial<Job> = {}): Job => ({
  id: "job-1",
  name: "Job",
  color: "#000",
  mode: "flex",
  ...overrides,
});

const shift = (overrides: Partial<Shift> = {}): Shift => ({
  id: "shift-1",
  jobId: "job-1",
  kind: "arbeit",
  date: "2026-09-15",
  start: "08:00",
  end: "12:00",
  breakMinutes: 0,
  ...overrides,
});

describe("rechtliche Beschäftigungsart", () => {
  it("A: migriert alte flex-Jobs (ohne employmentType) als Minijob", () => {
    expect(employmentTypeOf(baseJob())).toBe("minijob");
    expect(isMinijobEmployment(baseJob())).toBe(true);
    expect(needsEmploymentTypeReview(baseJob())).toBe(false);
  });

  // Juri-Entscheidung Runde 3: Altbestand fest ohne employmentType ist weder
  // Minijob noch Hauptbeschäftigung, sondern „Prüfung nötig“ ("unknown").
  it("B: alte fest-Jobs ohne employmentType → unknown (weder Minijob noch HB)", () => {
    const legacyFest = baseJob({ mode: "fest" });
    expect(employmentTypeOf(legacyFest)).toBe("unknown");
    expect(employmentTypeOf(legacyFest)).not.toBe("hauptbeschaeftigung");
    expect(isMinijobEmployment(legacyFest)).toBe(false);
    expect(needsEmploymentTypeReview(legacyFest)).toBe(true);
    expect(minijobJobs([legacyFest])).toEqual([]);
  });

  it('"unknown" ist nur ein aufgelöster Status, keine speicherbare Auswahl', () => {
    expect(EMPLOYMENT_TYPES).toEqual([
      "minijob",
      "hauptbeschaeftigung",
      "kurzfristig",
      "selbststaendig",
    ]);
    expect(EMPLOYMENT_TYPES as readonly string[]).not.toContain("unknown");
  });

  it("jobsNeedingEmploymentType: nur aktive Altbestände fest ohne Angabe", () => {
    const jobs = [
      baseJob({ id: "a", mode: "fest" }),
      baseJob({ id: "b", mode: "fest", archived: true }),
      baseJob({ id: "c", mode: "fest", employmentType: "minijob" }),
      baseJob({ id: "d", mode: "flex" }),
      baseJob({ id: "e", mode: "selbststaendig" }),
    ];
    expect(jobsNeedingEmploymentType(jobs).map((j) => j.id)).toEqual(["a"]);
  });

  it("D/E: explizite Angabe wird nie durch den Planungsmodus überschrieben", () => {
    for (const employmentType of EMPLOYMENT_TYPES) {
      for (const mode of ["flex", "fest", "selbststaendig"] as const) {
        const job = baseJob({ mode, employmentType });
        expect(employmentTypeOf(job)).toBe(employmentType);
        expect(needsEmploymentTypeReview(job)).toBe(false);
        expect(isMinijobEmployment(job)).toBe(employmentType === "minijob");
      }
    }
  });

  it("I: nur workMode ändern ändert den rechtlichen Status nicht (explizite Angabe)", () => {
    for (const employmentType of EMPLOYMENT_TYPES) {
      const flex = baseJob({ mode: "flex", employmentType });
      const fest = { ...flex, mode: "fest" as const };
      expect(employmentTypeOf(fest)).toBe(employmentTypeOf(flex));
      expect(isMinijobEmployment(fest)).toBe(isMinijobEmployment(flex));
      expect(isEligibleMinijobShift(shift(), fest)).toBe(isEligibleMinijobShift(shift(), flex));
    }
  });

  it("explizite Hauptbeschäftigung ist unabhängig vom Planungsmodus kein Minijob", () => {
    for (const mode of ["fest", "flex"] as const) {
      const job = baseJob({ mode, employmentType: "hauptbeschaeftigung" });
      expect(employmentTypeOf(job)).toBe("hauptbeschaeftigung");
      expect(isMinijobEmployment(job)).toBe(false);
    }
  });

  it("explizite Minijob-Angabe gilt auch mit festem Wochenplan", () => {
    const job = baseJob({ mode: "fest", employmentType: "minijob" });
    expect(employmentTypeOf(job)).toBe("minijob");
    expect(isMinijobEmployment(job)).toBe(true);
  });

  it("kurzfristige Beschäftigung zählt nicht zur Minijob-Grenze", () => {
    expect(isMinijobEmployment(baseJob({ employmentType: "kurzfristig" }))).toBe(false);
  });

  it("C: migriert alte selbststaendig-Jobs als selbstständig", () => {
    expect(employmentTypeOf(baseJob({ mode: "selbststaendig" }))).toBe("selbststaendig");
    expect(isMinijobEmployment(baseJob({ mode: "selbststaendig" }))).toBe(false);
  });

  it("bevorzugt explizite employmentType-Angabe", () => {
    expect(
      employmentTypeOf(baseJob({ mode: "flex", employmentType: "hauptbeschaeftigung" })),
    ).toBe("hauptbeschaeftigung");
  });
});

describe("Aktivität und Minijob-Eignung", () => {
  it("begrenzt einen Job auf startDate/endDate inklusive", () => {
    const job = baseJob({ startDate: "2026-09-10", endDate: "2026-09-20" });
    expect(jobActiveOn(job, "2026-09-09")).toBe(false);
    expect(jobActiveOn(job, "2026-09-10")).toBe(true);
    expect(jobActiveOn(job, "2026-09-20")).toBe(true);
    expect(jobActiveOn(job, "2026-09-21")).toBe(false);
  });

  it("schließt Hauptbeschäftigung aus der Minijob-Grenze aus", () => {
    const job = baseJob({ mode: "fest", employmentType: "hauptbeschaeftigung" });
    expect(isEligibleMinijobShift(shift(), job)).toBe(false);
  });

  it("fester Wochenplan mit expliziter Minijob-Angabe bleibt minijobfähig", () => {
    expect(
      isEligibleMinijobShift(shift(), baseJob({ mode: "fest", employmentType: "minijob" })),
    ).toBe(true);
  });

  it("B: ungeklärter Altbestand fest wird aus der Minijob-Grenze ausgeschlossen", () => {
    expect(isEligibleMinijobShift(shift(), baseJob({ mode: "fest" }))).toBe(false);
  });

  it("schließt Minijob-Schichten außerhalb des Beschäftigungszeitraums aus", () => {
    const job = baseJob({ startDate: "2026-09-20" });
    expect(isEligibleMinijobShift(shift(), job)).toBe(false);
  });

  it("hält nicht zugeordnete Alt-Schichten kompatibel", () => {
    const { jobId: _jobId, ...unassigned } = shift();
    expect(isEligibleMinijobShift(unassigned, undefined)).toBe(true);
  });
});
