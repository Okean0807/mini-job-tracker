/**
 * D4 (Owner R4): Krankheits-Ketten mit einer Lücke von ≥ 6 leeren
 * Kalendertagen werden NIE automatisch zusammengefasst (auch nicht bei neu
 * erfassten Tagen). Keine stillen UNPAID-Tage (R3-Probe 2.2: Plan nur Montag,
 * Montage 7–8). Vorher/Nachher über die O-2-Vorschau, Hinweis
 * "möglicherweise verschiedene Erkrankungen". T6 bleibt offen.
 *
 * Semantik "Kalendertage" (dokumentiert, ggf. Owner-Klärung): gezählt werden
 * die Kalendertage STRIKT ZWISCHEN zwei Krankheitstagen derselben vermuteten
 * Kette (Mo → Mo der Folgewoche = 6). Planfreie Tage, Wochenenden und Feiertage
 * zählen mit.
 */
import { describe, expect, it } from "vitest";

import { isoDate } from "./calc";
import {
  SICK_SEPARATE_GAP_DAYS,
  continuousSickCase,
  isSickLegacyDiscrepancy,
  shiftPayroll,
  sickRecalcPreview,
  type PayrollOptions,
} from "./payroll";
import { currentSickConfirmations, withSickConfirmations } from "./sick-confirmation";
import { normalize } from "./store";
import type { Job, Shift } from "./types";

const RATE = 15;
const day = { start: "09:00", end: "14:00", breakMinutes: 0 };
/** active[0] = Montag … active[6] = Sonntag */
function makeJob(active: boolean[]): Job {
  return {
    id: "j1",
    name: "j1",
    rate: RATE,
    color: "#000",
    week: active.map((a) => ({ active: a, ...day })),
    startDate: "2025-01-01",
  } as unknown as Job;
}
const onlyDays = (...idx: number[]) =>
  makeJob(Array.from({ length: 7 }, (_, i) => idx.includes(i)));
const MON_ONLY = onlyDays(0);
const MON_FRI = onlyDays(0, 1, 2, 3, 4);

function sick(date: string, marked = false): Shift {
  return {
    id: `k-${date}`,
    jobId: "j1",
    kind: "krank",
    date,
    ...day,
    ...(marked ? { sickRule: "continuous" as const } : {}),
  } as Shift;
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y!, m! - 1, d! + n));
}
function mondays(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(from, 7 * i));
}
const evalAll = (shifts: Shift[], job: Job, more: PayrollOptions = {}) =>
  shifts.map((s) => shiftPayroll(s, { job, defaultRate: RATE, history: shifts, ...more }));
const resolveFor =
  (job: Job, more: PayrollOptions = {}) =>
  () => ({
    job,
    defaultRate: RATE,
    ...more,
  });

describe("D4: Lücke in Kalendertagen", () => {
  it("Schwelle ist 6 leere Kalendertage", () => {
    expect(SICK_SEPARATE_GAP_DAYS).toBe(6);
  });

  // Plan so wählen, dass die Tage zwischen den beiden Krankheitstagen planfrei
  // sind – sonst beendet ein leerer Arbeitstag die Kette ohnehin.
  const cases: { gap: number; job: Job; from: string; to: string }[] = [
    { gap: 0, job: onlyDays(0, 1), from: "2026-11-02", to: "2026-11-03" },
    { gap: 1, job: onlyDays(0, 2), from: "2026-11-02", to: "2026-11-04" },
    { gap: 2, job: onlyDays(0, 3), from: "2026-11-02", to: "2026-11-05" },
    { gap: 3, job: onlyDays(0, 4), from: "2026-11-02", to: "2026-11-06" },
    { gap: 4, job: onlyDays(0, 5), from: "2026-11-02", to: "2026-11-07" },
    { gap: 5, job: onlyDays(0, 6), from: "2026-11-02", to: "2026-11-08" },
    { gap: 6, job: MON_ONLY, from: "2026-11-02", to: "2026-11-09" },
  ];
  for (const c of cases) {
    it(`Lücke ${c.gap} Kalendertag(e) → separate=${c.gap >= 6}`, () => {
      const shifts = [sick(c.from, true), sick(c.to, true)];
      const res = continuousSickCase(shifts[1]!, c.job, shifts);
      expect(res.start).toBe(c.from); // Kette wird erkannt …
      expect(res.separate).toBe(c.gap >= 6); // … aber ab 6 nie automatisch zusammengefasst
    });
  }

  it("Lücke ≥ 6 innerhalb der ersten 6 Wochen: kein Betragsunterschied → kein Hinweis (keine Fehlwarnung)", () => {
    const shifts = mondays("2026-11-02", 6).map((d) => sick(d, true));
    const ps = evalAll(shifts, MON_ONLY);
    expect(ps.every((p) => p.paid && p.notice === undefined)).toBe(true);
  });
});

describe("D4: Plan nur Montag, 8 Montage (R3-Probe 2.2)", () => {
  const dates = mondays("2026-11-02", 8); // 02.11. … 21.12.

  it("neu erfasst (markiert): Montage 7–8 NICHT still unbezahlt – bezahlt + Hinweis", () => {
    const shifts = dates.map((d) => sick(d, true));
    const ps = evalAll(shifts, MON_ONLY);
    expect(ps.every((p) => p.paid)).toBe(true);
    expect(ps.slice(0, 6).every((p) => p.notice === undefined)).toBe(true);
    expect(ps.slice(6).map((p) => p.notice)).toEqual([
      "sick-case-possibly-separate",
      "sick-case-possibly-separate",
    ]);
    expect(ps.slice(6).every(isSickLegacyDiscrepancy)).toBe(true);
  });

  it("Vorschau zeigt Vorher/Nachher und 'möglicherweise verschiedene Erkrankungen' (N19)", () => {
    for (const marked of [true, false]) {
      const shifts = dates.map((d) => sick(d, marked));
      const preview = sickRecalcPreview(shifts, resolveFor(MON_ONLY));
      expect(preview).toEqual([
        {
          month: "2026-12",
          days: 2,
          before: 3 * 5 * RATE, // 07.12., 14.12., 21.12.
          after: 1 * 5 * RATE, // R3-Probe: 225 → 75
          reviewDays: 2,
          separateDays: 2,
        },
      ]);
    }
  });

  it("alte Datensätze (unmarkiert) behalten die Vorschau und erhalten die Erklärung", () => {
    const shifts = dates.map((d) => sick(d));
    const ps = evalAll(shifts, MON_ONLY);
    expect(ps.slice(6).map((p) => p.notice)).toEqual([
      "sick-case-possibly-separate",
      "sick-case-possibly-separate",
    ]);
    expect(ps.every((p) => p.paid)).toBe(true);
  });

  it("nach Bestätigung (O-2): Montage 7–8 unbezahlt, Hinweis bleibt sichtbar", () => {
    const shifts = dates.map((d) => sick(d));
    const ps = evalAll(shifts, MON_ONLY, { sickContinuousConfirmed: ["2026-12"] });
    expect(ps.slice(6).map((p) => [p.paid, p.reason, p.notice])).toEqual([
      [false, "sick-exceeded", "sick-case-possibly-separate"],
      [false, "sick-exceeded", "sick-case-possibly-separate"],
    ]);
    expect(ps.slice(0, 6).every((p) => p.paid)).toBe(true);
    expect(ps.slice(6).some(isSickLegacyDiscrepancy)).toBe(false);
  });

  it("bestätigte Monate bleiben bestätigt; Signatur hängt an denselben Tagen", () => {
    const shifts = dates.map((d) => sick(d));
    const conf = withSickConfirmations(undefined, ["2026-12"], shifts, [MON_ONLY]);
    expect(conf.map((c) => c.month)).toEqual(["2026-12"]);
    expect(currentSickConfirmations(conf, shifts, [MON_ONLY])).toEqual(conf);
    // Markierung ändern (neu erfasst ↔ alt) ändert die Signatur nicht → Bestätigung bleibt.
    const marked = shifts.map((s) => ({ ...s, sickRule: "continuous" as const }));
    expect(currentSickConfirmations(conf, marked, [MON_ONLY])).toEqual(conf);
  });

  it("Import/Backup: Markierung überlebt normalize, Ergebnis bleibt nicht still", () => {
    const shifts = dates.map((d) => sick(d, true));
    const restored = normalize({ jobs: [MON_ONLY], shifts } as never);
    const ps = evalAll(restored.shifts, MON_ONLY);
    expect(restored.shifts.every((s) => s.sickRule === "continuous")).toBe(true);
    expect(ps.every((p) => p.paid)).toBe(true);
    expect(ps.filter((p) => p.notice === "sick-case-possibly-separate")).toHaveLength(2);
  });
});

describe("D4: Ketten ohne Lücke ≥ 6 – 42-Tage-Grenze unverändert", () => {
  it("Mo–Fr, 9 Wochen neu erfasst: Wochenend-Lücken (2) werden weiter automatisch verbunden", () => {
    const all: string[] = [];
    for (let i = 0; i < 63; i += 1) {
      const d = addDays("2026-11-02", i);
      const wd = new Date(d + "T12:00:00").getDay();
      if (wd >= 1 && wd <= 5) all.push(d);
    }
    const shifts = all.map((d) => sick(d, true));
    const ps = evalAll(shifts, MON_FRI);
    const unpaid = shifts.filter((_, i) => !ps[i]!.paid).map((s) => s.date);
    expect(unpaid[0]).toBe("2026-12-14"); // 02.11. + 42 Tage
    expect(ps.some((p) => p.notice === "sick-case-possibly-separate")).toBe(false);
  });

  it("Markierung gemischt (ein Tag alt): keine automatische Zusammenfassung", () => {
    const shifts = mondays("2026-11-02", 8).map((d, i) => sick(d, i !== 3));
    const res = continuousSickCase(shifts[7]!, MON_ONLY, shifts);
    expect(res.marked).toBe(false);
    expect(evalAll(shifts, MON_ONLY).every((p) => p.paid)).toBe(true);
  });
});
