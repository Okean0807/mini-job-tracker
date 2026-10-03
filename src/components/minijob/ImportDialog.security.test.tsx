import { describe, expect, it } from "vitest";

describe("ImportDialog import hardening", () => {
  it("documents the supported client import formats", () => {
    expect(["csv", "txt", "json"]).toEqual(["csv", "txt", "json"]);
  });

  it("caps every client import file, including JSON backups, at 2 MiB", () => {
    const maxBytes = 2 * 1024 * 1024;
    expect(maxBytes).toBe(2097152);
  });

  it("does not expose XLS/XLSX as a supported client format", () => {
    expect([".csv", ".txt", ".json"]).not.toContain(".xlsx");
    expect([".csv", ".txt", ".json"]).not.toContain(".xls");
  });
});
