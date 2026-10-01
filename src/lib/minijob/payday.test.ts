import { describe, expect, it } from "vitest";

import { findPayment, findPayments, paydayFor, payPeriod, payPeriods } from "./payday";
import type { Job, Payment, Shift } from "./types";

const RATE = 15;

function baseJob(partial: Partial<Job> = {}): Job {
  return {
    id: "j1",
    name: "Reinigung",
    color: "#000",
    rate: RATE,
    mode: "fest",
    payday: 15,
    payrollDelay: 1,
    startDate: "2026-01-01",
    week: [
      { active: true, start: "09:00", end: "14:00", breakMinutes: 0 },
      { active: true, start: "09:00", end: "14:00", breakMinutes: 0 },
      { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
      { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
      { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
      { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
      { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
    ],
    ...partial,
  };
}

function shift(
  partial: Partial<Omit<Shift, "jobId">> & { date: string; jobId?: string | undefined },
): Shift {
  return {
    id: partial.date + (partial.kind ?? "arbeit"),
    start: "09:00",
    end: "14:00",
    breakMinutes: 0,
    kind: "arbeit",
    jobId: "j1",
    ...partial,
  } as Shift;
}

const resolve = () => ({ job: baseJob(), defaultRate: RATE });

describe("paydayFor", () => {
  it("nutzt Standard-Zahltag 15 und Delay 1 (Folgemonat)", () => {
    const job = baseJob();
    delete (job as { payday?: number }).payday;
    delete (job as { payrollDelay?: number }).payrollDelay;
    // März (month=2) → Auszahlung April 15
    expect(paydayFor(job, 2026, 2)).toBe("2026-04-15");
  });

  it("respektiert payday und payrollDelay=0 (gleicher Monat)", () => {
    const job = baseJob({ payday: 28, payrollDelay: 0 });
    expect(paydayFor(job, 2026, 2)).toBe("2026-03-28");
  });

  it("klemmt den Tag an den Monatsletzten (z. B. Februar)", () => {
    const job = baseJob({ payday: 31, payrollDelay: 0 });
    expect(paydayFor(job, 2026, 1)).toBe("2026-02-28"); // kein Schaltjahr
    expect(paydayFor(job, 2024, 1)).toBe("2024-02-29"); // Schaltjahr
  });

  it("begrenzt payday auf 1–31", () => {
    expect(paydayFor(baseJob({ payday: 0, payrollDelay: 0 }), 2026, 0)).toBe("2026-01-01");
    expect(paydayFor(baseJob({ payday: 99, payrollDelay: 0 }), 2026, 0)).toBe("2026-01-31");
  });
});

describe("findPayment", () => {
  const payments: Payment[] = [
    { id: "p1", jobId: "j1", year: 2026, month: 2, actual: 300 },
    { id: "p2", jobId: "j2", year: 2026, month: 2, actual: 100 },
  ];

  it("findet die Zahlung zum Job und Monat", () => {
    expect(findPayment(payments, "j1", 2026, 2)?.id).toBe("p1");
  });

  it("liefert undefined ohne Treffer", () => {
    expect(findPayment(payments, "j1", 2026, 3)).toBeUndefined();
  });

  it("liefert mehrere Teilzahlungen für denselben Abrechnungsmonat", () => {
    const ledger: Payment[] = [
      ...payments,
      { id: "p3", jobId: "j1", year: 2026, month: 2, actual: 50 },
    ];
    expect(findPayments(ledger, "j1", 2026, 2).map((p) => p.id)).toEqual(["p1", "p3"]);
  });
});

describe("payPeriod / payPeriods", () => {
  const job = baseJob();
  const shifts = [
    shift({ date: "2026-03-02" }), // Mo, 5h → 75
    shift({ date: "2026-03-03" }), // Di, 5h → 75
  ];

  it("aggregiert Erwartung, Stunden und dueDate", () => {
    const period = payPeriod(job, shifts, [], resolve, 2026, 2);
    expect(period.expected).toBeCloseTo(150);
    expect(period.hours).toBe(10);
    expect(period.dueDate).toBe("2026-04-15");
    expect(period.payment).toBeUndefined();
    expect(period.diff).toBeUndefined();
  });

  it("setzt diff = actual − expected wenn Zahlung erfasst", () => {
    const payments: Payment[] = [
      { id: "p1", jobId: "j1", year: 2026, month: 2, actual: 140 },
    ];
    const period = payPeriod(job, shifts, payments, resolve, 2026, 2);
    expect(period.payment?.actual).toBe(140);
    expect(period.payments).toHaveLength(1);
    expect(period.paid).toBeCloseTo(140);
    expect(period.diff).toBeCloseTo(-10);
  });

  it("trennt expected, earned und paid und behandelt zukünftige Schichten als expected", () => {
    const mixed = [
      ...shifts,
      shift({ date: "2026-03-16" }), // liegt nach dem Stichtag
    ];
    const payments: Payment[] = [
      { id: "p1", jobId: "j1", year: 2026, month: 2, actual: 100 },
    ];
    const period = payPeriod(job, mixed, payments, resolve, 2026, 2, "2026-03-15");
    expect(period.earned).toBeCloseTo(150);
    expect(period.expected).toBeCloseTo(225);
    expect(period.paid).toBeCloseTo(100);
    expect(period.outstanding).toBeCloseTo(50);
    expect(period.paymentDiff).toBeCloseTo(-50);
    expect(period.overpaid).toBe(0);
    expect(period.overdue).toBe(false);
  });

  it("meldet überfällige Zahlung anhand des bis zum Stichtag verdienten Entgelts", () => {
    const payments: Payment[] = [
      { id: "p1", jobId: "j1", year: 2026, month: 2, actual: 100 },
    ];
    const period = payPeriod(job, shifts, payments, resolve, 2026, 4, "2026-04-20");
    expect(period.earned).toBe(0);
    expect(period.overdue).toBe(false);

    const march = payPeriod(job, shifts, payments, resolve, 2026, 2, "2026-05-01");
    expect(march.earned).toBeCloseTo(150);
    expect(march.outstanding).toBeCloseTo(50);
    expect(march.overdue).toBe(true);
  });

  it("summiert zwei Teilzahlungen und berechnet Offen aus Earned − Paid", () => {
    const payments: Payment[] = [
      { id: "p1", jobId: "j1", year: 2026, month: 2, actual: 60, paidOn: "2026-04-10" },
      { id: "p2", jobId: "j1", year: 2026, month: 2, actual: 50, paidOn: "2026-04-20" },
    ];
    const period = payPeriod(job, shifts, payments, resolve, 2026, 4, "2026-05-01");
    expect(period.payments).toHaveLength(2);
    expect(period.paid).toBeCloseTo(110);
    expect(period.earned).toBeCloseTo(150);
    expect(period.outstanding).toBeCloseTo(40);
    expect(period.overpaid).toBe(0);
    expect(period.overdue).toBe(true);
  });

  it("behandelt vollständige Zahlung als nicht offen und nicht überfällig", () => {
    const payments: Payment[] = [
      { id: "p1", jobId: "j1", year: 2026, month: 2, actual: 100 },
      { id: "p2", jobId: "j1", year: 2026, month: 2, actual: 50 },
    ];
    const period = payPeriod(job, shifts, payments, resolve, 2026, 2, "2026-05-01");
    expect(period.paid).toBeCloseTo(150);
    expect(period.outstanding).toBe(0);
    expect(period.overpaid).toBe(0);
    expect(period.overdue).toBe(false);
  });

  it("trennt Überzahlung von offenem Betrag", () => {
    const payments: Payment[] = [
      { id: "p1", jobId: "j1", year: 2026, month: 2, actual: 175 },
    ];
    const period = payPeriod(job, shifts, payments, resolve, 2026, 2, "2026-05-01");
    expect(period.paid).toBeCloseTo(175);
    expect(period.outstanding).toBe(0);
    expect(period.overpaid).toBeCloseTo(25);
    expect(period.overdue).toBe(false);
  });

  it("ignoriert nicht bestätigte Zahlungen beim Paid-Ledger", () => {
    const payments: Payment[] = [
      { id: "p1", jobId: "j1", year: 2026, month: 2, actual: 150, confirmed: false },
      { id: "p2", jobId: "j1", year: 2026, month: 2, actual: 50 },
    ];
    const period = payPeriod(job, shifts, payments, resolve, 2026, 2, "2026-05-01");
    expect(period.paid).toBeCloseTo(50);
    expect(period.outstanding).toBeCloseTo(100);
  });

  it("filtert archivierte Jobs und Perioden ohne Soll/Ist", () => {
    const archived = baseJob({ id: "j-arch", archived: true });
    const empty = baseJob({ id: "j-empty" });
    const periods = payPeriods(
      [job, archived, empty],
      shifts,
      [],
      (s) => ({
        job: s.jobId === "j1" ? job : s.jobId === "j-arch" ? archived : empty,
        defaultRate: RATE,
      }),
      2026,
      2,
    );
    expect(periods).toHaveLength(1);
    expect(periods[0]!.job.id).toBe("j1");
  });

  it("behält Perioden mit Zahlung auch ohne Schichten", () => {
    const payments: Payment[] = [
      { id: "p1", jobId: "j1", year: 2026, month: 2, actual: 50 },
    ];
    const periods = payPeriods([job], [], payments, resolve, 2026, 2);
    expect(periods).toHaveLength(1);
    expect(periods[0]!.expected).toBe(0);
    expect(periods[0]!.payment?.actual).toBe(50);
  });
});
