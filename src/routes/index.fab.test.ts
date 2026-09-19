import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.tsx"), "utf8");
const shiftDialog = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/minijob/ShiftDialog.tsx"),
  "utf8",
);

describe("Dashboard FAB (pre-release)", () => {
  it("removes floating Urlaub/Krank AbsenceDialog trigger", () => {
    expect(src).not.toMatch(/t\("dash\.absence"\)/);
    expect(src).not.toMatch(/Palmtree/);
    // Single FAB only — no second floating button for absence
    expect(src).toMatch(/dash-fab fixed/);
    expect(src.match(/dash\.newEntry/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("keeps + Eintrag / Neuer Eintrag FAB and ShiftDialog", () => {
    expect(src).toMatch(/t\("dash\.newEntry"\)/);
    expect(src).toMatch(/openNew\(isoDate\(new Date\(\)\)\)/);
    expect(src).toMatch(/ShiftDialog/);
  });

  it("ShiftDialog still offers Arbeit|Urlaub|Krank|Feiertag; new absence routes to AbsenceDialog", () => {
    expect(shiftDialog).toMatch(/"arbeit"/);
    expect(shiftDialog).toMatch(/"urlaub"/);
    expect(shiftDialog).toMatch(/"krank"/);
    expect(shiftDialog).toMatch(/"feiertag"/);
    expect(shiftDialog).toMatch(/onRequestAbsence/);
    expect(src).toMatch(/onRequestAbsence=\{requestAbsence\}/);
  });

  it("AbsenceDialog remains for calendar edit of existing urlaub/krank", () => {
    expect(src).toMatch(/AbsenceDialog/);
    expect(src).toMatch(/existing\.kind === "urlaub"/);
  });
});
