import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "AbsenceDialog.tsx"), "utf8");

describe("AbsenceDialog range UI (Batch B)", () => {
  it("wires planAbsence with from/to and range delete/edit (R4 D3: via Retro-Guard)", () => {
    expect(src).toMatch(/planAbsence\(/);
    expect(src).toMatch(/planAbsenceRemoval\(/);
    expect(src).toMatch(/applyAbsencePlan\(/);
    expect(src).toMatch(/RetroImpactDialog/);
    expect(src).toMatch(/absence-from/);
    expect(src).toMatch(/absence-to/);
    expect(src).toMatch(/contiguousAbsenceRange/);
    expect(src).toMatch(/urlaub/);
    expect(src).toMatch(/krank/);
  });

  it("offers frei and sonstige absence kinds", () => {
    expect(src).toMatch(/frei/);
    expect(src).toMatch(/sonstige/);
  });
});
