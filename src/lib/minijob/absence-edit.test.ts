/**
 * QA P0: Beim Bearbeiten eines Abwesenheitszeitraums gingen Notizen/IDs verloren und Tage verschwanden
 * (alle Einträge des Blocks löschen + neu erzeugen). Jetzt wird nur die Differenz gespeichert.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { planAbsenceEdit } from "./absence-plan";
import { contiguousAbsenceRange } from "./absence-range";
import { addAbsence, saveAbsenceEdit } from "./service";
import { EMPTY_DATA, getData, replaceAll, saveShift } from "./store";
import { DEFAULT_SETTINGS, type FixedDay, type Job, type Shift } from "./types";

const day = (active: boolean, start = "08:00", end = "13:00"): FixedDay => ({
  active,
  start,
  end,
  breakMinutes: 0,
});
const MON_FRI = [day(true), day(true), day(true), day(true), day(true), day(false), day(false)];
const MON_ONLY = [
  day(true),
  day(false),
  day(false),
  day(false),
  day(false),
  day(false),
  day(false),
];

const JOB: Job = {
  id: "J",
  name: "Fest",
  color: "#123456",
  rate: 15,
  mode: "fest",
  employmentType: "minijob",
  startDate: "2026-01-01",
  week: MON_FRI,
} as Job;
const OTHER: Job = { ...JOB, id: "K", name: "Zweiter Job" } as Job;

// Woche 07.–13.09.2026 (Mo–So), keine Feiertage in Berlin.
const W_FROM = "2026-09-07";
const W_TO = "2026-09-13";

function seed(jobs: Job[], shifts: Shift[] = []) {
  replaceAll({
    ...EMPTY_DATA,
    jobs,
    shifts,
    settings: { ...DEFAULT_SETTINGS, activeJobId: jobs[0]?.id, bundesland: "BE" },
  } as never);
}

const entries = (kind: Shift["kind"] = "urlaub", jobId = "J") =>
  getData()
    .shifts.filter((s) => s.kind === kind && s.jobId === jobId)
    .sort((a, b) => a.date.localeCompare(b.date));
const byDate = (date: string, kind: Shift["kind"] = "urlaub", jobId = "J") =>
  entries(kind, jobId).find((s) => s.date === date)!;
const blockIds = (date: string, kind: Shift["kind"] = "urlaub", jobId = "J") =>
  contiguousAbsenceRange(byDate(date, kind, jobId), getData().shifts).ids;
const setNote = (date: string, note: string) => saveShift({ ...byDate(date), note });
const noDuplicateDays = (jobId = "J") => {
  const days = getData()
    .shifts.filter((s) => s.jobId === jobId)
    .map((s) => s.date);
  expect(new Set(days).size).toBe(days.length);
};

beforeEach(() => seed([JOB]));

describe("Abwesenheitszeitraum speichern – Differenz statt Neuanlage", () => {
  it("unverändert erneut speichern: nichts ändert sich, IDs und Notizen bleiben", () => {
    addAbsence(JOB, "urlaub", W_FROM, W_TO);
    setNote("2026-09-09", "Arzttermin davor");
    const before = entries().map((s) => ({ ...s }));

    const result = saveAbsenceEdit(JOB, "urlaub", W_FROM, W_TO, blockIds("2026-09-07"));

    expect(result).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(entries()).toEqual(before);
    expect(byDate("2026-09-09").note).toBe("Arzttermin davor");
    noDuplicateDays();
  });

  it("Zeitraum verkürzen: nur die herausgefallenen Tage werden gelöscht", () => {
    addAbsence(JOB, "urlaub", W_FROM, W_TO);
    setNote("2026-09-08", "bleibt");
    const keep = ["2026-09-07", "2026-09-08", "2026-09-09"].map((d) => byDate(d).id);

    const result = saveAbsenceEdit(JOB, "urlaub", W_FROM, "2026-09-09", blockIds("2026-09-07"));

    expect(result).toEqual({ created: 0, updated: 0, deleted: 2 });
    expect(entries().map((s) => s.date)).toEqual(["2026-09-07", "2026-09-08", "2026-09-09"]);
    expect(entries().map((s) => s.id)).toEqual(keep);
    expect(byDate("2026-09-08").note).toBe("bleibt");
  });

  it("Anfang nach hinten schieben löscht nur die führenden Tage", () => {
    addAbsence(JOB, "urlaub", W_FROM, W_TO);
    const keep = ["2026-09-09", "2026-09-10", "2026-09-11"].map((d) => byDate(d).id);

    const result = saveAbsenceEdit(JOB, "urlaub", "2026-09-09", W_TO, blockIds("2026-09-07"));

    expect(result.deleted).toBe(2);
    expect(entries().map((s) => s.id)).toEqual(keep);
  });

  it("Zeitraum verlängern: nur fehlende Plan-Tage kommen dazu, vorhandene bleiben unangetastet", () => {
    addAbsence(JOB, "urlaub", W_FROM, W_TO);
    setNote("2026-09-10", "Notiz");
    const old = entries().map((s) => ({ ...s }));

    const result = saveAbsenceEdit(JOB, "urlaub", W_FROM, "2026-09-18", blockIds("2026-09-07"));

    expect(result).toEqual({ created: 5, updated: 0, deleted: 0 });
    expect(entries()).toHaveLength(10);
    for (const before of old) expect(entries().find((s) => s.id === before.id)).toEqual(before);
    expect(byDate("2026-09-10").note).toBe("Notiz");
    noDuplicateDays();
  });

  it("andere Einträge desselben Tages werden nie überschrieben oder verdoppelt", () => {
    seed(
      [JOB],
      [
        {
          id: "work-thu",
          jobId: "J",
          kind: "arbeit",
          date: "2026-09-10",
          start: "09:00",
          end: "12:00",
          breakMinutes: 0,
        } as Shift,
      ],
    );
    addAbsence(JOB, "urlaub", W_FROM, W_TO);
    expect(entries().map((s) => s.date)).not.toContain("2026-09-10");

    saveAbsenceEdit(JOB, "urlaub", W_FROM, "2026-09-18", blockIds("2026-09-07"));
    saveAbsenceEdit(JOB, "urlaub", W_FROM, "2026-09-18", blockIds("2026-09-07"));

    expect(getData().shifts.find((s) => s.id === "work-thu")?.kind).toBe("arbeit");
    noDuplicateDays();
  });

  it("Art ändern: Einträge werden umgestellt (ID und Notiz bleiben), ein Krankheitsfall", () => {
    addAbsence(JOB, "urlaub", W_FROM, W_TO);
    setNote("2026-09-09", "Notiz");
    const ids = entries().map((s) => s.id);

    saveAbsenceEdit(JOB, "krank", W_FROM, W_TO, blockIds("2026-09-07"));

    const sick = entries("krank");
    expect(sick.map((s) => s.id)).toEqual(ids);
    expect(entries("urlaub")).toHaveLength(0);
    expect(new Set(sick.map((s) => s.sickCaseId)).size).toBe(1);
    expect(sick[0]!.sickCaseId).toBeTruthy();
    expect(byDate("2026-09-09", "krank").note).toBe("Notiz");

    saveAbsenceEdit(JOB, "urlaub", W_FROM, W_TO, blockIds("2026-09-07", "krank"));
    expect(entries("urlaub").map((s) => s.id)).toEqual(ids);
    expect(entries("urlaub").every((s) => s.sickCaseId === undefined)).toBe(true);
  });

  it("Verlängern eines Krankheitszeitraums bleibt ein Fall (keine zweite 42-Tage-Frist)", () => {
    addAbsence(JOB, "krank", W_FROM, W_TO);
    const caseId = entries("krank")[0]!.sickCaseId;

    saveAbsenceEdit(JOB, "krank", W_FROM, "2026-09-18", blockIds("2026-09-07", "krank"));

    expect(entries("krank")).toHaveLength(10);
    expect(new Set(entries("krank").map((s) => s.sickCaseId))).toEqual(new Set([caseId]));
  });

  it("Job wechseln: Einträge ziehen um; ein belegter Tag des neuen Jobs wird nicht doppelt belegt", () => {
    seed(
      [JOB, OTHER],
      [
        {
          id: "k-wed",
          jobId: "K",
          kind: "arbeit",
          date: "2026-09-09",
          start: "09:00",
          end: "12:00",
          breakMinutes: 0,
        } as Shift,
      ],
    );
    addAbsence(JOB, "urlaub", W_FROM, W_TO);
    setNote("2026-09-08", "Notiz");
    const moved = byDate("2026-09-08").id;

    saveAbsenceEdit(OTHER, "urlaub", W_FROM, W_TO, blockIds("2026-09-07"));

    expect(entries("urlaub", "J")).toHaveLength(0);
    expect(entries("urlaub", "K").map((s) => s.date)).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-10",
      "2026-09-11",
    ]);
    expect(entries("urlaub", "K").find((s) => s.id === moved)?.note).toBe("Notiz");
    noDuplicateDays("K");
  });

  it("nach Planwechsel (nur noch Montag): Verlängern bis Sonntag lässt Di–Fr der Vergangenheit stehen", () => {
    addAbsence(JOB, "urlaub", W_FROM, W_TO);
    setNote("2026-09-09", "Notiz");
    const ids = entries().map((s) => s.id);
    // Planwechsel am 20.10.: bisheriger Plan (Mo–Fr) landet in der Historie.
    const changed: Job = {
      ...JOB,
      week: MON_ONLY,
      weekHistory: [{ effectiveFrom: "2026-10-20", week: MON_FRI }],
    };
    seed([changed], getData().shifts);

    const result = saveAbsenceEdit(changed, "urlaub", W_FROM, W_TO, blockIds("2026-09-07"));

    expect(result).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(entries().map((s) => s.id)).toEqual(ids);
    expect(byDate("2026-09-09").note).toBe("Notiz");
  });

  it("planAbsenceEdit ist rein: dieselbe Eingabe ändert den Speicher nicht", () => {
    addAbsence(JOB, "urlaub", W_FROM, W_TO);
    const before = JSON.stringify(getData().shifts);
    const plan = planAbsenceEdit({
      job: JOB,
      kind: "urlaub",
      from: W_FROM,
      to: "2026-09-18",
      bundesland: "BE",
      previousIds: blockIds("2026-09-07"),
      existing: getData().shifts,
    });
    expect(plan.created).toHaveLength(5);
    expect(JSON.stringify(getData().shifts)).toBe(before);
  });
});
