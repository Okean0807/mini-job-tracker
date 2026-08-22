import { beforeEach, describe, expect, it } from "vitest";

import { shiftBreakdown } from "./calc";
import { parseCsv, shiftsToCsv } from "./csv";
import { parseRateInput } from "./rate";
import { makeResolver } from "./resolve";
import { rateForDate, rateOf, earningsOf } from "./service";
import { normalize, replaceAll } from "./store";
import { DEFAULT_SETTINGS, type Job, type Shift } from "./types";

const jobA: Job = { id: "a", name: "Job A", color: "#f00", rate: 15, mode: "flex" };
const jobB: Job = { id: "b", name: "Job B", color: "#00f", rate: 20, mode: "flex" };
const jobZero: Job = { id: "z", name: "Job Null", color: "#0f0", rate: 0, mode: "flex" };
const jobUnset: Job = { id: "u", name: "Job ohne Satz", color: "#0ff", mode: "flex" };

beforeEach(() => {
  replaceAll({
    shifts: [],
    jobs: [jobA, jobB, jobZero, jobUnset],
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

  it("behandelt Schicht-Satz 0 als bewusste Null (kein Fallback)", () => {
    const r = rateForDate("2026-03-04", "a", undefined, { shiftRate: 0 });
    expect(r.rate).toBe(0);
    expect(r.source).toBe("shift");
  });

  it("Job-Satz 0 gilt als bewusste Null (kein Fallback auf Standard)", () => {
    const r = rateForDate("2026-03-04", "z");
    expect(r.rate).toBe(0);
    expect(r.source).toBe("job");
  });

  it("Job ohne Satz fällt auf den Standardsatz zurück", () => {
    const r = rateForDate("2026-03-04", "u");
    expect(r.rate).toBe(12);
    expect(r.source).toBe("default");
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

  it("fällt ohne Schicht-Satz auf den Job-Satz zurück", () => {
    const s = shift({ jobId: "a" });
    expect(rateOf(s)).toBe(15);
    expect(earningsOf(s).base).toBe(120);
  });

  it("fällt ohne Schicht- und Job-Satz auf den Standardsatz zurück", () => {
    const s = shift({ jobId: "u" });
    expect(rateOf(s)).toBe(12);
    expect(earningsOf(s).base).toBe(96);
  });

  it("Schicht-Satz schlägt Job-Satz", () => {
    const s = shift({ rate: 25, jobId: "a" });
    expect(rateOf(s)).toBe(25);
  });

  it("Job-Satz 0 ohne Schicht-Satz ergibt 0 EUR", () => {
    const s = shift({ jobId: "z" });
    expect(rateOf(s)).toBe(0);
    expect(earningsOf(s).total).toBe(0);
  });

  it("shiftBreakdown nutzt dieselbe Kette", () => {
    const resolve = makeResolver([jobA, jobUnset], { ...DEFAULT_SETTINGS, defaultRate: 12 });
    const s = shift({ jobId: "u" });
    expect(shiftBreakdown(s, resolve(s)).base).toBe(96);
  });
});

describe("Eingabefeld (UI)", () => {
  it("leeres Feld ergibt undefined (nicht gesetzt)", () => {
    expect(parseRateInput("")).toBeUndefined();
    expect(parseRateInput("   ")).toBeUndefined();
    expect(parseRateInput("abc")).toBeUndefined();
  });

  it("eingegebene 0 ergibt 0", () => {
    expect(parseRateInput("0")).toBe(0);
  });

  it("akzeptiert Komma als Dezimaltrenner", () => {
    expect(parseRateInput("13,5")).toBe(13.5);
  });
});

describe("CSV", () => {
  const opts = { jobs: [jobA], defaultRate: 12 };

  it("leere Lohnspalte lässt den Satz offen (Fallback über Job)", () => {
    const csv = "2026-03-04;09:00;17:00;0;;Job A;";
    const r = parseCsv(csv, opts);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]!.shift!.rate).toBeUndefined();
    expect(rateOf({ ...r.valid[0]!.shift!, jobId: "a" })).toBe(15);
  });

  it("0 in der Lohnspalte bleibt 0", () => {
    const r = parseCsv("2026-03-04;09:00;17:00;0;0;Job A;", opts);
    expect(r.valid[0]!.shift!.rate).toBe(0);
  });

  it("expliziter Satz wird übernommen", () => {
    const r = parseCsv("2026-03-04;09:00;17:00;30;13,50;Job A;", opts);
    expect(r.valid[0]!.shift!.rate).toBe(13.5);
  });

  it("Export schreibt bei fehlendem Satz eine leere Zelle", () => {
    const line = shiftsToCsv([shift({ jobId: "a" })], [jobA]).split("\n")[1]!;
    expect(line.split(";")[4]).toBe("");
    const zero = shiftsToCsv([shift({ rate: 0 })], [jobA]).split("\n")[1]!;
    expect(zero.split(";")[4]).toBe("0");
  });
});

describe("Kompatibilität mit Altdaten", () => {
  it("hebt gespeicherten Job-Satz 0 auf 'nicht gesetzt' (bisheriges Fallback-Verhalten)", () => {
    const data = normalize({ jobs: [{ ...jobA, rate: 0 }] });
    expect(data.jobs[0]!.rate).toBeUndefined();
  });

  it("lässt gespeicherte Schicht-Sätze von 0 unverändert", () => {
    const data = normalize({ shifts: [shift({ rate: 0 })] });
    expect(data.shifts[0]!.rate).toBe(0);
  });
});
