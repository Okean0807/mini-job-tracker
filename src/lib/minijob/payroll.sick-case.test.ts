/**
 * Regression: Krankheitsfall-Fortsetzungsregel (DECISIONS R2, Sick pay).
 * T1–T8 + Randfälle. Daten ab dem Stichtag SICK_CONTINUOUS_RULE_FROM,
 * sofern nicht ausdrücklich das Altverhalten geprüft wird.
 */
import { describe, expect, it } from "vitest";

import { isoDate } from "./calc";
import {
  SICK_CONTINUOUS_RULE_FROM,
  continuousSickCase,
  payrollTotals,
  shiftPayroll,
  sickLegacyDiscrepancies,
  type PayrollOptions,
} from "./payroll";
import type { Job, Shift } from "./types";

const RATE = 15;
const day = { start: "09:00", end: "14:00", breakMinutes: 0 };

function makeJob(activeDays: boolean[], startDate = "2026-01-01", id = "j1"): Job {
  return {
    id,
    name: "Job " + id,
    rate: RATE,
    color: "#000",
    week: activeDays.map((active) => ({ active, ...day })),
    startDate,
  } as unknown as Job;
}

const ALL_DAYS = makeJob([true, true, true, true, true, true, true]);
const MON_FRI = makeJob([true, true, true, true, true, false, false]);
const MON_TUE = makeJob([true, true, false, false, false, false, false]);

function entry(date: string, kind: Shift["kind"] = "krank", extra: Partial<Shift> = {}): Shift {
  return {
    id: `${extra.jobId ?? "j1"}-${date}-${kind}-${extra.sickCaseId ?? ""}`,
    jobId: "j1",
    kind,
    date,
    ...day,
    ...extra,
  } as Shift;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y!, m! - 1, d! + n));
}

function sickRun(from: string, days: number, extra: Partial<Shift> = {}): Shift[] {
  return Array.from({ length: days }, (_, i) => entry(addDays(from, i), "krank", extra));
}

function evaluate(shifts: Shift[], job: Job, history: Shift[] = shifts, more: PayrollOptions = {}) {
  return shifts.map((s) => shiftPayroll(s, { job, defaultRate: RATE, history, ...more }));
}

const count = (ps: { reason: string }[], reason: string) =>
  ps.filter((p) => p.reason === reason).length;

describe("Stichtag", () => {
  it("ist ein fester ISO-Tag (Owner-Entscheidung)", () => {
    expect(SICK_CONTINUOUS_RULE_FROM).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("T1–T8", () => {
  it("T1: 60 Kalendertage krank ohne ID (Plan Mo–So) → 42 bezahlt, 18 überschritten; Tag 42/43", () => {
    const run = sickRun("2026-11-02", 60);
    const ps = evaluate(run, ALL_DAYS);
    expect(count(ps, "sick-pay")).toBe(42);
    expect(count(ps, "sick-exceeded")).toBe(18);
    expect(ps[41]!.reason).toBe("sick-pay"); // Tag 42 = 2026-12-13
    expect(run[41]!.date).toBe("2026-12-13");
    expect(ps[42]!.reason).toBe("sick-exceeded"); // Tag 43
    expect(ps.reduce((a, p) => a + p.earnings, 0)).toBeCloseTo(42 * 5 * RATE);
    expect(ps.some((p) => p.notice)).toBe(false);
  });

  it("T2: dieselben 60 Tage mit einer sickCaseId → 42 bezahlt (unverändert)", () => {
    const ps = evaluate(sickRun("2026-11-02", 60, { sickCaseId: "c1" }), ALL_DAYS);
    expect(count(ps, "sick-pay")).toBe(42);
    expect(count(ps, "sick-exceeded")).toBe(18);
  });

  it("T3: Plan Mo–Fr, 9 Wochen Mo–Fr krank, Wochenenden leer → ein Fall, 30 bezahlt, 15 überschritten", () => {
    const run: Shift[] = [];
    for (let w = 0; w < 9; w++) {
      for (let d = 0; d < 5; d++) run.push(entry(addDays("2026-11-02", w * 7 + d)));
    }
    const ps = evaluate(run, MON_FRI);
    expect(count(ps, "sick-pay")).toBe(30);
    expect(count(ps, "sick-exceeded")).toBe(15);
    // Montag der 7. Woche = Kalendertag 43 → überschritten
    const idx = run.findIndex((s) => s.date === "2026-12-14");
    expect(ps[idx]!.reason).toBe("sick-exceeded");
    expect(ps[idx - 1]!.reason).toBe("sick-pay"); // Fr 2026-12-11
  });

  it("T4: 10 krank, 1 Arbeitstag, 10 krank (ohne ID) → zwei Fälle, 20 bezahlt, kein Hinweis", () => {
    const shifts = [
      ...sickRun("2026-11-02", 10),
      entry("2026-11-12", "arbeit"),
      ...sickRun("2026-11-13", 10),
    ];
    const ps = evaluate(
      shifts.filter((s) => s.kind === "krank"),
      ALL_DAYS,
      shifts,
    );
    expect(count(ps, "sick-pay")).toBe(20);
    expect(continuousSickCase(shifts[11]!, ALL_DAYS, shifts).start).toBe("2026-11-13");
    expect(ps.some((p) => p.notice)).toBe(false);
  });

  it("T4b: leerer regelmäßiger Arbeitstag trennt den Fall, aber mit Hinweis 'sick-case-ambiguous'", () => {
    const shifts = [...sickRun("2026-11-02", 10), ...sickRun("2026-11-13", 10)];
    const ps = evaluate(shifts, ALL_DAYS);
    expect(count(ps, "sick-pay")).toBe(20);
    expect(ps[10]!.notice).toBe("sick-case-ambiguous");
    expect(continuousSickCase(shifts[10]!, ALL_DAYS, shifts)).toEqual({
      start: "2026-11-13",
      ambiguous: true,
    });
  });

  it("T5: zwei Bereiche mit verschiedenen IDs (30+30) → 60 bezahlt, Hinweis am zweiten Fall", () => {
    const shifts = [
      ...sickRun("2026-11-02", 30, { sickCaseId: "a" }),
      ...sickRun("2026-12-02", 30, { sickCaseId: "b" }),
    ];
    const ps = evaluate(shifts, ALL_DAYS);
    expect(count(ps, "sick-pay")).toBe(60);
    expect(ps[29]!.notice).toBeUndefined();
    expect(ps[30]!.notice).toBe("sick-case-ambiguous");
  });

  it("T6 (documents CURRENT behaviour only – waiting days vs. 6 weeks is an OPEN legal question, UNVERIFIED): start 01.11., sick from 10.11. for 60 days → 19 waiting, 23 paid, 18 exceeded", () => {
    const job = makeJob([true, true, true, true, true, true, true], "2026-11-01");
    const ps = evaluate(sickRun("2026-11-10", 60), job);
    expect(count(ps, "sick-waiting")).toBe(19); // 10.11.–28.11.
    expect(count(ps, "sick-pay")).toBe(23); // 29.11.–21.12.
    expect(count(ps, "sick-exceeded")).toBe(18);
  });

  it("T7: krank an einem nicht regelmäßigen Tag → sick-off-day, unbezahlt", () => {
    const [p] = evaluate([entry("2026-11-04")], MON_TUE); // Mittwoch
    expect(p!.reason).toBe("sick-off-day");
    expect(p!.earnings).toBe(0);
  });

  it("T8: vor dem Stichtag keine automatische Neuberechnung — nur Hinweis", () => {
    const run = sickRun("2026-03-02", 60);
    const ps = evaluate(run, ALL_DAYS);
    expect(count(ps, "sick-pay")).toBe(60); // Altverhalten
    expect(ps.filter((p) => p.notice === "sick-legacy-over-limit")).toHaveLength(18);
    expect(ps[41]!.notice).toBeUndefined();
    const flagged = sickLegacyDiscrepancies(run, () => ({ job: ALL_DAYS, defaultRate: RATE }));
    expect(flagged.map((s) => s.date)).toEqual(run.slice(42).map((s) => s.date));
    // Gesteuerte Neuberechnung (z. B. nach Nutzerbestätigung) über Option
    const recalculated = evaluate(run, ALL_DAYS, run, { sickContinuousFrom: "2026-01-01" });
    expect(count(recalculated, "sick-pay")).toBe(42);
    expect(recalculated.some((p) => p.notice)).toBe(false);
  });
});

describe("Randfälle", () => {
  it("Monatsgrenze: Fall über Nov/Dez/Jan zählt mit voller Historie korrekt", () => {
    const run = sickRun("2026-11-20", 47); // bis 2027-01-05
    const december = run.filter((s) => s.date.startsWith("2026-12"));
    const totals = payrollTotals(december, () => ({ job: ALL_DAYS, defaultRate: RATE }), run);
    // 20.11. + 41 = 31.12. ist Tag 42 → ganzer Dezember bezahlt
    expect(totals.absenceEarnings).toBeCloseTo(31 * 5 * RATE);
    const january = run.filter((s) => s.date.startsWith("2027-01"));
    const jan = evaluate(january, ALL_DAYS, run);
    expect(count(jan, "sick-exceeded")).toBe(5);
  });

  it("Monatsgrenze: nur die Monatsliste als Historie würde den Fall abschneiden (deshalb history=alle)", () => {
    const run = sickRun("2026-11-20", 47);
    const january = run.filter((s) => s.date.startsWith("2027-01"));
    expect(count(evaluate(january, ALL_DAYS, january), "sick-pay")).toBe(5);
  });

  it("Fall, der vor dem Stichtag beginnt, zählt die Tage vor dem Stichtag mit", () => {
    const run = sickRun("2026-10-15", 60);
    const ps = evaluate(run, ALL_DAYS);
    // 15.10. + 42 = 26.11. → ab dort überschritten (nach Stichtag)
    const firstExceeded = run[ps.findIndex((p) => p.reason === "sick-exceeded")]!.date;
    expect(firstExceeded).toBe("2026-11-26");
    expect(count(ps, "sick-pay")).toBe(42);
    expect(ps.some((p) => p.notice)).toBe(false);
  });

  it("Urlaub zwischen Krankheitstagen beendet den Fall", () => {
    const shifts = [
      ...sickRun("2026-11-02", 5),
      entry("2026-11-07", "urlaub"),
      ...sickRun("2026-11-08", 3),
    ];
    expect(continuousSickCase(shifts[6]!, ALL_DAYS, shifts)).toEqual({
      start: "2026-11-08",
      ambiguous: false,
    });
  });

  it("Wochenend-Lücke (Plan Mo–Fr) verbindet Fr und Mo", () => {
    const shifts = [entry("2026-11-06"), entry("2026-11-09")]; // Fr, Mo
    expect(continuousSickCase(shifts[1]!, MON_FRI, shifts).start).toBe("2026-11-06");
  });

  it("Lücke über freie Tage (Plan Mo–Di) verbindet Di und Mo der Folgewoche", () => {
    const shifts = [entry("2026-11-03"), entry("2026-11-09")];
    expect(continuousSickCase(shifts[1]!, MON_TUE, shifts).start).toBe("2026-11-03");
  });

  it("Einträge anderer Jobs werden nicht verkettet", () => {
    const shifts = [entry("2026-11-02", "krank", { jobId: "j2" }), entry("2026-11-03")];
    expect(continuousSickCase(shifts[1]!, ALL_DAYS, shifts).start).toBe("2026-11-03");
  });

  it("ohne ID nach explizitem Fall: nicht zusammengeführt, Hinweis", () => {
    const shifts = [
      ...sickRun("2026-11-02", 40, { sickCaseId: "c" }),
      ...sickRun("2026-12-12", 10),
    ];
    const ps = evaluate(shifts, ALL_DAYS);
    expect(count(ps, "sick-pay")).toBe(50);
    expect(ps[40]!.notice).toBe("sick-case-ambiguous");
  });

  it("explizite sickCaseId bleibt maßgeblich (verstreute Tage desselben Falls zählen ab Fallbeginn)", () => {
    const shifts = [
      entry("2026-11-02", "krank", { sickCaseId: "x" }),
      entry("2026-12-14", "krank", { sickCaseId: "x" }),
    ];
    const ps = evaluate(shifts, ALL_DAYS);
    expect(ps[1]!.reason).toBe("sick-exceeded"); // 42 Tage nach 02.11.
  });

  it("verstreute Zeiträume ohne ID werden nicht zusammengeführt", () => {
    const shifts = [
      ...sickRun("2026-11-02", 30),
      entry("2026-12-02", "arbeit"),
      ...sickRun("2026-12-03", 30),
    ];
    const ps = evaluate(
      shifts.filter((s) => s.kind === "krank"),
      ALL_DAYS,
      shifts,
    );
    expect(count(ps, "sick-pay")).toBe(60);
  });
});

describe("QA R1 gaps (M144-1, M144-2)", () => {
  it("Stichtag selbst: am Tag `sickContinuousFrom` gilt bereits die neue Regel", () => {
    const run = sickRun("2026-03-01", 45);
    const cutoff = run[42]!.date; // Tag 43
    const ps = evaluate(run, ALL_DAYS, run, { sickContinuousFrom: cutoff });
    expect(ps[42]!.reason).toBe("sick-exceeded");
    expect(ps[42]!.notice).toBeUndefined();
    // Tag davor: Altverhalten (Tag 42 ist ohnehin bezahlt)
    expect(ps[41]!.reason).toBe("sick-pay");
    // Ein Tag später als Stichtag → Tag 43 noch Altverhalten + Hinweis
    const later = evaluate(run, ALL_DAYS, run, { sickContinuousFrom: run[43]!.date });
    expect(later[42]!.reason).toBe("sick-pay");
    expect(later[42]!.notice).toBe("sick-legacy-over-limit");
  });

  it("mehrtägige Lücke im Hinweisfenster (2 leere Arbeitstage) → sick-case-ambiguous", () => {
    // Plan Mo–Fr: krank Mi 04.11.; Do/Fr leer (regelmäßig); krank Mo 09.11.
    const shifts = [entry("2026-11-04"), entry("2026-11-09")];
    const res = continuousSickCase(shifts[1]!, MON_FRI, shifts);
    expect(res).toEqual({ start: "2026-11-09", ambiguous: true });
    const [, p] = evaluate(shifts, MON_FRI);
    expect(p!.notice).toBe("sick-case-ambiguous");
  });

  it("Krankheit länger als 7 Tage vor der Lücke → kein Hinweis", () => {
    const shifts = [entry("2026-11-02"), entry("2026-11-12")]; // dazwischen 9 leere Tage, Plan Mo–So
    expect(continuousSickCase(shifts[1]!, ALL_DAYS, shifts).ambiguous).toBe(false);
  });
});
