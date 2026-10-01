import { describe, expect, it } from "vitest";

import {
  employmentTypeOf,
  isEligibleMinijobShift,
  isMinijobEmployment,
  jobActiveOn,
} from "./employment";
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
  it("migriert alte flex-Jobs als Minijob", () => {
    expect(employmentTypeOf(baseJob())).toBe("minijob");
    expect(isMinijobEmployment(baseJob())).toBe(true);
  });

  it("migriert alte fest-Jobs als Hauptbeschäftigung", () => {
    expect(employmentTypeOf(baseJob({ mode: "fest" }))).toBe("hauptbeschaeftigung");
    expect(isMinijobEmployment(baseJob({ mode: "fest" }))).toBe(false);
  });

  it("migriert alte selbststaendig-Jobs als selbstständig", () => {
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
    const job = baseJob({ mode: "fest" });
    expect(isEligibleMinijobShift(shift(), job)).toBe(false);
  });

  it("schließt Minijob-Schichten außerhalb des Beschäftigungszeitraums aus", () => {
    const job = baseJob({ startDate: "2026-09-20" });
    expect(isEligibleMinijobShift(shift(), job)).toBe(false);
  });

  it("hält nicht zugeordnete Alt-Schichten kompatibel", () => {
    expect(isEligibleMinijobShift(shift({ jobId: undefined }), undefined)).toBe(true);
  });
});
