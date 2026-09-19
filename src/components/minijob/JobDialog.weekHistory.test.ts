import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "JobDialog.tsx"), "utf8");

describe("JobDialog weekHistory Phase A", () => {
  it("pushes previous fest week to weekHistory with effectiveFrom today on change", () => {
    expect(src).toMatch(/weekHistory/);
    expect(src).toMatch(/effectiveFrom:\s*isoDate\(new Date\(\)\)/);
    expect(src).toMatch(/JSON\.stringify\(job\.week\)/);
  });
});
