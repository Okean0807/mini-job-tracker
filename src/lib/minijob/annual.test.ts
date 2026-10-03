import { describe, expect, it } from "vitest";

import { buildAnnualReport } from "./annual";
import type { ResolveOptions } from "./resolve";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SUPPLEMENTS,
  type Job,
  type Settings,
  type Shift,
} from "./types";

const RATE = 15;

function baseJob(partial: Partial<Job> = {}): Job {
  return {
    id: "j1",
    name: "Reinigung",
    color: "#111",
    rate: RATE,
    mode: "fest",
    // Fixture ist ein Minijob mit festem Wochenplan. Seit Runde 3 ist ein
    // Altbestand fest OHNE employmentType „ungeklärt“ (siehe Test unten).
    employmentType: "minijob",
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
    id: partial.date + (partial.kind ?? "arbeit") + (partial.jobId ?? "j1"),
    start: "09:00",
    end: "14:00",
    breakMinutes: 0,
    kind: "arbeit",
    jobId: "j1",
    ...partial,
  } as Shift;
}

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultRate: RATE,
  bundesland: "NW",
  limitAuto: false,
  monthlyLimit: 500,
  supplements: {
    ...DEFAULT_SUPPLEMENTS,
    sunday: { enabled: true, mode: "prozent", value: 50 },
  },
};

const jobA = baseJob();
const jobB = baseJob({ id: "j2", name: "Büro", color: "#222", rate: 20 });
const jobs = [jobA, jobB];

function resolve(s: Shift): ResolveOptions {
  const job = jobs.find((j) => j.id === s.jobId) ?? jobA;
  return {
    job,
    defaultRate: settings.defaultRate,
    supplements: settings.supplements,
  };
}

describe("buildAnnualReport – leeres Jahr", () => {
  it("liefert Nullwerte und leere Bestenlisten", () => {
    const report = buildAnnualReport([], jobs, settings, 2026, resolve);
    expect(report.year).toBe(2026);
    expect(report.entries).toBe(0);
    expect(report.workDays).toBe(0);
    expect(report.hours).toBe(0);
    expect(report.absenceHours).toBe(0);
    expect(report.earnings).toBe(0);
    expect(report.workEarnings).toBe(0);
    expect(report.absenceEarnings).toBe(0);
    expect(report.base).toBe(0);
    expect(report.bonus).toBe(0);
    expect(report.bonusShare).toBe(0);
    expect(report.avgRate).toBe(0);
    expect(report.avgMonthEarnings).toBe(0);
    expect(report.avgDayHours).toBe(0);
    expect(report.activeMonths).toBe(0);
    expect(report.bestMonth).toBeNull();
    expect(report.bestDay).toBeNull();
    expect(report.jobs).toEqual([]);
    expect(report.months).toHaveLength(12);
    expect(report.weekdayHours).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(report.limit).toBe(500 * 12);
    expect(report.limitShare).toBe(0);
  });
});

describe("buildAnnualReport – Aggregation", () => {
  // Mo 2026-03-02 (j1, 5h × 15 = 75)
  // So 2026-03-08 (j1, 5h × 15 × 1.5 = 112.5) – Sonntagszuschlag
  // Di 2026-04-07 (j2, 5h × 20 = 100)
  // 2025-12-01 (außerhalb des Jahres)
  const shifts = [
    shift({ date: "2026-03-02" }),
    shift({ date: "2026-03-08" }),
    shift({ date: "2026-04-07", jobId: "j2" }),
    shift({ date: "2025-12-01" }),
  ];

  const report = buildAnnualReport(shifts, jobs, settings, 2026, resolve);

  it("filtert auf das Zieljahr und zählt Einträge / Arbeitstage", () => {
    expect(report.entries).toBe(3);
    expect(report.workDays).toBe(3);
    expect(report.activeMonths).toBe(2);
  });

  it("summiert Stunden, Basis und Zuschläge", () => {
    expect(report.hours).toBeCloseTo(15);
    expect(report.base).toBeCloseTo(5 * 15 + 5 * 15 + 5 * 20); // 250
    expect(report.bonus).toBeCloseTo(5 * 15 * 0.5); // 37.5 Sonntag
    expect(report.earnings).toBeCloseTo(287.5);
    expect(report.workEarnings).toBeCloseTo(287.5);
    expect(report.absenceEarnings).toBe(0);
    expect(report.bonusShare).toBeCloseTo((37.5 / 287.5) * 100);
  });

  it("berechnet Durchschnitte und Limitanteil", () => {
    expect(report.avgRate).toBeCloseTo(287.5 / 15);
    expect(report.avgMonthEarnings).toBeCloseTo(287.5 / 2);
    expect(report.avgDayHours).toBeCloseTo(5);
    expect(report.limit).toBe(6000);
    expect(report.limitShare).toBeCloseTo((287.5 / 6000) * 100);
  });

  it("wählt bestMonth und bestDay nach höchstem Entgelt", () => {
    expect(report.bestMonth?.month).toBe(2); // März: 75 + 112.5 = 187.5 > April 100
    expect(report.bestMonth?.earnings).toBeCloseTo(187.5);
    expect(report.bestDay?.date).toBe("2026-03-08");
    expect(report.bestDay?.earnings).toBeCloseTo(112.5);
    expect(report.bestDay?.hours).toBeCloseTo(5);
  });

  it("füllt Monatszeilen und Wochentagsstunden", () => {
    const march = report.months[2]!;
    const april = report.months[3]!;
    expect(march.entries).toBe(2);
    expect(march.hours).toBeCloseTo(10);
    expect(march.earnings).toBeCloseTo(187.5);
    expect(april.entries).toBe(1);
    expect(april.earnings).toBeCloseTo(100);
    // Mo=0, Di=1, So=6
    expect(report.weekdayHours[0]).toBeCloseTo(5); // 2026-03-02 Mo
    expect(report.weekdayHours[1]).toBeCloseTo(5); // 2026-04-07 Di
    expect(report.weekdayHours[6]).toBeCloseTo(5); // 2026-03-08 So
  });

  it("aggregiert Jobs nach Entgelt und teilt Anteile", () => {
    expect(report.jobs).toHaveLength(2);
    expect(report.jobs[0]!.id).toBe("j1");
    expect(report.jobs[0]!.earnings).toBeCloseTo(187.5);
    expect(report.jobs[0]!.share).toBeCloseTo((187.5 / 287.5) * 100);
    expect(report.jobs[1]!.id).toBe("j2");
    expect(report.jobs[1]!.earnings).toBeCloseTo(100);
    expect(report.jobs[1]!.hours).toBeCloseTo(5);
  });

  it("lässt Jobs ohne Stunden und Entgelt weg", () => {
    const idle = baseJob({ id: "j-idle", name: "Idle" });
    const withIdle = buildAnnualReport(shifts, [...jobs, idle], settings, 2026, resolve);
    expect(withIdle.jobs.map((j) => j.id)).toEqual(["j1", "j2"]);
  });
});

describe("buildAnnualReport – ungeklärter Altbestand (fest ohne employmentType)", () => {
  it("zählt Entgelt im Bericht, aber nicht in den Minijob-Limitanteil", () => {
    const { employmentType: _omit, ...legacyFest } = baseJob();
    const legacyJobs: Job[] = [legacyFest];
    const legacyResolve = (s: Shift): ResolveOptions => ({
      job: legacyJobs.find((j) => j.id === s.jobId) ?? legacyFest,
      defaultRate: settings.defaultRate,
      supplements: settings.supplements,
    });
    const report = buildAnnualReport(
      [shift({ date: "2026-03-02" })],
      legacyJobs,
      settings,
      2026,
      legacyResolve,
    );
    expect(report.earnings).toBeCloseTo(75);
    expect(report.limitShare).toBe(0);
  });
});

describe("buildAnnualReport – gleicher Tag und Bestenlisten-Randfälle", () => {
  it("fasst mehrere Schichten am selben Tag zu einem Arbeitstag zusammen", () => {
    const sameDay = [
      shift({ date: "2026-05-04", start: "09:00", end: "12:00" }), // Mo, 3h
      shift({ date: "2026-05-04", start: "13:00", end: "15:00", id: "second" }), // 2h
    ];
    const report = buildAnnualReport(sameDay, [jobA], settings, 2026, resolve);
    expect(report.entries).toBe(2);
    expect(report.workDays).toBe(1);
    expect(report.hours).toBeCloseTo(5);
    expect(report.bestDay?.date).toBe("2026-05-04");
    expect(report.bestDay?.hours).toBeCloseTo(5);
    expect(report.bestDay?.earnings).toBeCloseTo(75);
  });

  it("setzt bestMonth nur bei positivem Entgelt", () => {
    // Nur unbezahlte Abwesenheit (Feiertag an arbeitsfreiem Tag) → earnings 0
    const unpaid = [shift({ date: "2026-03-11", kind: "feiertag" })]; // Mi, Plan frei
    const report = buildAnnualReport(unpaid, [jobA], settings, 2026, (s) => ({
      job: jobA,
      defaultRate: RATE,
      history: unpaid,
    }));
    expect(report.entries).toBe(1);
    expect(report.earnings).toBe(0);
    expect(report.bestMonth).toBeNull();
  });
});
