import { describe, expect, it } from "vitest";

import {
  SICK_MAX_DAYS,
  isRegularWorkday,
  payrollTotals,
  shiftPayroll,
  vacationDailyPay,
} from "./payroll";
import type { Job, Shift } from "./types";

const RATE = 15;

function shift(partial: Partial<Shift> & { date: string }): Shift {
  return {
    id: partial.date + (partial.kind ?? "arbeit"),
    date: partial.date,
    start: "09:00",
    end: "14:00",
    breakMinutes: 0,
    kind: "arbeit",
    jobId: "j1",
    ...partial,
  } as Shift;
}

const job: Job = {
  id: "j1",
  name: "Reinigung",
  rate: RATE,
  color: "#000",
  week: [
    { active: true, start: "09:00", end: "14:00", breakMinutes: 0 }, // Mo
    { active: true, start: "09:00", end: "14:00", breakMinutes: 0 }, // Di
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
  ],
  startDate: "2026-01-01",
} as unknown as Job;

const opts = { job, defaultRate: RATE };

describe("Arbeitstag-Erkennung", () => {
  it("folgt dem Festplan des Jobs", () => {
    expect(isRegularWorkday("2026-03-02", job)).toBe(true); // Montag
    expect(isRegularWorkday("2026-03-04", job)).toBe(false); // Mittwoch
  });

  it("erkennt ohne Festplan ein Muster aus der Historie", () => {
    const history = [shift({ date: "2026-03-04" }), shift({ date: "2026-03-11" })];
    expect(isRegularWorkday("2026-03-18", undefined, history)).toBe(true);
    expect(isRegularWorkday("2026-03-17", undefined, history)).toBe(false);
  });
});

describe("Feiertag (§ 2 EntgFG)", () => {
  it("zahlt nur, wenn regelmäßig gearbeitet worden wäre", () => {
    const p = shiftPayroll(shift({ date: "2026-04-06", kind: "feiertag" }), opts); // Montag
    expect(p.paid).toBe(true);
    expect(p.reason).toBe("holiday-pay");
    expect(p.workedHours).toBe(0);
    expect(p.paidAbsenceHours).toBe(5);
    expect(p.earnings).toBeCloseTo(75);
  });

  it("zahlt nicht an einem arbeitsfreien Tag", () => {
    const p = shiftPayroll(shift({ date: "2026-04-08", kind: "feiertag" }), opts); // Mittwoch
    expect(p.paid).toBe(false);
    expect(p.reason).toBe("holiday-off-day");
    expect(p.earnings).toBe(0);
  });
});

describe("Krankheit (§ 3 EntgFG)", () => {
  it("keine Fortzahlung in der Wartezeit von vier Wochen", () => {
    const p = shiftPayroll(shift({ date: "2026-01-05", kind: "krank" }), opts);
    expect(p.reason).toBe("sick-waiting");
    expect(p.earnings).toBe(0);
  });

  it("zahlt nach der Wartezeit die regelmäßige Arbeitszeit", () => {
    const p = shiftPayroll(shift({ date: "2026-03-02", kind: "krank" }), opts);
    expect(p.reason).toBe("sick-pay");
    expect(p.paidAbsenceHours).toBe(5);
    expect(p.earnings).toBeCloseTo(75);
    expect(p.workedHours).toBe(0);
  });

  it("endet nach sechs Wochen desselben Krankheitsfalls", () => {
    const history: Shift[] = [];
    for (let d = 0; d < SICK_MAX_DAYS + 1; d++) {
      const date = new Date(2026, 2, 2 + d).toISOString().slice(0, 10);
      history.push(shift({ date, kind: "krank" }));
    }
    const last = history[history.length - 1]!;
    const p = shiftPayroll(last, { ...opts, history });
    expect(p.reason).toBe("sick-exceeded");
    expect(p.earnings).toBe(0);
  });
});

describe("Urlaub (§ 11 BUrlG)", () => {
  const history = [
    shift({ date: "2026-02-02" }),
    shift({ date: "2026-02-09" }),
    shift({ date: "2026-02-16" }),
    shift({ date: "2026-02-23" }),
    shift({ date: "2026-03-02" }),
  ];

  it("nutzt den 13-Wochen-Durchschnitt", () => {
    const avg = vacationDailyPay(shift({ date: "2026-03-09", kind: "urlaub" }), {
      ...opts,
      history,
    });
    expect(avg?.amount).toBeCloseTo(75);
    expect(avg?.hours).toBeCloseTo(5);
    const p = shiftPayroll(shift({ date: "2026-03-09", kind: "urlaub" }), { ...opts, history });
    expect(p.reason).toBe("vacation-pay");
    expect(p.basis).toBe("average13");
    expect(p.estimated).toBe(false);
    expect(p.earnings).toBeCloseTo(75);
  });

  it("fällt ohne genügend Referenztage sauber auf den Plan zurück", () => {
    const p = shiftPayroll(shift({ date: "2026-03-09", kind: "urlaub" }), opts);
    expect(p.paid).toBe(true);
    expect(p.basis).toBe("plan");
    expect(p.estimated).toBe(true);
    expect(p.earnings).toBeCloseTo(75);
  });
});

describe("Summen / keine Doppelzählung", () => {
  it("trennt geleistete Stunden von bezahlter Abwesenheit", () => {
    const list = [
      shift({ date: "2026-03-02" }),
      shift({ date: "2026-03-03", kind: "krank" }),
      shift({ date: "2026-03-09", kind: "urlaub" }),
      shift({ date: "2026-03-11", kind: "feiertag" }),
    ];
    const totals = payrollTotals(list, () => opts, list);
    expect(totals.workedHours).toBe(5);
    expect(totals.paidAbsenceHours).toBe(10); // krank + urlaub, Feiertag am freien Mittwoch
    expect(totals.workEarnings).toBeCloseTo(75);
    expect(totals.absenceEarnings).toBeCloseTo(150);
    expect(totals.earnings).toBeCloseTo(225);
    expect(totals.estimated).toBe(true);
  });
});
