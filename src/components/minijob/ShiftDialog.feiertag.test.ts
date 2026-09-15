import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ShiftDialog.tsx"), "utf8");

describe("ShiftDialog Feiertag default (CAL-P2)", () => {
  it("preserves existing shift.kind and defaults new holiday days to feiertag", () => {
    expect(src).toMatch(/shift\?\.kind/);
    expect(src).toMatch(/holidayDefault/);
    expect(src).toMatch(/holidayName\(date,\s*settings\.bundesland\)\s*\?\s*"feiertag"/);
  });
});
