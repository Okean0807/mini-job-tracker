import { describe, expect, it } from "vitest";

import {
  dayBlockAddress,
  dayBlockLeistungsart,
  dayHeadingJobName,
  shiftsOnDate,
} from "./day-shifts";
import type { Job, Shift } from "./types";

function makeShift(patch: Partial<Shift> & Pick<Shift, "id">): Shift {
  return {
    kind: "arbeit",
    jobId: "j1",
    date: "2026-09-19",
    start: "09:00",
    end: "17:00",
    breakMinutes: 0,
    ...patch,
  };
}

const job: Job = {
  id: "j1",
  name: "Reinigung",
  color: "#000",
  mode: "flex",
  rate: 15,
};

describe("shiftsOnDate (presentation grouping)", () => {
  it("returns all Shifts for the selected date and ignores other days", () => {
    const a = makeShift({ id: "a", start: "06:00", end: "06:15" });
    const other = makeShift({ id: "x", date: "2026-09-20", start: "06:00", end: "07:00" });
    const b = makeShift({ id: "b", start: "06:15", end: "16:30" });
    expect(shiftsOnDate([a, other, b], "2026-09-19").map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("sorts by start time ascending, not creation/id order", () => {
    const c = makeShift({ id: "c", start: "17:00", end: "18:00", workCode: "FR" });
    const a = makeShift({ id: "a", start: "06:00", end: "06:15", workCode: "SA" });
    const b = makeShift({ id: "b", start: "06:15", end: "16:30", workCode: "ER" });
    expect(shiftsOnDate([c, b, a], "2026-09-19").map((s) => [s.start, s.workCode])).toEqual([
      ["06:00", "SA"],
      ["06:15", "ER"],
      ["17:00", "FR"],
    ]);
  });

  it("keeps each Shift as its own record (no merge)", () => {
    const blocks = shiftsOnDate(
      [
        makeShift({
          id: "a",
          start: "06:00",
          end: "06:15",
          workCode: "SA",
          tasks: ["Schlüssel nehmen"],
          workplace: "Büro",
        }),
        makeShift({
          id: "b",
          start: "06:15",
          end: "16:30",
          workCode: "ER",
          tasks: ["Endreinigung"],
          street: "Fehrenwinkel",
          houseNo: "16",
        }),
        makeShift({
          id: "c",
          start: "17:00",
          end: "18:00",
          workCode: "FR",
          tasks: ["Fensterreinigung"],
        }),
      ],
      "2026-09-19",
    );
    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.workCode).toBe("SA");
    expect(blocks[1]?.workCode).toBe("ER");
    expect(blocks[2]?.workCode).toBe("FR");
    expect(blocks[1]?.tasks).toEqual(["Endreinigung"]);
    expect(blocks[0]?.tasks).toEqual(["Schlüssel nehmen"]);
  });

  it("includes absences on the same date without dropping work blocks", () => {
    const work = makeShift({ id: "w", start: "08:00", end: "12:00" });
    const sick = makeShift({ id: "k", kind: "krank", start: "00:00", end: "00:00" });
    expect(shiftsOnDate([work, sick], "2026-09-19").map((s) => s.id)).toEqual(["k", "w"]);
  });
});

describe("day block labels", () => {
  it("prefers street+house over workplace", () => {
    expect(
      dayBlockAddress({ street: "Fehrenwinkel", houseNo: "16", workplace: "Büro" }),
    ).toBe("Fehrenwinkel 16");
    expect(dayBlockAddress({ workplace: "Büro" })).toBe("Büro");
  });

  it("uses the Shift snapshot for Leistungsart, not a shared day value", () => {
    expect(dayBlockLeistungsart({ workCode: "SA", workCodeLabel: "Schlüssel nehmen" })).toBe(
      "SA · Schlüssel nehmen",
    );
    expect(dayBlockLeistungsart({ workCode: "ER", workCodeLabel: "Endreinigung" })).toBe(
      "ER · Endreinigung",
    );
  });

  it("shows a shared job name only when every block has the same job", () => {
    const same = [
      makeShift({ id: "a", jobId: "j1" }),
      makeShift({ id: "b", jobId: "j1" }),
    ];
    expect(dayHeadingJobName(same, [job])).toBe("Reinigung");
    expect(
      dayHeadingJobName(
        [makeShift({ id: "a", jobId: "j1" }), makeShift({ id: "b", jobId: "j2" })],
        [job, { ...job, id: "j2", name: "Büro" }],
      ),
    ).toBeUndefined();
  });
});
