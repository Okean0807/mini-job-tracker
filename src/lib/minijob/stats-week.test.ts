/**
 * S5 Wochenansicht: Unit-/Integrations-Tests auf den bestehenden Fixtures.
 * Abgeleitete Referenzwerte: siehe `__fixtures__/stats-week-goldens.ts`.
 */
import { describe, expect, it } from "vitest";

import { shiftsInMonth } from "./calc";
import { monthTimeAccount } from "./fest-time-account";
import { periodKey, shiftPeriod, weekPeriod } from "./period";
import { aggregateRange } from "./period-aggregate";
import { evaluateShifts, payrollAggregateOptions } from "./period-payroll";
import { payrollTotals } from "./payroll";
import { makeResolver } from "./resolve";
import {
  buildWeekBreakdown,
  buildWeekComparison,
  buildWeekStats,
  initialWeekForMonth,
  percentDisplay,
  plannedRange,
  roundPercent,
  weekTimeAccount,
} from "./stats-week";
import { DEFAULT_SETTINGS, type Job, type Shift } from "./types";
import { assertWeekGoldens } from "./__fixtures__/stats-week-goldens";
import { F1_JOBS, F1_SHIFTS, F1_TODAY, F2_SHIFTS } from "./__fixtures__/stats-periods";

const r = makeResolver(F1_JOBS, { ...DEFAULT_SETTINGS });
const close = (a: number, b: number, d = 4) => expect(a).toBeCloseTo(b, d);
const stats = (y: number, w: number, today = F1_TODAY, shifts: Shift[] = F1_SHIFTS, job?: string) =>
  buildWeekStats(
    weekPeriod(y, w),
    job ? shifts.filter((s) => s.jobId === job) : shifts,
    shifts,
    r,
    today,
  );

describe("S5 Goldens (Prozess-TZ)", () => {
  it("alle abgeleiteten Wochen-Goldens", () => {
    assertWeekGoldens();
  });
});

describe("ISO-Woche, Jahreswechsel, Navigation", () => {
  it("E9: Startwoche = aktuelle KW, wenn der Monat heute enthält, sonst KW des 1.", () => {
    expect(periodKey(initialWeekForMonth(2026, 9, F1_TODAY))).toBe("2026-W40");
    expect(periodKey(initialWeekForMonth(2026, 8, F1_TODAY))).toBe("2026-W36");
    expect(periodKey(initialWeekForMonth(2027, 0, F1_TODAY))).toBe("2026-W53");
    expect(periodKey(initialWeekForMonth(2026, 0, F1_TODAY))).toBe("2026-W01");
    expect(initialWeekForMonth(2026, 0, F1_TODAY).start).toBe("2025-12-29");
  });

  it("KW 52 → 53 → 1 über den Jahreswechsel und zurück", () => {
    const w52 = weekPeriod(2026, 52);
    const w53 = shiftPeriod(w52, 1);
    expect(periodKey(w53)).toBe("2026-W53");
    expect(w53).toMatchObject({ start: "2026-12-28", end: "2027-01-03" });
    expect(periodKey(shiftPeriod(w53, 1))).toBe("2027-W01");
    expect(periodKey(shiftPeriod(weekPeriod(2028, 1), -1))).toBe("2027-W52");
  });

  it("KW 53/2026 enthält 31.12.2026, 01.01.2027 und die Nachtschicht 03.01.", () => {
    const s = stats(2026, 53, "2027-01-10", F2_SHIFTS);
    expect(s.actual.entries).toBe(3);
    close(s.actual.earnings, 148.5);
  });

  it("Woche über Monatsgrenze: KW 40 = 28.09.–04.10. (201 €), nicht Monatsschnitt", () => {
    const s = stats(2026, 40);
    expect(s.days[0]!.date).toBe("2026-09-28");
    expect(s.days[6]!.date).toBe("2026-10-04");
    close(s.actual.earnings, 201);
    expect(s.actual.entries).toBe(4);
  });
});

describe("Status: abgeschlossen / laufend / zukünftig", () => {
  it("vergangene KW 39 ist abgeschlossen, Vergleich 7 vs. 7 Tage", () => {
    const s = stats(2026, 39);
    expect(s.status).toBe("past");
    expect(s.elapsedDays).toBe(7);
    const c = buildWeekComparison(weekPeriod(2026, 39), F1_SHIFTS, F1_SHIFTS, r, F1_TODAY)!;
    expect(c.days).toBe(7);
    expect(percentDisplay(c.earnings)).toEqual({ kind: "percent", value: -43 });
    close(c.earnings.delta, -91.0714);
  });

  it("laufende Woche Mi 30.09.: 3 Tage vs. 21.–23.09., nur tatsächliche Werte", () => {
    const s = stats(2026, 40, "2026-09-30");
    expect(s.status).toBe("running");
    expect(s.elapsedDays).toBe(3);
    close(s.actual.earnings, 60);
    close(s.planned.earnings, 141);
    expect(s.planned.workDays).toBe(3);
    const c = buildWeekComparison(weekPeriod(2026, 40), F1_SHIFTS, F1_SHIFTS, r, "2026-09-30")!;
    expect(c.current).toEqual({ start: "2026-09-28", end: "2026-09-30" });
    expect(c.previous).toEqual({ start: "2026-09-21", end: "2026-09-23" });
    close(c.earnings.current, 60);
    close(c.earnings.previous, 120);
    expect(percentDisplay(c.earnings)).toEqual({ kind: "percent", value: -50 });
    expect(percentDisplay(c.workedHours)).toEqual({ kind: "percent", value: 0 });
  });

  it("zukünftige Woche: kein Vergleich, alles geplant", () => {
    const s = stats(2026, 41);
    expect(s.status).toBe("future");
    expect(s.elapsedDays).toBe(0);
    expect(s.days.every((d) => d.planned)).toBe(true);
    expect(buildWeekComparison(weekPeriod(2026, 41), F1_SHIFTS, F1_SHIFTS, r, F1_TODAY)).toBeNull();
    expect(plannedRange(weekPeriod(2026, 41), F1_TODAY)).toEqual({
      start: "2026-10-05",
      end: "2026-10-11",
    });
    expect(plannedRange(weekPeriod(2026, 40), F1_TODAY)).toBeNull();
  });

  it("Invariante: tatsächlich + geplant = gesamte Woche; Σ Tage = gesamte Woche", () => {
    for (const [w, today] of [
      [40, "2026-09-30"],
      [41, "2026-10-06"],
      [38, F1_TODAY],
    ] as const) {
      const s = stats(2026, w, today);
      const all = aggregateRange(
        weekPeriod(2026, w),
        evaluateShifts(F1_SHIFTS, r, F1_SHIFTS),
        payrollAggregateOptions(),
      );
      close(s.actual.earnings + s.planned.earnings, all.values.earnings, 9);
      close(s.actual.workedHours + s.planned.workedHours, all.values.workedHours, 9);
      close(
        s.days.reduce((a, d) => a + d.earnings, 0),
        all.values.earnings,
        9,
      );
      for (const d of s.days) expect(d.planned).toBe(d.date > today);
    }
  });
});

describe("Leer, Abwesenheiten", () => {
  it("leere Woche KW 30: Nullwerte, Vergleich „Keine Werte“", () => {
    const s = stats(2026, 30);
    expect(s.actual).toEqual({
      earnings: 0,
      workEarnings: 0,
      absenceEarnings: 0,
      workedHours: 0,
      workDays: 0,
      entries: 0,
    });
    const c = buildWeekComparison(weekPeriod(2026, 30), F1_SHIFTS, F1_SHIFTS, r, F1_TODAY)!;
    expect(percentDisplay(c.earnings)).toEqual({ kind: "noValues" });
    expect(percentDisplay(c.workedHours)).toEqual({ kind: "noValues" });
  });

  it("Rückgang auf 0 = −100 %; Vorwoche 0 = kein Prozent", () => {
    const c35 = buildWeekComparison(weekPeriod(2026, 35), F1_SHIFTS, F1_SHIFTS, r, F1_TODAY)!;
    close(c35.earnings.previous, 67.5);
    expect(percentDisplay(c35.earnings)).toEqual({ kind: "percent", value: -100 });
    const c36 = buildWeekComparison(weekPeriod(2026, 36), F1_SHIFTS, F1_SHIFTS, r, F1_TODAY)!;
    expect(percentDisplay(c36.earnings)).toEqual({ kind: "noPrevious" });
    expect(c36.workDays).toMatchObject({ current: 3, previous: 0, delta: 3 });
  });

  it("Krank (21.09.) und Frei (26.09.): Verdienst ja, Arbeitszeit/-tag nein", () => {
    const s = stats(2026, 39);
    close(s.actual.earnings, 120);
    close(s.actual.workEarnings, 60);
    close(s.actual.absenceEarnings, 60);
    close(s.actual.workedHours, 4);
    expect(s.actual.workDays).toBe(1);
    expect(s.actual.entries).toBe(3);
  });

  it("nur Abwesenheiten (Urlaub 13.10. + Frei 15.10. + sonstige 16.10.): 54 € bezahlt, 0 h, 0 Arbeitstage", () => {
    const extra: Shift[] = [
      {
        id: "x1",
        jobId: "J1",
        kind: "urlaub",
        date: "2026-10-13",
        start: "17:00",
        end: "21:00",
        breakMinutes: 0,
      },
      {
        id: "x2",
        jobId: "J1",
        kind: "frei",
        date: "2026-10-15",
        start: "10:00",
        end: "13:00",
        breakMinutes: 0,
      },
      {
        id: "x3",
        jobId: "J1",
        kind: "sonstige",
        date: "2026-10-16",
        start: "10:00",
        end: "13:00",
        breakMinutes: 0,
      },
    ];
    const all = [...F1_SHIFTS, ...extra];
    const s = buildWeekStats(weekPeriod(2026, 42), extra, all, r, "2026-10-20");
    close(s.actual.earnings, 54);
    expect(s.actual.workEarnings).toBe(0);
    close(s.actual.absenceEarnings, 54);
    expect(s.actual.workedHours).toBe(0);
    expect(s.actual.workDays).toBe(0);
    expect(s.actual.entries).toBe(3);
    expect(s.days[3]!.earnings).toBe(0); // Frei
    expect(s.days[4]!.earnings).toBe(0); // sonstige
  });
});

describe("Job-Filter, volle Historie, Aufteilung", () => {
  it("KW 38: Alle = Café Nord + Büro Plan; Urlaub mit voller Historie", () => {
    const all = stats(2026, 38);
    const j1 = stats(2026, 38, F1_TODAY, F1_SHIFTS, "J1");
    const j2 = stats(2026, 38, F1_TODAY, F1_SHIFTS, "J2");
    close(j1.actual.earnings, 106.0714);
    close(j2.actual.earnings, 105);
    close(j1.actual.earnings + j2.actual.earnings, all.actual.earnings, 9);
    const week = F1_SHIFTS.filter(
      (s) => s.jobId === "J1" && s.date >= "2026-09-14" && s.date <= "2026-09-20",
    );
    close(j1.actual.earnings, payrollTotals(week, r, F1_SHIFTS).earnings, 9);
  });

  it("Aufteilung folgt Filter; Σ Zeilen = Wochen-KPI; geplant separat", () => {
    const rows = buildWeekBreakdown(
      weekPeriod(2026, 38),
      F1_JOBS,
      F1_SHIFTS,
      F1_SHIFTS,
      r,
      F1_TODAY,
    );
    expect(rows.map((x) => x.job.id)).toEqual(["J1", "J2"]);
    close(
      rows.reduce((a, x) => a + x.actual.earnings, 0),
      211.0714,
    );
    const only = buildWeekBreakdown(
      weekPeriod(2026, 38),
      [F1_JOBS[1]!],
      F1_SHIFTS,
      F1_SHIFTS,
      r,
      F1_TODAY,
    );
    expect(only.map((x) => x.job.id)).toEqual(["J2"]);
    const future = buildWeekBreakdown(
      weekPeriod(2026, 41),
      F1_JOBS,
      F1_SHIFTS,
      F1_SHIFTS,
      r,
      F1_TODAY,
    );
    close(future.find((x) => x.job.id === "J2")!.planned.earnings, 60);
    expect(future.every((x) => x.actual.earnings === 0)).toBe(true);
  });

  it("archivierter Job erscheint nur mit Einträgen in der Woche", () => {
    const archived: Job = { ...F1_JOBS[0]!, archived: true };
    const jobs = [archived, F1_JOBS[1]!];
    expect(
      buildWeekBreakdown(weekPeriod(2026, 38), jobs, F1_SHIFTS, F1_SHIFTS, r, F1_TODAY).map(
        (x) => x.job.id,
      ),
    ).toEqual(["J1", "J2"]);
    expect(
      buildWeekBreakdown(weekPeriod(2026, 39), jobs, F1_SHIFTS, F1_SHIFTS, r, F1_TODAY).map(
        (x) => x.job.id,
      ),
    ).toEqual(["J2"]);
  });
});

describe("Soll/Ist (fest) – Semantik wie Monat", () => {
  const j2 = F1_JOBS[1]!;

  it("Σ September-Tage der KW 36–40 = monthTimeAccount (36 h / 28 h)", () => {
    let soll = 0;
    let ist = 0;
    for (const w of [36, 37, 38, 39, 40]) {
      for (const d of weekTimeAccount(j2, weekPeriod(2026, w), F1_SHIFTS, F1_TODAY).days) {
        if (d.date.startsWith("2026-09")) {
          soll += d.soll;
          ist += d.ist;
        }
      }
    }
    const month = monthTimeAccount(j2, 2026, 8, F1_SHIFTS);
    expect(month).toMatchObject({ soll: 36, ist: 28 });
    close(soll, month.soll, 9);
    close(ist, month.ist, 9);
  });

  it("laufende/zukünftige Woche: Soll ganze Woche, Ist inkl. geplant markiert", () => {
    const a = weekTimeAccount(j2, weekPeriod(2026, 41), F1_SHIFTS, F1_TODAY);
    expect(a).toMatchObject({ soll: 8, ist: 4, saldo: -4, istIncludesPlanned: true });
    expect(a.days).toHaveLength(7);
  });

  it("Flex-Job hat kein Soll", () => {
    expect(weekTimeAccount(F1_JOBS[0]!, weekPeriod(2026, 38), F1_SHIFTS, F1_TODAY).soll).toBe(0);
  });

  it("Monatswerte S1–S4 unverändert (Sep 822,32 € / 49 h)", () => {
    const t = payrollTotals(shiftsInMonth(F1_SHIFTS, 2026, 8), r, F1_SHIFTS);
    close(t.earnings, 822.3214);
    close(t.workedHours, 49);
  });
});

describe("Prozentrundung (E7)", () => {
  it("ganze Prozent, symmetrisch, kein −0", () => {
    expect(roundPercent(67.5)).toBe(68);
    expect(roundPercent(-67.5)).toBe(-68);
    expect(roundPercent(-43.1472)).toBe(-43);
    expect(Object.is(roundPercent(-0.4), 0)).toBe(true);
  });

  it("Rundungsreste zählen nicht als Wert", () => {
    expect(percentDisplay({ current: 1e-13, previous: 0, delta: 1e-13, percent: null })).toEqual({
      kind: "noValues",
    });
  });
});
