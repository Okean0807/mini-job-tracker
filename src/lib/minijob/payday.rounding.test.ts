import { describe, expect, it } from "vitest";
import { payPeriod } from "./payday";
import type { Job, Payment, Shift } from "./types";
import type { Resolver } from "./resolve";

const job: Job = {
  id: "j1",
  name: "Minijob",
  rate: 10.005,
  employmentType: "minijob",
  color: "#000000",
  mode: "flex",
};

const shifts: Shift[] = [
  { id: "s1", jobId: "j1", date: "2026-09-01", start: "08:00", end: "09:00", breakMinutes: 0, kind: "arbeit", rate: 10.005 },
  { id: "s2", jobId: "j1", date: "2026-09-02", start: "08:00", end: "09:00", breakMinutes: 0, kind: "arbeit", rate: 10.005 },
];

const resolve: Resolver = () => ({ job });

const payment = (actual: number): Payment => ({
  id: "p1",
  jobId: "j1",
  year: 2026,
  month: 8,
  actual,
  paidOn: "2026-09-15",
});

describe("payment ledger currency boundary", () => {
  it("normalizes the payment ledger at the currency boundary", () => {
    const period = payPeriod(job, shifts, [], resolve, 2026, 8, "2026-09-30");
    expect(period.earned).toBe(20.01);
    expect(period.expected).toBe(20.01);
  });

  it("does not turn sub-cent floating point residue into an overdue balance", () => {
    const period = payPeriod(job, shifts, [payment(20.01)], resolve, 2026, 8, "2026-09-30");
    expect(period.paid).toBe(20.01);
    expect(period.paymentDiff).toBe(0);
    expect(period.outstanding).toBe(0);
    expect(period.overdue).toBe(false);
  });
});
