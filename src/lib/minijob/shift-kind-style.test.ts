import { describe, expect, it } from "vitest";

import type { ShiftKind } from "./types";
import { getEntryIndicatorClass, KIND_ORDER, KIND_STYLE } from "./shift-kind-style";

const EXPECTED_FAMILY: Record<ShiftKind, string> = {
  arbeit: "emerald",
  urlaub: "amber",
  krank: "red",
  frei: "sky",
  sonstige: "violet",
  feiertag: "zinc",
};

describe("shift-kind-style", () => {
  it("maps each ShiftKind indicator to the expected color family", () => {
    for (const kind of Object.keys(EXPECTED_FAMILY) as ShiftKind[]) {
      const cls = getEntryIndicatorClass(kind);
      expect(cls).toMatch(new RegExp(EXPECTED_FAMILY[kind]));
      expect(cls).toMatch(/^bg-/);
    }
  });

  it("aligns cell and legend with the same color families", () => {
    for (const kind of Object.keys(EXPECTED_FAMILY) as ShiftKind[]) {
      const family = EXPECTED_FAMILY[kind];
      expect(KIND_STYLE[kind].cell).toMatch(new RegExp(family));
      expect(KIND_STYLE[kind].legend).toMatch(new RegExp(family));
      expect(KIND_STYLE[kind].indicatorClass).toMatch(new RegExp(family));
      expect(KIND_STYLE[kind].labelKey).toBe(`kind.${kind}`);
    }
  });

  it("KIND_ORDER covers every ShiftKind once", () => {
    expect(KIND_ORDER).toHaveLength(Object.keys(EXPECTED_FAMILY).length);
    expect(new Set(KIND_ORDER).size).toBe(KIND_ORDER.length);
    for (const kind of Object.keys(EXPECTED_FAMILY) as ShiftKind[]) {
      expect(KIND_ORDER).toContain(kind);
    }
  });
});
