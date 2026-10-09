/**
 * Golden-Prüfungen S5 (Wochenansicht + Vorwochen-Vergleich). Nur für Tests.
 *
 * Herkunft der Werte: ausschließlich aus den bestehenden Fixtures F1/F2/F3
 * (`stats-periods.ts`) über die unveränderte Payroll (`shiftPayroll` mit voller
 * Historie) bzw. die unveränderten Soll/Ist-Tagesfunktionen abgeleitet und gegen
 * bereits vorhandene Goldens abgeglichen (KW 36–40, F2 KW 53, F3 KW 43, Okt
 * geplant 114 €). Ableitung dokumentiert in
 * `/workspace/stat-analysis-report/s5/IMPL.md` (Abschnitt „Abgeleitete Goldens“).
 * Zeitzonen-unabhängig; wird in der TZ-Matrix und im Projekt `tz-la` ausgeführt.
 */
import { expect } from "vitest";

import { weekPeriod } from "../period";
import { makeResolver } from "../resolve";
import {
  buildWeekComparison,
  buildWeekStats,
  percentDisplay,
  weekTimeAccount,
} from "../stats-week";
import { DEFAULT_SETTINGS, type Shift } from "../types";
import { F1_JOBS, F1_SHIFTS, F1_TODAY, F2_SHIFTS, F3_SHIFTS } from "./stats-periods";

const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 4);

export function assertWeekGoldens(): void {
  const r = makeResolver(F1_JOBS, { ...DEFAULT_SETTINGS });
  const stats = (y: number, w: number, today: string, shifts: Shift[] = F1_SHIFTS, job?: string) =>
    buildWeekStats(
      weekPeriod(y, w),
      job ? shifts.filter((s) => s.jobId === job) : shifts,
      shifts,
      r,
      today,
    );
  const cmp = (y: number, w: number, today: string, shifts: Shift[] = F1_SHIFTS) =>
    buildWeekComparison(weekPeriod(y, w), shifts, shifts, r, today);

  // KW 38/2026 (14.–20.09.): Urlaub 15.09. = bezahlte Abwesenheit, keine Arbeitszeit.
  const kw38 = stats(2026, 38, F1_TODAY);
  expect(kw38.status).toBe("past");
  close(kw38.actual.earnings, 211.0714);
  close(kw38.actual.workEarnings, 152.25);
  close(kw38.actual.absenceEarnings, 58.8214);
  close(kw38.actual.workedHours, 10.5);
  expect(kw38.actual.workDays).toBe(3);
  expect(kw38.actual.entries).toBe(4);

  // KW 40/2026 am So 04.10. (laufend, Tag 7 von 7) vs. KW 39: +68 % / +250 % / +3 Tage.
  const kw40 = stats(2026, 40, F1_TODAY);
  expect(kw40.status).toBe("running");
  expect(kw40.elapsedDays).toBe(7);
  close(kw40.actual.earnings, 201);
  close(kw40.actual.workedHours, 14);
  expect(kw40.actual.workDays).toBe(4);
  const c40 = cmp(2026, 40, F1_TODAY)!;
  expect(c40.days).toBe(7);
  expect(c40.previous).toEqual({ start: "2026-09-21", end: "2026-09-27" });
  expect(percentDisplay(c40.earnings)).toEqual({ kind: "percent", value: 68 });
  expect(percentDisplay(c40.workedHours)).toEqual({ kind: "percent", value: 250 });
  expect(c40.workDays.delta).toBe(3);

  // KW 41/2026 aus Sicht 04.10.: zukünftig, nur geplant 114 € / 8 h / 2 Tage, kein Vergleich.
  const kw41 = stats(2026, 41, F1_TODAY);
  expect(kw41.status).toBe("future");
  expect(kw41.actual.earnings).toBe(0);
  close(kw41.planned.earnings, 114);
  close(kw41.planned.workedHours, 8);
  expect(kw41.planned.workDays).toBe(2);
  expect(cmp(2026, 41, F1_TODAY)).toBeNull();

  // KW 41 am Di 06.10. (laufend, 2 Tage): 54 € tatsächlich + 60 € geplant; vs. 28.–29.09. −10 %.
  const kw41b = stats(2026, 41, "2026-10-06");
  expect(kw41b.elapsedDays).toBe(2);
  close(kw41b.actual.earnings, 54);
  close(kw41b.planned.earnings, 60);
  const c41b = cmp(2026, 41, "2026-10-06")!;
  expect(c41b.previous).toEqual({ start: "2026-09-28", end: "2026-09-29" });
  close(c41b.earnings.previous, 60);
  expect(percentDisplay(c41b.earnings)).toEqual({ kind: "percent", value: -10 });
  expect(percentDisplay(c41b.workedHours)).toEqual({ kind: "percent", value: 0 });

  // F2: KW 53/2026 über den Jahreswechsel; KW 1/2027 laufend am 06.01.2027 vs. KW 53 Mo–Mi (0).
  const kw53 = stats(2026, 53, "2027-01-10", F2_SHIFTS);
  close(kw53.actual.earnings, 148.5);
  close(kw53.actual.workedHours, 11);
  expect(kw53.actual.workDays).toBe(3);
  const c1 = cmp(2027, 1, "2027-01-06", F2_SHIFTS)!;
  expect(c1.previousWeek).toMatchObject({ isoYear: 2026, isoWeek: 53 });
  expect(c1.previous).toEqual({ start: "2026-12-28", end: "2026-12-30" });
  close(c1.earnings.current, 27);
  expect(percentDisplay(c1.earnings)).toEqual({ kind: "noPrevious" });

  // F3: DST-Woche KW 43/2026, Nachtschicht So→Mo vollständig am Sonntag.
  const kw43 = stats(2026, 43, "2026-11-01", F3_SHIFTS);
  close(kw43.actual.earnings, 135);
  close(kw43.actual.workedHours, 10);
  expect(kw43.actual.workDays).toBe(1);
  expect(kw43.days.map((d) => d.date)).toEqual([
    "2026-10-19",
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
  ]);
  close(kw43.days[6]!.workedHours, 10);

  // Soll/Ist Büro Plan (fest) KW 39: Krank 21.09. bleibt Minus (B7 unverändert).
  const j2 = F1_JOBS[1]!;
  expect(weekTimeAccount(j2, weekPeriod(2026, 39), F1_SHIFTS, F1_TODAY)).toMatchObject({
    soll: 8,
    ist: 4,
    saldo: -4,
    istIncludesPlanned: false,
  });
}
