/**
 * C3 Etappe 1 – Referenzverhalten VOR jeder Änderung an Frei / Sonstige / Freizeitausgleich.
 *
 * Diese Tests dokumentieren die Ist-Werte von `shiftPayroll` (Stand main 926af09) für alle Arten
 * (`arbeit`, `urlaub`, `krank`, `feiertag`, `frei`, `sonstige`). Die Erwartungen wurden aus der laufenden
 * Implementierung abgelesen, nicht aus einer Wunschlogik abgeleitet. Ändert eine spätere Etappe einen Wert,
 * muss das bewusst und mit Freigabe geschehen: ein roter Test hier heißt "Altverhalten verändert".
 *
 * Fixture: Fest-Job Mo–Fr 08:00–12:00 (4 h), 15 €/h, Beschäftigungsbeginn 2025-01-01, Bundesland BE.
 */
import { describe, expect, it } from "vitest";

import { payrollTotals, shiftPayroll, SICK_MAX_DAYS, SICK_WAITING_DAYS } from "./payroll";
import { makeResolver } from "./resolve";
import { generateAbsence } from "./schedule";
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
const withStart = (startDate: string) => ({ ...JOB, startDate }) as Job;

const mk = (
  p: Partial<Omit<Shift, "jobId">> & {
    date: string;
    kind: Shift["kind"];
    jobId?: string | undefined;
  },
): Shift =>
  ({
    id: p.date + p.kind,
    jobId: "F",
    start: "08:00",
    end: "12:00",
    breakMinutes: 0,
    ...p,
  }) as Shift;
const pay = (shift: Shift, job: Job | null = JOB, history: Shift[] = []) => {
  const p = shiftPayroll(shift, { job: job ?? undefined, defaultRate: 15, history });
  return {
    kind: p.kind,
    worked: p.workedHours,
    absence: p.paidAbsenceHours,
    earnings: p.earnings,
    base: p.base,
    bonus: p.bonus,
    paid: p.paid,
    reason: p.reason,
    basis: p.basis,
    estimated: p.estimated,
  };
};
const UNPAID = (kind: Shift["kind"]) => ({
  kind,
  worked: 0,
  absence: 0,
  earnings: 0,
  base: 0,
  bonus: 0,
  paid: false,
  basis: "none",
  estimated: false,
});

describe("Arbeit", () => {
  it("4 h × 15 € = 60 €, nur gearbeitete Stunden, keine Abwesenheitsstunden", () => {
    expect(pay(mk({ date: "2026-11-02", kind: "arbeit" }))).toEqual({
      kind: "arbeit",
      worked: 4,
      absence: 0,
      earnings: 60,
      base: 60,
      bonus: 0,
      paid: true,
      reason: "worked",
      basis: "worked",
      estimated: false,
    });
  });
  it("Pause wird abgezogen (3,5 h → 52,50 €)", () => {
    const p = pay(mk({ date: "2026-11-02", kind: "arbeit", breakMinutes: 30 }));
    expect([p.worked, p.earnings]).toEqual([3.5, 52.5]);
  });
});

describe("Urlaub (§ 11 BUrlG) – Referenzverhalten, nicht ändern", () => {
  it("ohne Referenztage: Planstunden, Basis plan, Schätzung", () => {
    expect(pay(mk({ date: "2026-11-05", kind: "urlaub" }))).toMatchObject({
      worked: 0,
      absence: 4,
      earnings: 60,
      paid: true,
      reason: "vacation-pay",
      basis: "plan",
      estimated: true,
    });
  });
  const ref = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      mk({ date: `2026-09-0${7 + i}`, kind: "arbeit", end: "13:00" }),
    );
  it("4 Referenztage (< 5): Rückfall auf den Plan", () => {
    const p = pay(mk({ date: "2026-09-14", kind: "urlaub" }), JOB, ref(4));
    expect([p.basis, p.absence, p.earnings, p.estimated]).toEqual(["plan", 4, 60, true]);
  });
  it("5 Referenztage: 13-Wochen-Durchschnitt (5 h, 75 €), keine Schätzung", () => {
    const p = pay(mk({ date: "2026-09-14", kind: "urlaub" }), JOB, ref(5));
    expect([p.basis, p.absence, p.earnings, p.estimated]).toEqual(["average13", 5, 75, false]);
  });
});

describe("Krank (§ 3 EntgFG) – Referenzverhalten, nicht ändern", () => {
  it("regulärer Arbeitstag nach der Wartezeit: Planstunden, bezahlt", () => {
    expect(pay(mk({ date: "2026-11-03", kind: "krank" }))).toMatchObject({
      worked: 0,
      absence: 4,
      earnings: 60,
      paid: true,
      reason: "sick-pay",
      basis: "plan",
      estimated: false,
    });
  });
  it("Wartezeit: Konstanten und Grenze (Tag 27 unbezahlt, Tag 28 bezahlt)", () => {
    expect(SICK_WAITING_DAYS).toBe(28);
    expect(SICK_MAX_DAYS).toBe(42);
    // Beschäftigungsbeginn 06.10. → 02.11. ist Tag 27; 05.10. → Tag 28
    const d27 = pay(mk({ date: "2026-11-02", kind: "krank" }), withStart("2026-10-06"));
    const d28 = pay(mk({ date: "2026-11-02", kind: "krank" }), withStart("2026-10-05"));
    expect([d27.reason, d27.earnings]).toEqual(["sick-waiting", 0]);
    expect([d28.reason, d28.earnings]).toEqual(["sick-pay", 60]);
  });
  const sick = generateAbsence(JOB, "krank", "2026-09-15", "2026-10-30", "BE");
  it("42-Tage-Grenze je Fall: 26.10. (Index 41) bezahlt, 27.10. (Index 42) unbezahlt", () => {
    expect(sick).toHaveLength(34);
    const at = (date: string) =>
      pay(
        sick.find((s) => s.date === date)!,
        JOB,
        sick,
      );
    expect(at("2026-10-26")).toMatchObject({ absence: 4, earnings: 60, reason: "sick-pay" });
    expect(at("2026-10-27")).toMatchObject({
      ...UNPAID("krank"),
      reason: "sick-exceeded",
    });
  });
  it("ohne sickCaseId zählt jeder Eintrag als eigener Fall (keine Lückenheuristik)", () => {
    const noId = sick.map(({ sickCaseId: _id, ...rest }) => rest as Shift);
    const p = pay(
      noId.find((s) => s.date === "2026-10-27")!,
      JOB,
      noId,
    );
    expect([p.reason, p.earnings]).toEqual(["sick-pay", 60]);
  });
  it("arbeitsfreier Tag: unbezahlt (sick-off-day); ohne Job ebenfalls", () => {
    expect(pay(mk({ date: "2026-11-07", kind: "krank" }))).toMatchObject({
      ...UNPAID("krank"),
      reason: "sick-off-day",
    });
    expect(pay(mk({ date: "2026-11-04", kind: "krank", jobId: undefined }), null)).toMatchObject({
      ...UNPAID("krank"),
      reason: "sick-off-day",
    });
  });
});

describe("Feiertag (§ 2 EntgFG) – Referenzverhalten", () => {
  it("regulärer Arbeitstag: Planstunden bezahlt", () => {
    expect(pay(mk({ date: "2026-11-04", kind: "feiertag" }))).toMatchObject({
      absence: 4,
      earnings: 60,
      paid: true,
      reason: "holiday-pay",
      basis: "plan",
    });
  });
  it("arbeitsfreier Tag: unbezahlt (holiday-off-day)", () => {
    expect(pay(mk({ date: "2026-11-07", kind: "feiertag" }))).toMatchObject({
      ...UNPAID("feiertag"),
      reason: "holiday-off-day",
    });
  });
});

describe("Frei / Sonstige OHNE Zusatzfelder – Referenzverhalten (alle Fälle 0 h / 0 €)", () => {
  const cases: [string, Partial<Omit<Shift, "jobId">> & { jobId?: string | undefined }][] = [
    ["Plantag", { date: "2026-11-04" }],
    ["arbeitsfreier Tag", { date: "2026-11-07" }],
    [
      "mit Notiz, Satz und Intervall",
      { date: "2026-11-04", note: "x", rate: 99, start: "09:00", end: "17:00" },
    ],
    ["ohne Job", { date: "2026-11-04", jobId: undefined }],
  ];
  for (const kind of ["frei", "sonstige"] as const) {
    it.each(cases)(`${kind}: %s`, (_label, partial) => {
      const job = "jobId" in partial && partial.jobId === undefined ? null : JOB;
      expect(pay(mk({ kind, ...partial } as never), job)).toEqual({
        ...UNPAID(kind),
        reason: "unpaid-absence",
      });
    });
  }

  it("unbekannte künftige Felder (manualHours/manualAmount/absenceMode) ändern HEUTE nichts – so sieht ein alter Client sie", () => {
    for (const kind of ["frei", "sonstige"] as const) {
      const future = {
        ...mk({ date: "2026-11-04", kind }),
        manualHours: 5,
        manualAmount: 100,
        absenceMode: "time-off",
      } as unknown as Shift;
      expect(pay(future)).toEqual({ ...UNPAID(kind), reason: "unpaid-absence" });
    }
  });
});

describe("Summen und Doppelzählung (Frei/Sonstige tragen 0 bei)", () => {
  const resolver = makeResolver([JOB], { ...DEFAULT_SETTINGS, bundesland: "BE" });
  const core = [
    mk({ date: "2026-11-02", kind: "arbeit" }),
    mk({ date: "2026-11-03", kind: "arbeit", end: "13:00" }),
    mk({ date: "2026-11-06", kind: "urlaub" }),
    mk({ date: "2026-11-09", kind: "krank", sickCaseId: "k1" }),
    mk({ date: "2026-11-10", kind: "feiertag" }),
  ];
  const extra = [
    mk({ date: "2026-11-04", kind: "frei" }),
    mk({ date: "2026-11-05", kind: "sonstige" }),
    mk({ date: "2026-11-07", kind: "frei" }),
  ];
  it("Referenzsummen: 9 h gearbeitet, 12 h bezahlte Abwesenheit, 135 € + 180 € = 315 €", () => {
    expect(payrollTotals(core, resolver, core)).toEqual({
      workedHours: 9,
      paidAbsenceHours: 12,
      workEarnings: 135,
      absenceEarnings: 180,
      earnings: 315,
      estimated: true,
    });
  });
  it("mit zusätzlichen Frei/Sonstige-Einträgen sind alle Summen identisch", () => {
    const all = [...core, ...extra];
    expect(payrollTotals(all, resolver, all)).toEqual(payrollTotals(core, resolver, core));
  });
});
