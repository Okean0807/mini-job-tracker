/**
 * C3 Etappe 1 – Referenzverhalten von Soll / Ist / Monatssaldo (Stand main 926af09).
 *
 * Dokumentiert, was HEUTE gilt – auch Auffälligkeiten, die nicht Teil dieser Etappe sind:
 * - Soll bleibt an Plantagen bestehen, egal welche Abwesenheit eingetragen ist.
 * - Ist zählt ausschließlich `arbeit`; bezahlte Abwesenheit (Krank/Urlaub/Feiertag) erscheint NICHT im Ist,
 *   deshalb ist der Monatssaldo trotz Entgeltfortzahlung negativ (Oktober: Ist 0, Soll 88, Saldo −88).
 * - `sickDays` zählt jeden Plantag mit Krankeintrag, auch unbezahlte Tage nach dem 42. Tag.
 * - Frei/Sonstige verringern Soll nicht und zählen nicht als Arbeitstag.
 * Die Werte wurden aus der laufenden Implementierung abgelesen. Nichts davon ist hier "korrigiert".
 */
import { describe, expect, it } from "vitest";

import { dayBalance, dayIstHours, daySollHours, monthTimeAccount } from "./fest-time-account";
import { sollHoursFor, summarizeHours } from "./hours-summary";
import { buildAnnualReport } from "./annual";
import { payrollTotals } from "./payroll";
import { makeResolver } from "./resolve";
import { generateAbsence } from "./schedule";
import { buildDailyMonthSeries, buildFestDailyMonthSeries } from "./stats-charts";
import { weekTimeAccount } from "./stats-week";
import { DEFAULT_SETTINGS, type FixedDay, type Job, type Shift } from "./types";

const day = (active: boolean): FixedDay => ({
  active,
  start: "08:00",
  end: "12:00",
  breakMinutes: 0,
});
const JOB: Job = {
  id: "F",
  name: "Fest",
  color: "#123456",
  rate: 15,
  mode: "fest",
  employmentType: "minijob",
  startDate: "2025-01-01",
  week: [true, true, true, true, true, false, false].map(day),
} as Job;
const settings = { ...DEFAULT_SETTINGS, bundesland: "BE" };
const resolver = makeResolver([JOB], settings);
const mk = (p: Partial<Shift> & { date: string; kind: Shift["kind"] }): Shift =>
  ({
    id: p.date + p.kind,
    jobId: "F",
    start: "08:00",
    end: "12:00",
    breakMinutes: 0,
    ...p,
  }) as Shift;

// Krankheitsfall 15.09.–30.10.2026 (34 Plantage; 27.–30.10. = Tag 43 ff., unbezahlt)
const sick = generateAbsence(JOB, "krank", "2026-09-15", "2026-10-30", "BE");
// November: 2 × Arbeit (4 h und 5 h), Frei (Mi), Sonstige (Do), Urlaub (Fr), Krank (Mo, eigener Fall),
// Feiertag (Di), Frei an einem Samstag
const nov: Shift[] = [
  mk({ date: "2026-11-02", kind: "arbeit" }),
  mk({ date: "2026-11-03", kind: "arbeit", end: "13:00" }),
  mk({ date: "2026-11-04", kind: "frei" }),
  mk({ date: "2026-11-05", kind: "sonstige" }),
  mk({ date: "2026-11-06", kind: "urlaub" }),
  mk({ date: "2026-11-07", kind: "frei" }),
  mk({ date: "2026-11-09", kind: "krank", sickCaseId: "k1" }),
  mk({ date: "2026-11-10", kind: "feiertag" }),
];
const all = [...sick, ...nov];

describe("Tagesfunktionen", () => {
  it("Plantag: Soll 4 h; Frei-Tag hat Ist 0 und Saldo −4; Arbeitstag mit 5 h hat +1", () => {
    expect(daySollHours(JOB, "2026-11-04", "BE")).toBe(4);
    expect(dayIstHours(JOB, "2026-11-04", nov)).toBe(0);
    expect(dayBalance(JOB, "2026-11-04", nov, "BE")).toBe(-4);
    expect(dayIstHours(JOB, "2026-11-03", nov)).toBe(5);
    expect(dayBalance(JOB, "2026-11-03", nov, "BE")).toBe(1);
  });
  it("Wochenende: Soll 0", () => {
    expect(daySollHours(JOB, "2026-11-07", "BE")).toBe(0);
  });
});

describe("monthTimeAccount", () => {
  it("November (Arbeit + Frei + Sonstige + Urlaub + Krank + Feiertag)", () => {
    expect(monthTimeAccount(JOB, 2026, 10, nov, "BE")).toEqual({
      year: 2026,
      month: 10,
      soll: 84,
      ist: 9,
      plus: 1,
      minus: 76,
      saldo: -75,
      workDays: 17,
      vacationDays: 1,
      sickDays: 1,
    });
  });
  it("Oktober: bezahlte Krankheit steht NICHT im Ist; 22 Krank-Plantage inkl. 4 unbezahlte; keine Arbeitstage", () => {
    expect(monthTimeAccount(JOB, 2026, 9, all, "BE")).toEqual({
      year: 2026,
      month: 9,
      soll: 88,
      ist: 0,
      plus: 0,
      minus: 88,
      saldo: -88,
      workDays: 0,
      vacationDays: 0,
      sickDays: 22,
    });
  });
  it("Frei/Sonstige ändern Soll und Ist nicht; sie nehmen nur den Plantag aus workDays", () => {
    const without = nov.filter((s) => s.kind !== "frei" && s.kind !== "sonstige");
    const a = monthTimeAccount(JOB, 2026, 10, nov, "BE");
    const b = monthTimeAccount(JOB, 2026, 10, without, "BE");
    expect([a.soll, a.ist, a.plus, a.saldo]).toEqual([b.soll, b.ist, b.plus, b.saldo]);
    // Frei (Mi) und Sonstige (Do) sind Plantage → workDays −2; Frei am Samstag ändert nichts
    expect(a.workDays).toBe(b.workDays - 2);
  });
});

describe("Woche und Tagesdiagramm folgen derselben Semantik", () => {
  it("weekTimeAccount 02.–08.11.: Soll 20, Ist 9, Saldo −11", () => {
    const week = { start: "2026-11-02", end: "2026-11-08" } as never;
    const acc = weekTimeAccount(JOB, week, nov, "2026-12-01", "BE");
    expect([acc.soll, acc.ist, acc.saldo]).toEqual([20, 9, -11]);
    expect(acc.days.map((d) => [d.date.slice(8), d.soll, d.ist, d.diff])).toEqual([
      ["02", 4, 4, 0],
      ["03", 4, 5, 1],
      ["04", 4, 0, -4],
      ["05", 4, 0, -4],
      ["06", 4, 0, -4],
      ["07", 0, 0, 0],
      ["08", 0, 0, 0],
    ]);
  });
  it("Fest-Tagesdiagramm (Soll/Ist) und Verdienstdiagramm: Urlaub bringt Geld, aber keine Stunden", () => {
    const fest = buildFestDailyMonthSeries(2026, 10, JOB, nov, "BE").slice(1, 6);
    expect(fest.map((d) => [d.soll, d.ist, d.diff])).toEqual([
      [4, 4, 0],
      [4, 5, 1],
      [4, 0, -4],
      [4, 0, -4],
      [4, 0, -4],
    ]);
    const money = buildDailyMonthSeries(2026, 10, nov, resolver, all).slice(1, 6);
    expect(money.map((d) => [d.verdienst, d.stunden])).toEqual([
      [60, 4],
      [75, 5],
      [0, 0],
      [0, 0],
      [60, 0],
    ]);
  });
});

describe("Stunden-Kennzahlen (#159) bleiben mit Frei/Sonstige unverändert", () => {
  const without = nov.filter((s) => s.kind !== "frei" && s.kind !== "sonstige");
  const soll = sollHoursFor([JOB], 2026, 10, "BE");
  it("November: 9 h gearbeitet, 12 h bezahlte Abwesenheit, 21 h gesamt, Soll 84, 315 €", () => {
    expect(soll).toBe(84);
    expect(summarizeHours(nov, resolver, all, soll)).toEqual({
      worked: 9,
      paidAbsence: 12,
      paidTotal: 21,
      soll: 84,
    });
    expect(payrollTotals(nov, resolver, all).earnings).toBe(315);
  });
  it("identisch ohne die Frei/Sonstige-Einträge", () => {
    expect(summarizeHours(nov, resolver, all, soll)).toEqual(
      summarizeHours(without, resolver, all, soll),
    );
    expect(payrollTotals(nov, resolver, all)).toEqual(payrollTotals(without, resolver, all));
  });
  it("Oktober: 0 / 72 / 72 / Soll 88 und 1.080 €", () => {
    const oct = all.filter((s) => s.date.startsWith("2026-10"));
    expect(summarizeHours(oct, resolver, all, sollHoursFor([JOB], 2026, 9, "BE"))).toEqual({
      worked: 0,
      paidAbsence: 72,
      paidTotal: 72,
      soll: 88,
    });
    expect(payrollTotals(oct, resolver, all).earnings).toBe(1080);
  });
  it("Jahresbericht: Einträge zählen Frei/Sonstige mit, Stunden und Geld nicht", () => {
    const a = buildAnnualReport(all, [JOB], settings, 2026, resolver);
    const b = buildAnnualReport([...sick, ...without], [JOB], settings, 2026, resolver);
    expect(a.entries).toBe(b.entries + 3);
    expect([a.hours, a.absenceHours, a.paidHours, a.earnings]).toEqual([
      b.hours,
      b.absenceHours,
      b.paidHours,
      b.earnings,
    ]);
    expect([a.hours, a.absenceHours, a.paidHours, a.earnings, a.sollHours]).toEqual([
      9, 132, 141, 2115, 1044,
    ]);
  });
});
