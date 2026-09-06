import { describe, expect, it } from "vitest";

import { isValidPayload } from "./payload";

describe("isValidPayload", () => {
  it("accepts backups that include shifts and jobs arrays", () => {
    expect(isValidPayload({ shifts: [], jobs: [] })).toBe(true);
    expect(isValidPayload({ shifts: [], jobs: [], goals: [] })).toBe(true);
    expect(
      isValidPayload({
        shifts: [],
        jobs: [],
        customers: [],
        projects: [],
        payments: [],
      }),
    ).toBe(true);
  });

  it("rejects empty or non-object values that would wipe via normalize", () => {
    expect(isValidPayload(null)).toBe(false);
    expect(isValidPayload(undefined)).toBe(false);
    expect(isValidPayload([])).toBe(false);
    expect(isValidPayload("{}")).toBe(false);
    expect(isValidPayload({})).toBe(false);
    expect(isValidPayload(42)).toBe(false);
  });

  it("rejects incomplete stubs that would wipe local data via replaceAll", () => {
    expect(isValidPayload({ goals: [] })).toBe(false);
    expect(isValidPayload({ customers: [], projects: [], payments: [] })).toBe(false);
    expect(isValidPayload({ shifts: [] })).toBe(false);
    expect(isValidPayload({ jobs: [] })).toBe(false);
    expect(isValidPayload({ shifts: [], settings: { monthlyLimit: 556 } })).toBe(false);
  });

  it("rejects malformed list or settings fields", () => {
    expect(isValidPayload({ shifts: [], jobs: "nein" })).toBe(false);
    expect(isValidPayload({ shifts: [], jobs: [], settings: [] })).toBe(false);
    expect(isValidPayload({ shifts: [], jobs: [], settings: "x" })).toBe(false);
    expect(isValidPayload({ shifts: [], jobs: [], goals: "x" })).toBe(false);
  });

  it("accepts object settings alongside shifts and jobs", () => {
    expect(isValidPayload({ shifts: [], jobs: [], settings: { monthlyLimit: 556 } })).toBe(
      true,
    );
  });
});
