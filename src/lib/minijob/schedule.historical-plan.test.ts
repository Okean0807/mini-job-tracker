/**
 * V10-ABSENCE-HISTORICAL-SCHEDULE: Abwesenheitszeiträume (Urlaub UND Krank) werden
 * nach dem Wochenplan angelegt, der AM JEWEILIGEN DATUM galt (weekHistory), genau wie
 * die Payroll ihn auswertet (weekForDate). Früher galt der aktuelle Plan:
 *  A) Mo–Fr → nur Mo: rückwirkend 07.–11.09. nur 1 Tag / 75 € statt 5 Tage / 375 €;
 *  B) Mo–Fr → alle Tage: 7 Tage / 525 € statt 5 Tage / 375 €.
 * Fehlt der historische Plan für ein Datum (ungültiger Eintrag), wird nicht geraten.
 */
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { monthTimeAccount, weekForDate } from "./fest-time-account";
import { isRegularWorkday, payrollTotals, shiftPayroll } from "./payroll";
import { makeResolver } from "./resolve";
import { absenceDayTimes, generateAbsence } from "./schedule";
import { addAbsence, planAbsence } from "./service";
import { DEMO_SCOPE } from "./storage-scope";
import { activateScope, EMPTY_DATA, getData, loadFromStorage, replaceAll } from "./store";
import { DEFAULT_SETTINGS, type AppData, type FixedDay, type Job, type Shift } from "./types";
import { absencePlanDay } from "./week-plan";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const d5 = { start: "09:00", end: "14:00", breakMinutes: 0 };
const days = (flags: boolean[], t: Omit<FixedDay, "active"> = d5): FixedDay[] =>
  flags.map((active) => ({ active, ...t }));
const MON_FRI = days([true, true, true, true, true, false, false]);
const MON_ONLY = days([true, false, false, false, false, false, false]);
const ALL = days([true, true, true, true, true, true, true]);
const MON_WED = days([true, false, true, false, false, false, false]);

/** Job, dessen Plan am 01.10.2026 von `before` auf `current` gewechselt hat. */
function job(current: FixedDay[] | undefined, before?: FixedDay[] | null, id = "j1"): Job {
  return {
    id,
    name: id,
    color: "#000",
    mode: "fest",
    employmentType: "minijob",
    rate: 15,
    startDate: "2025-01-01",
    ...(current ? { week: current } : {}),
    ...(before !== undefined
      ? { weekHistory: [{ effectiveFrom: "2026-10-01", week: before as FixedDay[] }] }
      : {}),
  } as unknown as Job;
}
const S = { ...DEFAULT_SETTINGS, bundesland: "BE" };
const dataWith = (jobs: Job[], shifts: Shift[] = []) =>
  ({ ...EMPTY_DATA, jobs, shifts, settings: S }) as unknown as AppData;
const dates = (xs: Shift[]) => xs.map((s) => s.date);
const total = (j: Job, shifts: Shift[]) =>
  payrollTotals(shifts, makeResolver([j], S), shifts).earnings;
const WEEK_0907 = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"];

describe("Plan nach dem Abwesenheitszeitraum geändert (Urlaub und Krank)", () => {
  for (const kind of ["urlaub", "krank"] as const) {
    it(`${kind}: Mo–Fr → nur Mo (Wechsel 01.10.), rückwirkend 07.–11.09. → 5 Tage / 375 €`, () => {
      const j = job(MON_ONLY, MON_FRI);
      const created = generateAbsence(j, kind, "2026-09-07", "2026-09-11", "BE");
      expect(dates(created)).toEqual(WEEK_0907);
      expect(total(j, created)).toBe(375);
      // auch über planAbsence (AbsenceDialog) identisch
      const plan = planAbsence(j, kind, "2026-09-07", "2026-09-11", undefined, dataWith([j]));
      expect(dates(plan.created)).toEqual(WEEK_0907);
      expect(plan.removeIds).toEqual([]);
    });

    it(`${kind}: Mo–Fr → alle Tage (Erweiterung), 07.–13.09. → 5 Tage / 375 € (kein Sa/So)`, () => {
      const j = job(ALL, MON_FRI);
      const created = generateAbsence(j, kind, "2026-09-07", "2026-09-13", "BE");
      expect(dates(created)).toEqual(WEEK_0907);
      expect(total(j, created)).toBe(375);
    });
  }

  it("Auswirkung auf Monatsentgelt (Minijob-Grenze) und Urlaubs-/Krankheitstage im Zeitkonto", () => {
    for (const current of [MON_ONLY, ALL]) {
      const j = job(current, MON_FRI);
      const vac = generateAbsence(j, "urlaub", "2026-09-07", "2026-09-13", "BE");
      const sick = generateAbsence(j, "krank", "2026-09-14", "2026-09-20", "BE");
      const all = [...vac, ...sick];
      const sep = payrollTotals(all, makeResolver([j], S), all);
      expect(sep.earnings).toBe(750); // Eingabe der Monats-/Grenzberechnung
      const acc = monthTimeAccount(j, 2026, 8, all, "BE");
      expect(acc.vacationDays).toBe(5);
      expect(acc.sickDays).toBe(5);
    }
  });

  it("jeder angelegte Tag ist laut Payroll ein regelmäßiger Arbeitstag (gleiche Plan-Quelle)", () => {
    for (const current of [MON_ONLY, ALL, MON_WED]) {
      const j = job(current, MON_FRI);
      const created = generateAbsence(j, "urlaub", "2026-08-01", "2026-10-31", "BE");
      expect(created.length).toBeGreaterThan(0);
      for (const s of created) expect(isRegularWorkday(s.date, j, created)).toBe(true);
    }
  });
});

describe("Richtung des Planwechsels", () => {
  it("historisch freier Tag, im neuen Plan Arbeitstag → wird NICHT angelegt (Sa 12.09.)", () => {
    const j = job(ALL, MON_FRI);
    for (const kind of ["urlaub", "krank"] as const) {
      expect(generateAbsence(j, kind, "2026-09-12", "2026-09-13", "BE")).toEqual([]);
    }
    expect(absencePlanDay(j, "2026-09-12")).toEqual({ status: "off" });
    expect(absencePlanDay(j, "2026-10-03").status).toBe("work"); // nach dem Wechsel: Sa aktiv
  });

  it("historischer Arbeitstag, im neuen Plan frei → wird angelegt (Di 08.09.), nach dem Wechsel nicht", () => {
    const j = job(MON_WED, MON_FRI);
    for (const kind of ["urlaub", "krank"] as const) {
      expect(dates(generateAbsence(j, kind, "2026-09-08", "2026-09-08", "BE"))).toEqual([
        "2026-09-08",
      ]);
      expect(generateAbsence(j, kind, "2026-10-06", "2026-10-06", "BE")).toEqual([]);
    }
  });

  it("Zeiten kommen aus dem am Datum gültigen Plan", () => {
    const old = days([true, true, true, true, true, false, false], {
      start: "08:00",
      end: "12:00",
      breakMinutes: 15,
    });
    const j = job(ALL, old);
    expect(absenceDayTimes(j, "2026-09-07")).toEqual({
      start: "08:00",
      end: "12:00",
      breakMinutes: 15,
    });
    expect(absenceDayTimes(j, "2026-10-05")).toEqual({
      start: "09:00",
      end: "14:00",
      breakMinutes: 0,
    });
    const [first] = generateAbsence(j, "urlaub", "2026-09-07", "2026-09-07", "BE");
    expect(first).toMatchObject({ start: "08:00", end: "12:00", breakMinutes: 15 });
  });
});

describe("Zeitraum über den Wechseltag (01.10.2026, Do)", () => {
  for (const kind of ["urlaub", "krank"] as const) {
    it(`${kind}: 28.09.–09.10., Mo–Fr → nur Mo: 28.–30.09. nach altem, ab 01.10. nach neuem Plan`, () => {
      const j = job(MON_ONLY, MON_FRI);
      const created = generateAbsence(j, kind, "2026-09-28", "2026-10-09", "BE");
      expect(dates(created)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-05"]);
      expect(total(j, created)).toBe(4 * 75);
    });
  }
  it("Erweiterung: 28.09.–04.10. → Mo–Mi nach altem Plan, Do–So nach neuem Plan", () => {
    const j = job(ALL, MON_FRI);
    expect(dates(generateAbsence(j, "urlaub", "2026-09-26", "2026-10-04", "BE"))).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });
});

describe("fehlende / unvollständige Plan-Historie", () => {
  it("ohne weekHistory: aktueller Plan (einzige vorhandene Information, identisch zur Payroll)", () => {
    const j = job(MON_ONLY);
    expect(weekForDate(j, "2026-09-08")).toBe(MON_ONLY);
    expect(dates(generateAbsence(j, "urlaub", "2026-09-07", "2026-09-11", "BE"))).toEqual([
      "2026-09-07",
    ]);
  });

  it("historischer Eintrag ohne Plan-Daten → vor dem Wechsel nichts anlegen (nicht raten), danach aktueller Plan", () => {
    const j = job(ALL, null);
    for (const kind of ["urlaub", "krank"] as const) {
      expect(dates(generateAbsence(j, kind, "2026-09-28", "2026-10-04", "BE"))).toEqual([
        "2026-10-01",
        "2026-10-02",
        "2026-10-03",
        "2026-10-04",
      ]);
    }
    expect(absencePlanDay(j, "2026-09-28")).toEqual({ status: "unknown" });
    expect(absenceDayTimes(j, "2026-09-28")).toEqual({
      start: "09:00",
      end: "17:00",
      breakMinutes: 0,
    });
  });

  it("historischer Plan mit fehlendem Wochentag → dieser Tag unbekannt, nicht angelegt", () => {
    const broken = MON_FRI.slice(0, 3); // Do–So fehlen
    const j = job(ALL, broken);
    expect(dates(generateAbsence(j, "urlaub", "2026-09-07", "2026-09-13", "BE"))).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
    ]);
    expect(absencePlanDay(j, "2026-09-10")).toEqual({ status: "unknown" });
  });

  it("flex ohne jeden Plan: unverändert Mo–Fr", () => {
    const flex = { ...job(undefined), mode: "flex" } as Job;
    expect(dates(generateAbsence(flex, "krank", "2026-09-11", "2026-09-14", "BE"))).toEqual([
      "2026-09-11",
      "2026-09-14",
    ]);
    expect(absencePlanDay(flex, "2026-09-12")).toEqual({ status: "no-plan" });
  });
});

function clearAppKeys() {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
}

describe("erneutes Anlegen / Bearbeiten: keine Duplikate, bestehende Daten unverändert", () => {
  beforeEach(() => {
    clearAppKeys();
    loadFromStorage();
    act(() => activateScope(DEMO_SCOPE));
  });

  it("addAbsence zweimal: zweiter Lauf legt nichts an, Bestand bytegleich", () => {
    const j = job(MON_ONLY, MON_FRI);
    // Bestand inkl. eines Eintrags, den der alte Code an einem damals freien Tag angelegt hätte
    const legacy = {
      id: "legacy-sa",
      jobId: "j1",
      kind: "urlaub",
      date: "2026-09-12",
      ...d5,
    } as Shift;
    act(() =>
      replaceAll({
        ...EMPTY_DATA,
        jobs: [j],
        shifts: [legacy],
        settings: { ...S, onboarded: true, localDemoMode: true },
      } as never),
    );
    let first: Shift[] = [];
    act(() => {
      first = addAbsence(j, "urlaub", "2026-09-07", "2026-09-13");
    });
    expect(dates(first)).toEqual(WEEK_0907);
    const snapshot = JSON.stringify(getData().shifts);
    let second: Shift[] = [];
    act(() => {
      second = addAbsence(j, "urlaub", "2026-09-07", "2026-09-13");
    });
    expect(second).toEqual([]);
    expect(JSON.stringify(getData().shifts)).toBe(snapshot);
    const all = getData().shifts.map((s) => s.date);
    expect(new Set(all).size).toBe(all.length);
    // Altbestand wird nie still verändert oder gelöscht
    expect(getData().shifts.find((s) => s.id === "legacy-sa")).toEqual(legacy);
  });

  it("planAbsence: unverändert ersetzen → kein Eingriff; geändert → nach historischem Plan, keine Duplikate", () => {
    const j = job(MON_ONLY, MON_FRI);
    const existing = generateAbsence(j, "krank", "2026-09-07", "2026-09-11", "BE");
    const replace = { jobId: "j1", kind: "krank" as const, from: "2026-09-07", to: "2026-09-11" };
    const data = dataWith([j], existing);
    expect(planAbsence(j, "krank", "2026-09-07", "2026-09-11", replace, data)).toEqual({
      removeIds: [],
      created: [],
    });
    const plan = planAbsence(j, "krank", "2026-09-08", "2026-09-14", replace, data);
    expect(plan.removeIds.sort()).toEqual(existing.map((s) => s.id).sort());
    expect(dates(plan.created)).toEqual([
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-14",
    ]);
    for (const s of plan.created) {
      const p = shiftPayroll(s, { job: j, history: plan.created });
      expect(p.paid).toBe(true);
    }
  });
});
