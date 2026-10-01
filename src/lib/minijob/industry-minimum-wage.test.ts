import { describe, expect, it } from "vitest";
import {
  bindingMinimumWageFor,
  findIndustryGroup,
  industryMinimumWageFor,
} from "./industry-minimum-wage";

describe("industry minimum wage", () => {
  it("Gebäudereinigung LG1 uses 15.00 EUR from 2026", () => {
    expect(industryMinimumWageFor("2026-01-01", "gebaeudereinigung", "lg1")).toBe(15);
    expect(industryMinimumWageFor("2026-12-31", "gebaeudereinigung", "lg1")).toBe(15);
  });

  it("Gebäudereinigung LG6 uses 18.40 EUR from 2026", () => {
    expect(industryMinimumWageFor("2026-01-01", "gebaeudereinigung", "lg6")).toBe(18.4);
  });

  it("does not invent a rate outside the validity period", () => {
    expect(industryMinimumWageFor("2027-01-01", "gebaeudereinigung", "lg1")).toBeUndefined();
  });

  it("binding floor is the maximum of general and industry rate", () => {
    expect(bindingMinimumWageFor("2026-06-01", 13.9, "gebaeudereinigung", "lg1")).toBe(15);
    expect(bindingMinimumWageFor("2026-06-01", 20, "gebaeudereinigung", "lg1")).toBe(20);
  });

  it("keeps activity classification explicit", () => {
    expect(findIndustryGroup("gebaeudereinigung", "lg1")?.description).toContain("Innen");
  });
});
