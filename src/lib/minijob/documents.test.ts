/**
 * Regression: Dokumente list must not crash when created_at is null/missing.
 * Supabase rows can omit timestamps at runtime despite generated types.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { documentCreatedDay } from "./documents";

describe("documentCreatedDay", () => {
  it("returns YYYY-MM-DD for full ISO timestamps", () => {
    expect(documentCreatedDay("2026-09-06T12:34:56.789Z")).toBe("2026-09-06");
  });

  it("returns empty string for null/undefined/short values", () => {
    expect(documentCreatedDay(null)).toBe("");
    expect(documentCreatedDay(undefined)).toBe("");
    expect(documentCreatedDay("")).toBe("");
    expect(documentCreatedDay("2026-09")).toBe("");
  });
});

describe("dokumente list render (source)", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../routes/dokumente.tsx"),
    "utf8",
  );

  it("uses documentCreatedDay instead of bare created_at.slice", () => {
    expect(src).toMatch(/documentCreatedDay\s*\(/);
    expect(src).not.toMatch(/created_at\.slice\s*\(/);
  });
});
