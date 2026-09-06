import { describe, expect, it } from "vitest";

import { isValidPayload } from "./payload";

describe("isValidPayload", () => {
  it("accepts minimal list-shaped backups", () => {
    expect(isValidPayload({ shifts: [], jobs: [] })).toBe(true);
    expect(isValidPayload({ goals: [] })).toBe(true);
    expect(isValidPayload({ customers: [], projects: [], payments: [] })).toBe(true);
  });

  it("rejects empty or non-object values that would wipe via normalize", () => {
    expect(isValidPayload(null)).toBe(false);
    expect(isValidPayload(undefined)).toBe(false);
    expect(isValidPayload([])).toBe(false);
    expect(isValidPayload("{}")).toBe(false);
    expect(isValidPayload({})).toBe(false);
    expect(isValidPayload(42)).toBe(false);
  });

  it("rejects malformed list or settings fields", () => {
    expect(isValidPayload({ shifts: [], jobs: "nein" })).toBe(false);
    expect(isValidPayload({ shifts: [], settings: [] })).toBe(false);
    expect(isValidPayload({ shifts: [], settings: "x" })).toBe(false);
  });

  it("accepts object settings alongside lists", () => {
    expect(isValidPayload({ shifts: [], settings: { monthlyLimit: 556 } })).toBe(true);
  });
});
