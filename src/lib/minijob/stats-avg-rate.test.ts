import { describe, expect, it } from "vitest";

import { avgHourlyRate } from "./stats-avg-rate";

describe("S4 B1 avgHourlyRate", () => {
  it("workEarnings / workedHours (Formel A)", () => {
    // F1 Jahr: workEarnings 1134? — Beispiel 1134. something: use known 14.18 style
    expect(avgHourlyRate(1134.5, 80)).toBeCloseTo(14.18125, 5);
    expect(avgHourlyRate(703.5, 49)).toBeCloseTo(14.357142, 5);
  });

  it("0 Stunden → 0 (kein Infinity)", () => {
    expect(avgHourlyRate(100, 0)).toBe(0);
    expect(avgHourlyRate(0, 0)).toBe(0);
  });

  it("Abwesenheitsentgelt darf den Ø nicht erhöhen (Gegenprobe Formel B)", () => {
    const work = 703.5;
    const hours = 49;
    const withAbsence = 822.32; // earnings inkl. Abwesenheit
    expect(avgHourlyRate(work, hours)).toBeLessThan(withAbsence / hours);
  });
});
