/**
 * Test-Fixture S3 / B4: zwei Minijobs + Hauptbeschäftigung (+ Nicht-Minijobs).
 * Nur für Tests. Stichtag 04.10.2026.
 */
import { DEFAULT_SETTINGS, EMPTY_WEEK, type Job, type Settings, type Shift } from "../types";

export const B4_TODAY = "2026-10-04";
export const B4_SETTINGS: Settings = { ...DEFAULT_SETTINGS };

export const MJ_A: Job = {
  id: "MA",
  name: "Minijob A",
  color: "#16a34a",
  mode: "flex",
  rate: 13.5,
  employmentType: "minijob",
  startDate: "2025-01-01",
};

/** Minijob im Planungsmodus „fest“ – workMode ist kein Klassifikator. */
export const MJ_B: Job = {
  id: "MB",
  name: "Minijob B",
  color: "#2563eb",
  mode: "fest",
  rate: 15,
  employmentType: "minijob",
  week: EMPTY_WEEK,
  startDate: "2025-01-01",
};

export const HB: Job = {
  id: "HB",
  name: "Hauptjob",
  color: "#9333ea",
  mode: "flex",
  rate: 20,
  employmentType: "hauptbeschaeftigung",
  startDate: "2025-01-01",
};

export const KF: Job = { ...HB, id: "KF", name: "Kurzfristig", employmentType: "kurzfristig" };
export const SE: Job = { ...HB, id: "SE", name: "Selbstständig", employmentType: "selbststaendig" };
/** Altbestand ohne employmentType im Modus „fest“ → „unknown“ (Beschäftigungsart wählen). */
export const LEGACY: Job = {
  id: "LG",
  name: "Altbestand",
  color: "#64748b",
  mode: "fest",
  rate: 18,
  week: EMPTY_WEEK,
} as Job;

let n = 0;
export function work(jobId: string, date: string, start = "09:00", end = "13:00"): Shift {
  n += 1;
  return {
    id: `b4-${jobId}-${date}-${n}`,
    jobId,
    kind: "arbeit",
    date,
    start,
    end,
    breakMinutes: 0,
  } as Shift;
}

const days = (month: number, list: number[]) =>
  list.map((d) => `2026-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);

/** A: 10 × 4 h × 13,50 € = 540 € (bis Stichtag) + 1 geplanter Eintrag im November. */
export const SHIFTS_A: Shift[] = [
  ...days(3, [2, 9, 16, 23, 30]).map((d) => work("MA", d)),
  ...days(9, [1, 8, 15, 22, 29]).map((d) => work("MA", d)),
  work("MA", "2026-11-02"),
  work("MA", "2025-12-01"),
];
/** B: 8 × 4 h × 15 € = 480 €. */
export const SHIFTS_B: Shift[] = days(6, [3, 10, 17, 24])
  .concat(days(9, [2, 9, 16, 23]))
  .map((d) => work("MB", d));
/** Hauptbeschäftigung: 10 × 8 h × 20 € = 1.600 € (zählt NICHT zur Minijob-Grenze). */
export const SHIFTS_HB: Shift[] = days(5, [4, 5, 6, 7, 8, 11, 12, 13, 14, 15]).map((d) =>
  work("HB", d, "08:00", "16:00"),
);

export const B4_JOBS: Job[] = [MJ_A, MJ_B, HB];
export const B4_SHIFTS: Shift[] = [...SHIFTS_A, ...SHIFTS_B, ...SHIFTS_HB];

/** Erwartung: rechtliche Jahresnutzung 2026 = A + B (tatsächlich bis Stichtag). */
export const B4_LEGAL_EARNINGS = 540 + 480;
