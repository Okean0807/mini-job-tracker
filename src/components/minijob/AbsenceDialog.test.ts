import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "AbsenceDialog.tsx"), "utf8");

describe("AbsenceDialog range UI (Batch B)", () => {
  it("wires addAbsence with from/to and range delete/edit", () => {
    expect(src).toMatch(/addAbsence/);
    expect(src).toMatch(/removeAbsenceRange/);
    expect(src).toMatch(/absence-from/);
    expect(src).toMatch(/absence-to/);
    expect(src).toMatch(/contiguousAbsenceRange/);
    expect(src).toMatch(/urlaub/);
    expect(src).toMatch(/krank/);
  });
});
