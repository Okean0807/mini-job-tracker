import { beforeEach, describe, expect, it } from "vitest";

import { rateForDate, rateOf, earningsOf } from "./service";
import { replaceAll } from "./store";
import { DEFAULT_SETTINGS, type Job, type Shift } from "./types";

const jobA: Job = { id: "a", name: "Job A", color: "#f00", rate: 15, mode: "flex" };
const jobB: Job = { id: "b", name: "Job B", color: "#00f", rate: 20, mode: "flex" };

beforeEach(() => {
  replaceAll({
    shifts: [],
    jobs: [jobA, jobB],
    settings: { ...DEFAULT_SETTINGS, defaultRate: 12 },
  });
});

const shift = (over: Partial<Shift> = {}): Shift => ({
  id: "s1",
  kind: "arbeit",
  date: "2026-03-04",
  start: "09:00",
  end: "17:00",
  breakMinutes: 0,
  rate: 0,
  ...over,
});

describe("rateForDate", () => {
  it("nutzt den Standardsatz ohne Job", () => {
    const r = rateForDate("2026-03-04");
    expect(r.rate).toBe(12);
    expect(r.source).toBe("default");
  });

  it("nutzt den Job-Satz", () => {
    const r = rateForDate("2026-03-04", "a");
    expect(r.rate).toBe(15);
    expect(r.source).toBe("job");
    expect(r.job?.id).toBe("a");
  });

  it("unterscheidet verschiedene Jobs", () => {
    expect(rateForDate("2026-03-04", "b").rate).toBe(20);
    expect(rateForDate("2026-03-04", "a").rate).toBe(15);
  });

  it("bevorzugt den Schicht-Satz vor Job- und Standardsatz", () => {
    const r = rateForDate("2026-03-04", "a", undefined, { shiftRate: 18 });
    expect(r.rate).toBe(18);
    expect(r.source).toBe("shift");
  });

  it("fällt bei unbekanntem Job auf den Standardsatz zurück", () => {
    expect(rateForDate("2026-03-04", "gibtsnicht").rate).toBe(12);
  });

  it("liefert für verschiedene Daten denselben Satz, aber Feiertag/Wochentag korrekt", () => {
    const sat = rateForDate("2026-03-07", "a");
    const mon = rateForDate("2026-03-02", "a");
    expect(sat.rate).toBe(mon.rate);
    expect(sat.weekday).toBe(6);
    expect(mon.weekday).toBe(1);
  });
});

describe("rateOf / Verdienst", () => {
  it("verwendet den gespeicherten Schicht-Satz", () => {
    const s = shift({ rate: 14, jobId: "a" });
    expect(rateOf(s)).toBe(14);
    expect(earningsOf(s).base).toBe(112);
  });

  it("behandelt Satz 0 als 0 EUR/h (kein Fallback)", () => {
    const s = shift({ rate: 0, jobId: "a" });
    expect(rateOf(s)).toBe(0);
    expect(earningsOf(s).total).toBe(0);
  });
});
