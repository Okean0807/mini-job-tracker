import { describe, expect, it } from "vitest";

import {
  absenceShiftsInRange,
  contiguousAbsenceRange,
  eachIsoDateInclusive,
  isAbsenceKind,
} from "./absence-range";
import type { Shift } from "./types";

function shift(partial: Partial<Shift> & { date: string; kind: Shift["kind"] }): Shift {
  return {
    id: partial.id ?? `${partial.date}-${partial.kind}`,
    start: "09:00",
    end: "17:00",
    breakMinutes: 30,
    jobId: "j1",
    ...partial,
  };
}

describe("absence-range", () => {
  it("eachIsoDateInclusive lists every calendar day from–to", () => {
    expect(eachIsoDateInclusive("2026-03-06", "2026-03-09")).toEqual([
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
    ]);
  });

  it("contiguousAbsenceRange expands a vacation block across all days", () => {
    const all = [
      shift({ date: "2026-07-01", kind: "urlaub", id: "a" }),
      shift({ date: "2026-07-02", kind: "urlaub", id: "b" }),
      shift({ date: "2026-07-03", kind: "urlaub", id: "c" }),
      shift({ date: "2026-07-05", kind: "urlaub", id: "d" }),
      shift({ date: "2026-07-02", kind: "arbeit", id: "work" }),
    ];
    const range = contiguousAbsenceRange(all[1]!, all);
    expect(range.from).toBe("2026-07-01");
    expect(range.to).toBe("2026-07-03");
    expect(range.ids.sort()).toEqual(["a", "b", "c"]);
  });

  it("absenceShiftsInRange never returns arbeit", () => {
    const all = [
      shift({ date: "2026-07-01", kind: "urlaub" }),
      shift({ date: "2026-07-01", kind: "arbeit", id: "w" }),
    ];
    expect(absenceShiftsInRange(all, "j1", "urlaub", "2026-07-01", "2026-07-02")).toHaveLength(1);
    expect(isAbsenceKind("arbeit")).toBe(false);
    expect(isAbsenceKind("urlaub")).toBe(true);
  });

  it("isAbsenceKind includes frei and sonstige", () => {
    expect(isAbsenceKind("frei")).toBe(true);
    expect(isAbsenceKind("sonstige")).toBe(true);
    expect(isAbsenceKind("feiertag")).toBe(false);
  });

  it("contiguousAbsenceRange expands frei blocks", () => {
    const all = [
      shift({ date: "2026-07-01", kind: "frei", id: "a" }),
      shift({ date: "2026-07-02", kind: "frei", id: "b" }),
      shift({ date: "2026-07-03", kind: "sonstige", id: "c" }),
    ];
    const range = contiguousAbsenceRange(all[0]!, all);
    expect(range.from).toBe("2026-07-01");
    expect(range.to).toBe("2026-07-02");
    expect(range.ids.sort()).toEqual(["a", "b"]);
  });
});
