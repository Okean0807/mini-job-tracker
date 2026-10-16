/**
 * D3 (Owner R4): rückwirkende Änderungen – betroffene Monate mit Vorher/Nachher,
 * nichts wird ohne Bestätigung gespeichert (retroImpact ist rein).
 */
import { describe, expect, it } from "vitest";

import { isoDate } from "./calc";
import { payrollTotals } from "./payroll";
import { makeResolver } from "./resolve";
import { needsRetroConfirmation, retroImpact } from "./retro-impact";
import { withSickConfirmations } from "./sick-confirmation";
import { DEFAULT_SETTINGS, type Job, type Shift } from "./types";

const day = { start: "09:00", end: "14:00", breakMinutes: 0 };
const MON_FRI = {
  id: "j1",
  name: "j1",
  color: "#000",
  mode: "fest",
  employmentType: "minijob",
  rate: 15,
  startDate: "2025-01-01",
  week: [true, true, true, true, true, false, false].map((active) => ({ active, ...day })),
} as unknown as Job;
const JOBS = [MON_FRI];

const sick = (date: string, marked: boolean): Shift =>
  ({
    id: `k-${date}`,
    jobId: "j1",
    kind: "krank",
    date,
    ...day,
    ...(marked ? { sickRule: "continuous" as const } : {}),
  }) as Shift;
const work = (date: string): Shift =>
  ({ id: `w-${date}`, jobId: "j1", kind: "arbeit", date, ...day }) as Shift;

function days(from: string, to: string, pred: (d: Date) => boolean = () => true): string[] {
  const out: string[] = [];
  const d = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");
  for (; d <= end; d.setDate(d.getDate() + 1)) if (pred(d)) out.push(isoDate(d));
  return out;
}
const weekday = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;
const monthEarn = (shifts: Shift[], month: string, settings = DEFAULT_SETTINGS) =>
  payrollTotals(
    shifts.filter((s) => s.date.startsWith(month)),
    makeResolver(JOBS, settings),
    shifts,
  ).earnings;

describe("retroImpact (D3)", () => {
  // v1.0 (t617u, D1): Die automatische Zusammenfassung neu erfasster
  // (markierter) Ketten ist abgeschaltet. Nachträge/Löschungen/Bearbeitungen
  // in solchen Ketten ändern daher die Beträge ANDERER Monate nicht still.
  it("v1.0: nachgetragene markierte Krankheitstage ändern Dezember NICHT (keine automatische Zusammenfassung)", () => {
    const base = days("2026-11-16", "2026-12-31", weekday).map((d) => sick(d, true));
    const extra = days("2026-10-19", "2026-11-13", weekday).map((d) => sick(d, true));
    const after = [...extra, ...base];
    const impact = retroImpact(
      base,
      after,
      JOBS,
      DEFAULT_SETTINGS,
      extra.map((s) => s.id),
    );
    // 23 Werktage × 75 € – ohne Bestätigung wie bisher bezahlt (Hinweis statt stiller Kürzung)
    expect(monthEarn(base, "2026-12")).toBe(1725);
    expect(monthEarn(after, "2026-12")).toBe(1725); // keine stille Nullsumme
    expect(impact.months).toEqual([]);
  });

  it("v1.0: rückwirkend löschen/bearbeiten in markierter Kette → andere Monate unverändert", () => {
    const all = days("2026-10-19", "2026-12-31", weekday).map((d) => sick(d, true));
    const removed = all.slice(0, 10).map((s) => s.id);
    const afterDelete = all.filter((s) => !removed.includes(s.id));
    expect(retroImpact(all, afterDelete, JOBS, DEFAULT_SETTINGS, removed).months).toEqual([]);
    const first = all[0]!;
    const edited = { ...first, kind: "arbeit" } as Shift;
    const afterEdit = all.map((s) => (s.id === first.id ? edited : s));
    expect(retroImpact(all, afterEdit, JOBS, DEFAULT_SETTINGS, [first.id]).months).toEqual([]);
  });

  // D3 bleibt für ausdrücklich zugeordnete Fälle (sickCaseId, vom Nutzer
  // verknüpft) wirksam: dort verschiebt eine rückwirkende Änderung die 42 Tage.
  const caseDay = (date: string): Shift => ({ ...sick(date, false), sickCaseId: "c1" }) as Shift;

  it("explizit verknüpfter Fall: rückwirkend löschen → spätere Monate wieder bezahlt, mit Vorher/Nachher", () => {
    const all = days("2026-10-19", "2026-12-31", weekday).map(caseDay);
    const removed = all.slice(0, 10).map((s) => s.id);
    const after = all.filter((s) => !removed.includes(s.id));
    const impact = retroImpact(all, after, JOBS, DEFAULT_SETTINGS, removed);
    const dec = impact.months.find((m) => m.month === "2026-12");
    expect(dec).toEqual({
      month: "2026-12",
      before: monthEarn(all, "2026-12"),
      after: monthEarn(after, "2026-12"),
    });
    expect(dec!.after).toBeGreaterThan(dec!.before);
    expect(needsRetroConfirmation(impact)).toBe(true);
    const months = impact.months.map((m) => m.month);
    expect(months).toEqual([...months].sort());
  });

  it("explizit verknüpfter Fall: krank → arbeit am Fallanfang verschiebt die 42-Tage-Grenze", () => {
    const all = days("2026-10-19", "2026-12-31", weekday).map(caseDay);
    const first = all[0]!;
    const { sickCaseId: _drop, ...rest } = first;
    void _drop;
    const edited = { ...rest, kind: "arbeit" } as Shift;
    const after = all.map((s) => (s.id === first.id ? edited : s));
    const impact = retroImpact(all, after, JOBS, DEFAULT_SETTINGS, [first.id]);
    expect(impact.months.map((m) => m.month)).toEqual(["2026-11"]);
    expect(impact.months[0]!.after).toBeGreaterThan(impact.months[0]!.before);
  });

  it("Änderung ohne Wirkung auf andere Einträge → keine Rückfrage", () => {
    const base = days("2026-11-02", "2026-11-06", weekday).map(work);
    const added = work("2026-11-09");
    const impact = retroImpact(base, [...base, added], JOBS, DEFAULT_SETTINGS, [added.id]);
    expect(impact).toEqual({ months: [], lapsedMonths: [] });
    expect(needsRetroConfirmation(impact)).toBe(false);
  });

  it("der geänderte Eintrag selbst zählt nicht (sein Wert steht im Dialog)", () => {
    const s = sick("2026-11-02", false);
    const impact = retroImpact([], [s], JOBS, DEFAULT_SETTINGS, [s.id]);
    expect(impact.months).toEqual([]);
  });

  it("O-2-Bestätigung würde aufgehoben → lapsedMonths (D5), Rückfrage nötig", () => {
    const shifts = days("2026-11-01", "2026-12-31").map((d) => sick(d, false));
    const ALL = { ...MON_FRI, week: MON_FRI.week!.map((w) => ({ ...w, active: true })) } as Job;
    const conf = withSickConfirmations(undefined, ["2026-12"], shifts, [ALL]);
    expect(conf).toHaveLength(1);
    const settings = { ...DEFAULT_SETTINGS, sickContinuousConfirmations: conf };
    const after = shifts.filter((s) => s.date !== "2026-11-20");
    const impact = retroImpact(shifts, after, [ALL], settings, ["k-2026-11-20"]);
    expect(impact.lapsedMonths).toEqual(["2026-12"]);
    expect(needsRetroConfirmation(impact)).toBe(true);
  });

  it("rein: Eingaben werden nicht verändert (Abbrechen = nichts gespeichert)", () => {
    const base = days("2026-11-16", "2026-12-31", weekday).map((d) => sick(d, true));
    const extra = days("2026-10-19", "2026-11-13", weekday).map((d) => sick(d, true));
    const snapshot = JSON.stringify([base, extra]);
    retroImpact(
      base,
      [...extra, ...base],
      JOBS,
      DEFAULT_SETTINGS,
      extra.map((s) => s.id),
    );
    expect(JSON.stringify([base, extra])).toBe(snapshot);
  });
});
