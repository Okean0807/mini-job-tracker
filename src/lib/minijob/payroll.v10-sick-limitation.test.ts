/**
 * v1.0 Release-Einschränkung D1 (Owner t617u) – Tests aus den bestätigten
 * Anforderungen (t599u #1/#3, t607u D4, t613u, t615u), NICHT aus dem Code:
 * - Lücke = leere Kalendertage strikt zwischen zwei Krankheitstagen
 *   (Fr → Mo = 2, Mo → Mo = 6) (t615u §1).
 * - Lücke ≥ 6 → nie automatische Zusammenfassung (t607u D4.3, t615u §1).
 * - Keine automatische Zusammenfassung ohne Bestätigung, keine stillen
 *   unbezahlten Tage, sichtbarer Hinweis (t617u §3, t599u #1).
 * - Vergangene Beträge ändern sich nur nach ausdrücklicher Bestätigung je
 *   Monat, mit Vorher/Nachher; die Vorschau selbst ändert nichts (O-2, t607u).
 * Keine Rechtsaussage (T6 offen).
 */
import { describe, expect, it } from "vitest";

import { isoDate } from "./calc";
import {
  SICK_AUTO_CONTINUOUS_ENABLED,
  SICK_SEPARATE_GAP_DAYS,
  continuousSickCase,
  isSickLegacyDiscrepancy,
  payrollTotals,
  shiftPayroll,
  sickRecalcPreview,
  type PayrollOptions,
} from "./payroll";
import type { Job, Shift } from "./types";

const RATE = 15;
const day = { start: "09:00", end: "14:00", breakMinutes: 0 };
function makeJob(active: boolean[] | undefined): Job {
  return {
    id: "j1",
    name: "j1",
    rate: RATE,
    color: "#000",
    ...(active ? { week: active.map((a) => ({ active: a, ...day })) } : {}),
    startDate: "2025-01-01",
  } as unknown as Job;
}
const onlyDays = (...idx: number[]) =>
  makeJob(Array.from({ length: 7 }, (_, i) => idx.includes(i)));
const MON_ONLY = onlyDays(0);
const MON_FRI = onlyDays(0, 1, 2, 3, 4);
const EVERY_DAY = onlyDays(0, 1, 2, 3, 4, 5, 6);

const sick = (date: string, marked = true): Shift =>
  ({
    id: `k-${date}`,
    jobId: "j1",
    kind: "krank",
    date,
    ...day,
    ...(marked ? { sickRule: "continuous" as const } : {}),
  }) as Shift;
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y!, m! - 1, d! + n));
}
function range(from: string, count: number, step = 1): string[] {
  return Array.from({ length: count }, (_, i) => addDays(from, i * step));
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

describe("D1 v1.0: automatische Zusammenfassung abgeschaltet", () => {
  it("Schalter ist für v1.0 aus", () => {
    expect(SICK_AUTO_CONTINUOUS_ENABLED).toBe(false);
  });
});

describe("Lückensemantik t615u (leere Kalendertage strikt dazwischen)", () => {
  it("Fr → Mo = 2 leere Tage: kein ≥ 6-Fall", () => {
    // 2026-11-06 ist Freitag, 2026-11-09 Montag
    const shifts = [sick("2026-11-06"), sick("2026-11-09")];
    expect(new Date("2026-11-06T12:00:00").getDay()).toBe(5);
    const res = continuousSickCase(shifts[1]!, MON_FRI, shifts);
    expect(res.separate).toBe(false);
  });

  it("Mo → nächster Mo = 6 leere Tage: ≥ 6 (nie automatisch zusammengefasst)", () => {
    expect(SICK_SEPARATE_GAP_DAYS).toBe(6);
    const shifts = [sick("2026-11-02"), sick("2026-11-09")];
    const res = continuousSickCase(shifts[1]!, MON_ONLY, shifts);
    expect(res.separate).toBe(true);
  });

  it("Mo → So (5 leere Tage) ist kein ≥ 6-Fall", () => {
    const sun = onlyDays(0, 6);
    const shifts = [sick("2026-11-02"), sick("2026-11-08")];
    expect(continuousSickCase(shifts[1]!, sun, shifts).separate).toBe(false);
  });
});

describe("Keine automatische Zusammenfassung, keine stillen unbezahlten Tage", () => {
  it("Lücke 0: 60 durchgehende neu erfasste Tage – ohne Bestätigung alle bezahlt, ab Tag 43 sichtbarer Hinweis", () => {
    const shifts = range("2026-11-02", 60).map((d) => sick(d));
    const ps = evalAll(shifts, EVERY_DAY);
    expect(ps.every((p) => p.paid && p.reason === "sick-pay")).toBe(true);
    expect(ps.slice(0, 42).some(isSickLegacyDiscrepancy)).toBe(false);
    expect(ps.slice(42).every(isSickLegacyDiscrepancy)).toBe(true);
  });

  it("Lücke ≥ 6 (nur Montage, 9 Wochen, neu erfasst): ohne Bestätigung alle bezahlt + Hinweis", () => {
    const shifts = range("2026-11-02", 9, 7).map((d) => sick(d));
    const ps = evalAll(shifts, MON_ONLY);
    expect(ps.every((p) => p.paid)).toBe(true);
    expect(ps.some((p) => p.reason === "sick-exceeded")).toBe(false);
    // Fall jenseits von 42 Tagen: Hinweis "möglicherweise verschiedene Erkrankungen"
    expect(ps.slice(6).every((p) => p.notice === "sick-case-possibly-separate")).toBe(true);
    expect(ps.slice(6).every(isSickLegacyDiscrepancy)).toBe(true);
  });

  it("Lücken 1–5 aus planfreien Tagen: keine Fortsetzung auf Grund des Wochenplans ohne Bestätigung", () => {
    // Plan Mo/Do: Do → Mo = 3 leere Kalendertage, 12 Wochen neu erfasst
    const monThu = onlyDays(0, 3);
    const dates = range("2026-11-02", 84).filter((d) => {
      const wd = new Date(d + "T12:00:00").getDay();
      return wd === 1 || wd === 4;
    });
    const shifts = dates.map((d) => sick(d));
    const ps = evalAll(shifts, monThu);
    expect(ps.every((p) => p.paid)).toBe(true);
    expect(ps.some((p) => p.reason === "sick-exceeded")).toBe(false);
  });

  it("ohne Wochenplan und ohne Historie: kein Schluss auf Fortsetzung, keine Kürzung", () => {
    const noPlan = makeJob(undefined);
    const shifts = range("2026-11-02", 60).map((d) => sick(d));
    const ps = evalAll(shifts, noPlan);
    expect(ps.some((p) => p.reason === "sick-exceeded")).toBe(false);
  });
});

describe("Vergangene Monate nur nach Bestätigung (O-2, Vorher/Nachher)", () => {
  const shifts = range("2026-11-02", 60).map((d) => sick(d));

  it("Vorschau zeigt Vorher/Nachher je Monat und verändert keine Daten", () => {
    const snapshot = JSON.stringify(shifts);
    const preview = sickRecalcPreview(shifts, resolveFor(EVERY_DAY));
    expect(JSON.stringify(shifts)).toBe(snapshot);
    expect(preview.map((m) => m.month)).toEqual(["2026-12"]);
    const dec = preview[0]!;
    expect(dec.after).toBeLessThan(dec.before);
    expect(dec.days).toBe(18); // 14.12.–31.12.
  });

  it("ohne Bestätigung (Abbrechen) bleiben alle Monatsbeträge unverändert", () => {
    const dec = shifts.filter((s) => s.date.startsWith("2026-12"));
    const nov = shifts.filter((s) => s.date.startsWith("2026-11"));
    const before = payrollTotals(dec, resolveFor(EVERY_DAY), shifts).earnings;
    sickRecalcPreview(shifts, resolveFor(EVERY_DAY));
    expect(payrollTotals(dec, resolveFor(EVERY_DAY), shifts).earnings).toBe(before);
    expect(payrollTotals(nov, resolveFor(EVERY_DAY), shifts).earnings).toBe(29 * 75);
  });

  it("Bestätigung wirkt nur auf den bestätigten Monat und entspricht dem angezeigten Nachher", () => {
    const preview = sickRecalcPreview(shifts, resolveFor(EVERY_DAY));
    const confirmed = resolveFor(EVERY_DAY, { sickContinuousConfirmed: ["2026-12"] });
    const dec = shifts.filter((s) => s.date.startsWith("2026-12"));
    const nov = shifts.filter((s) => s.date.startsWith("2026-11"));
    expect(payrollTotals(dec, confirmed, shifts).earnings).toBe(preview[0]!.after);
    expect(payrollTotals(nov, confirmed, shifts).earnings).toBe(
      payrollTotals(nov, resolveFor(EVERY_DAY), shifts).earnings,
    );
  });
});
