import { describe, expect, it } from "vitest";

import type { Job } from "./types";
import {
  isEmployeeMinijobMode,
  jobsApplyMinijobLimit,
  primaryWorkMode,
  resolvePayType,
  workModeAppliesMinijobLimit,
} from "./work-mode";

function job(partial: Partial<Job> & Pick<Job, "id" | "mode">): Job {
  return {
    name: partial.name ?? partial.id,
    color: "#0d9488",
    ...partial,
  };
}

describe("work-mode helpers", () => {
  it("legacy mode-only helper mirrors employmentTypeOf (flex → Minijob, fest → review, selbststaendig → no)", () => {
    // fest/flex sind reine Planungsmodi; beide sind Arbeitnehmer-Modi.
    expect(isEmployeeMinijobMode("flex")).toBe(true);
    expect(isEmployeeMinijobMode("fest")).toBe(true);
    expect(isEmployeeMinijobMode("selbststaendig")).toBe(false);
    // Nur der Altbestands-Fallback (ohne employmentType) – gleiche Quelle wie employmentTypeOf.
    expect(workModeAppliesMinijobLimit("flex")).toBe(true);
    expect(workModeAppliesMinijobLimit("fest")).toBe(false);
    expect(workModeAppliesMinijobLimit("selbststaendig")).toBe(false);
  });

  it("jobsApplyMinijobLimit: empty or any Minijob → true; only non-Minijob employment → false", () => {
    expect(jobsApplyMinijobLimit([])).toBe(true);
    expect(jobsApplyMinijobLimit([job({ id: "a", mode: "flex" })])).toBe(true);
    // Altbestand fest ohne employmentType: ungeklärt → keine Minijob-Grenze …
    expect(jobsApplyMinijobLimit([job({ id: "a", mode: "fest" })])).toBe(false);
    // … mit expliziter Angabe zählt nur die Angabe, nicht der Wochenplan.
    expect(jobsApplyMinijobLimit([job({ id: "a", mode: "fest", employmentType: "minijob" })])).toBe(
      true,
    );
    expect(
      jobsApplyMinijobLimit([job({ id: "a", mode: "fest" }), job({ id: "b", mode: "flex" })]),
    ).toBe(true);
    expect(
      jobsApplyMinijobLimit([
        job({ id: "a", mode: "fest", employmentType: "hauptbeschaeftigung" }),
      ]),
    ).toBe(false);
    expect(
      jobsApplyMinijobLimit([
        job({ id: "a", mode: "flex", employmentType: "hauptbeschaeftigung" }),
      ]),
    ).toBe(false);
    expect(
      jobsApplyMinijobLimit([
        job({ id: "a", mode: "fest", employmentType: "hauptbeschaeftigung" }),
        job({ id: "b", mode: "fest", employmentType: "minijob" }),
      ]),
    ).toBe(true);
    expect(jobsApplyMinijobLimit([job({ id: "a", mode: "selbststaendig" })])).toBe(false);
    expect(
      jobsApplyMinijobLimit([
        job({ id: "a", mode: "selbststaendig" }),
        job({ id: "b", mode: "flex" }),
      ]),
    ).toBe(true);
    expect(
      jobsApplyMinijobLimit([
        job({ id: "a", mode: "fest", employmentType: "hauptbeschaeftigung" }),
        job({ id: "b", mode: "flex", archived: true }),
      ]),
    ).toBe(false);
    expect(
      jobsApplyMinijobLimit([
        job({ id: "a", mode: "selbststaendig" }),
        job({ id: "b", mode: "flex", archived: true }),
      ]),
    ).toBe(false);
  });

  it("primaryWorkMode prefers activeJobId", () => {
    const jobs = [
      job({ id: "a", mode: "flex" }),
      job({ id: "b", mode: "selbststaendig" }),
    ];
    expect(primaryWorkMode(jobs, "b")).toBe("selbststaendig");
    expect(primaryWorkMode(jobs)).toBe("flex");
    expect(primaryWorkMode([])).toBe("flex");
  });

  it("resolvePayType: explicit monthly/hourly; missing + rate → hourly", () => {
    expect(resolvePayType({ payType: "monthly" })).toBe("monthly");
    expect(resolvePayType({ payType: "hourly", rate: 15 })).toBe("hourly");
    expect(resolvePayType({ rate: 14 })).toBe("hourly");
    expect(resolvePayType({})).toBe("hourly");
  });
});
