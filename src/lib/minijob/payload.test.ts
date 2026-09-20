import { describe, expect, it } from "vitest";

import { isPlainRecord, isValidPayload } from "./payload";

describe("isPlainRecord", () => {
  it("accepts plain objects only", () => {
    expect(isPlainRecord({})).toBe(true);
    expect(isPlainRecord({ id: "1" })).toBe(true);
    expect(isPlainRecord(null)).toBe(false);
    expect(isPlainRecord(undefined)).toBe(false);
    expect(isPlainRecord([])).toBe(false);
    expect(isPlainRecord("x")).toBe(false);
    expect(isPlainRecord(0)).toBe(false);
  });
});

describe("isValidPayload", () => {
  it("accepts backups that include shifts and jobs arrays", () => {
    expect(isValidPayload({ shifts: [], jobs: [] })).toBe(true);
    expect(isValidPayload({ shifts: [], jobs: [], goals: [] })).toBe(true);
    expect(isValidPayload({ shifts: [], jobs: [], objects: [] })).toBe(true);
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

  it("accepts object rows in primary lists", () => {
    expect(
      isValidPayload({
        shifts: [{ id: "s1", date: "2026-09-01", start: "09:00", end: "17:00", kind: "arbeit" }],
        jobs: [{ id: "j1", name: "Café", color: "#000", mode: "flex" }],
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
    expect(isValidPayload({ shifts: [], jobs: [], objects: "x" })).toBe(false);
    expect(isValidPayload({ shifts: [], jobs: [], objects: [null] })).toBe(false);
  });

  it("rejects null/primitive holes in list arrays (normalize used to throw)", () => {
    expect(isValidPayload({ shifts: [null], jobs: [] })).toBe(false);
    expect(isValidPayload({ shifts: [], jobs: [null] })).toBe(false);
    expect(isValidPayload({ shifts: ["x"], jobs: [] })).toBe(false);
    expect(isValidPayload({ shifts: [42], jobs: [{}] })).toBe(false);
    expect(isValidPayload({ shifts: [[]], jobs: [] })).toBe(false);
    expect(isValidPayload({ shifts: [{}], jobs: [], goals: [null] })).toBe(false);
  });

  it("accepts object settings alongside shifts and jobs", () => {
    expect(isValidPayload({ shifts: [], jobs: [], settings: { monthlyLimit: 556 } })).toBe(
      true,
    );
  });
});
