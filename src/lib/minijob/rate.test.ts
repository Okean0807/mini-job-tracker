import { beforeEach, describe, expect, it } from "vitest";

import { shiftBreakdown } from "./calc";
import { parseCsv, shiftsToCsv } from "./csv";
import {
  effectiveHourlyFromMonthly,
  effectiveShiftRate,
  parseEditedRateInput,
  parseRateInput,
  rateFieldValue,
  resolveRate,
} from "./rate";
import { makeResolver } from "./resolve";
import { rateForDate, rateOf, earningsOf } from "./service";
import { getData, normalize, replaceAll, saveJob, updateSettings } from "./store";
import { DEFAULT_SETTINGS, EMPTY_WEEK, type Job, type Shift } from "./types";

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
    // Hinweis: der Store hebt Altdaten mit Job-Satz 0 auf "nicht gesetzt"; die
    // Auflösung selbst behandelt eine gesetzte 0 als echten Satz.
    const r = resolveRate({ jobId: "z" }, [jobZero], { ...DEFAULT_SETTINGS, defaultRate: 12 });
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
    expect(effectiveShiftRate(s, { job: jobZero, defaultRate: 12 })).toBe(0);
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

describe("K1: bearbeiteter Satz (parseEditedRateInput)", () => {
  it("rundet kaufmännisch auf zwei Nachkommastellen", () => {
    expect(parseEditedRateInput("13,5")).toBe(13.5);
    expect(parseEditedRateInput("12,345")).toBe(12.35);
    expect(parseEditedRateInput("14,006")).toBe(14.01);
    expect(parseEditedRateInput("15")).toBe(15);
    expect(parseEditedRateInput("12,344")).toBe(12.34);
    expect(parseEditedRateInput("12,3449999")).toBe(12.34);
    expect(parseEditedRateInput("13,999")).toBe(14);
    expect(parseEditedRateInput("9,995")).toBe(10);
    expect(parseEditedRateInput("0,004")).toBe(0);
    expect(parseEditedRateInput("0,005")).toBe(0.01);
  });

  it("rundet dezimale Halbfälle richtig, bei denen Gleitkomma-Rundung abrundet", () => {
    // Belegt das Problem: der naive Weg liefert für diese Eingaben den falschen Cent.
    expect((1.005).toFixed(2)).toBe("1.00");
    expect(Math.round(1.005 * 100) / 100).toBe(1);
    expect(parseEditedRateInput("1,005")).toBe(1.01);
    expect(parseEditedRateInput("1.005")).toBe(1.01);
    expect(parseEditedRateInput("8,345")).toBe(8.35);
    expect(parseEditedRateInput("1,255")).toBe(1.26);
    expect(parseEditedRateInput("10,075")).toBe(10.08);
    expect(parseEditedRateInput("2,675")).toBe(2.68);
  });

  it("liefert für jeden Cent-Halbfall 0,005 … 99,995 exakt den aufgerundeten Cent", () => {
    for (let cents = 0; cents < 10000; cents += 1) {
      const text = `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}5`;
      expect(parseEditedRateInput(text)).toBe((cents + 1) / 100);
    }
  });

  it("lässt Werte mit höchstens zwei Nachkommastellen unverändert", () => {
    for (let cents = 0; cents <= 10000; cents += 1) {
      const text = `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
      expect(parseEditedRateInput(text)).toBe(cents / 100);
      expect(parseEditedRateInput(text)).toBe(parseRateInput(text));
    }
    expect(parseEditedRateInput("7")).toBe(7);
    expect(parseEditedRateInput("7,")).toBe(7);
    expect(parseEditedRateInput(",5")).toBe(0.5);
    expect(parseEditedRateInput(" 13,5 ")).toBe(13.5);
  });

  it("behält die Semantik leer = nicht gesetzt, 0 = bewusst 0", () => {
    expect(parseEditedRateInput("")).toBeUndefined();
    expect(parseEditedRateInput("   ")).toBeUndefined();
    expect(parseEditedRateInput(",")).toBeUndefined();
    expect(parseEditedRateInput("abc")).toBeUndefined();
    expect(parseEditedRateInput("1,2,3")).toBeUndefined();
    expect(parseEditedRateInput("0")).toBe(0);
    expect(parseEditedRateInput("0,00")).toBe(0);
  });
});

describe("K1: Feldzustand -> zu speichernder Satz (rateFieldValue)", () => {
  it("unberührt: der exakte Ausgangswert, nicht die formatierte Anzeige", () => {
    for (const source of [12.345, 12.3456, 13.999, 14.006, 0.001, 18.46153846153846, 15, 0]) {
      const text = source.toFixed(2).replace(".", ",");
      expect(rateFieldValue({ text, dirty: false, source })).toBe(source);
    }
  });

  it("unberührt ohne Ausgangswert: nicht gesetzt", () => {
    expect(rateFieldValue({ text: "", dirty: false, source: undefined })).toBeUndefined();
    expect(rateFieldValue({ text: "", dirty: false, source: Number.NaN })).toBeUndefined();
  });

  it("bearbeitet: der eingegebene Text zählt, gerundet auf zwei Stellen", () => {
    expect(rateFieldValue({ text: "12,345", dirty: true, source: 12.345 })).toBe(12.35);
    expect(rateFieldValue({ text: "13,5", dirty: true, source: 12.345 })).toBe(13.5);
    expect(rateFieldValue({ text: "0", dirty: true, source: 12.345 })).toBe(0);
    expect(rateFieldValue({ text: "", dirty: true, source: 12.345 })).toBeUndefined();
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

describe("Import: neu angelegte Jobs", () => {
  const importJob = (over: Partial<Job> = {}): Job => ({
    id: "imp",
    name: "Café Nord",
    color: "#123456",
    mode: "flex",
    ...over,
  });

  it("neu erkannter Job ohne eigenen Satz hat rate === undefined", () => {
    saveJob(importJob());
    expect(getData().jobs.find((j) => j.id === "imp")!.rate).toBeUndefined();
  });

  it("folgt dem aktuellen Standardsatz", () => {
    saveJob(importJob());
    const r = rateForDate("2026-03-04", "imp");
    expect(r.rate).toBe(12);
    expect(r.source).toBe("default");
    expect(rateOf(shift({ jobId: "imp" }))).toBe(12);
  });

  it("folgt einem später geänderten Standardsatz", () => {
    saveJob(importJob());
    updateSettings({ defaultRate: 17 });
    expect(rateForDate("2026-03-04", "imp").rate).toBe(17);
    expect(rateOf(shift({ jobId: "imp" }))).toBe(17);
  });

  it("expliziter Job-Satz bleibt eigener Satz", () => {
    saveJob(importJob({ rate: 16 }));
    updateSettings({ defaultRate: 17 });
    const r = rateForDate("2026-03-04", "imp");
    expect(r.rate).toBe(16);
    expect(r.source).toBe("job");
  });

  it("expliziter Job-Satz 0 bleibt 0 (kein Fallback)", () => {
    const r = resolveRate({ jobId: "imp" }, [importJob({ rate: 0 })], {
      ...DEFAULT_SETTINGS,
      defaultRate: 12,
    });
    expect(r.rate).toBe(0);
    expect(r.source).toBe("job");
  });

  it("ändert die Schicht-Semantik nicht: Schicht-Satz 0 bleibt 0, leer folgt dem Job", () => {
    saveJob(importJob({ rate: 16 }));
    expect(rateOf(shift({ jobId: "imp", rate: 0 }))).toBe(0);
    expect(rateOf(shift({ jobId: "imp" }))).toBe(16);
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

describe("effectiveHourlyFromMonthly (v1.1)", () => {
  const festMonthly: Job = {
    id: "fm",
    name: "Fest Monat",
    color: "#000",
    mode: "fest",
    payType: "monthly",
    monthlyGross: 2000,
    week: EMPTY_WEEK.map((d) => ({ ...d })), // 5×7.5 = 37.5
  };

  it("derives hourly from monthlyGross / (weekHours*52/12)", () => {
    const rate = effectiveHourlyFromMonthly(festMonthly);
    expect(rate).toBeDefined();
    // 2000 / (37.5 * 52 / 12) = 2000 / 162.5 ≈ 12.3077
    expect(rate!).toBeCloseTo(2000 / ((37.5 * 52) / 12), 5);
  });

  it("resolveRate / effectiveShiftRate use derivation when rate unset", () => {
    const r = resolveRate({ jobId: "fm" }, [festMonthly], { ...DEFAULT_SETTINGS, defaultRate: 99 });
    expect(r.source).toBe("job");
    expect(r.rate).toBeCloseTo(2000 / ((37.5 * 52) / 12), 5);
    expect(
      effectiveShiftRate(
        {},
        { job: festMonthly, defaultRate: 99 },
      ),
    ).toBeCloseTo(r.rate, 5);
  });

  it("explicit job.rate wins over monthly derivation", () => {
    const withRate = { ...festMonthly, rate: 18 };
    expect(resolveRate({ jobId: "fm" }, [withRate], DEFAULT_SETTINGS).rate).toBe(18);
  });

  it("FLEX hourly unchanged (no monthly derivation)", () => {
    expect(effectiveHourlyFromMonthly(jobA)).toBeUndefined();
    expect(resolveRate({ jobId: "a" }, [jobA], { ...DEFAULT_SETTINGS, defaultRate: 12 }).rate).toBe(15);
    expect(effectiveShiftRate({}, { job: jobA, defaultRate: 12 })).toBe(15);
  });

  it("returns undefined without week hours or gross", () => {
    expect(effectiveHourlyFromMonthly({ ...festMonthly, monthlyGross: 0 })).toBeUndefined();
    expect(
      effectiveHourlyFromMonthly({
        ...festMonthly,
        week: EMPTY_WEEK.map((d) => ({ ...d, active: false })),
      }),
    ).toBeUndefined();
  });
});
