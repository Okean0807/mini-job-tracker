import { describe, expect, it } from "vitest";

import { normalize } from "./store";

describe("normalize list holes", () => {
  it("does not throw on null/primitive holes in shifts or jobs", () => {
    expect(() =>
      normalize({
        shifts: [null, "x", 42, { id: "s1", date: "2026-09-01", start: "09:00", end: "12:00" }],
        jobs: [null, { id: "j1", name: "Café", color: "#000", mode: "flex", rate: 0 }],
      } as never),
    ).not.toThrow();
  });

  it("keeps only plain-object rows and still lifts legacy job rate 0", () => {
    const data = normalize({
      shifts: [
        null,
        { id: "s1", date: "2026-09-01", start: "09:00", end: "12:00" },
      ],
      jobs: [null, { id: "j1", name: "Café", color: "#000", mode: "flex", rate: 0 }],
    } as never);

    expect(data.shifts).toHaveLength(1);
    expect(data.shifts[0]).toMatchObject({
      id: "s1",
      date: "2026-09-01",
      kind: "arbeit",
      breakMinutes: 0,
    });
    expect(data.jobs).toHaveLength(1);
    expect(data.jobs[0]).toMatchObject({ id: "j1", name: "Café" });
    expect(data.jobs[0]).not.toHaveProperty("rate");
  });
});
