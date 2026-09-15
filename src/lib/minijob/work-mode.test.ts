import { describe, expect, it } from "vitest";

import type { Job } from "./types";
import {
  isEmployeeMinijobMode,
  jobsApplyMinijobLimit,
  primaryWorkMode,
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
  it("maps flex/fest as employee Minijob; selbststaendig not", () => {
    expect(isEmployeeMinijobMode("flex")).toBe(true);
    expect(isEmployeeMinijobMode("fest")).toBe(true);
    expect(isEmployeeMinijobMode("selbststaendig")).toBe(false);
    expect(workModeAppliesMinijobLimit("flex")).toBe(true);
    expect(workModeAppliesMinijobLimit("selbststaendig")).toBe(false);
  });

  it("jobsApplyMinijobLimit: empty or any employee job → true; all self-employed → false", () => {
    expect(jobsApplyMinijobLimit([])).toBe(true);
    expect(jobsApplyMinijobLimit([job({ id: "a", mode: "flex" })])).toBe(true);
    expect(jobsApplyMinijobLimit([job({ id: "a", mode: "fest" })])).toBe(true);
    expect(jobsApplyMinijobLimit([job({ id: "a", mode: "selbststaendig" })])).toBe(false);
    expect(
      jobsApplyMinijobLimit([
        job({ id: "a", mode: "selbststaendig" }),
        job({ id: "b", mode: "flex" }),
      ]),
    ).toBe(true);
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
});
