/**
 * Sicherung & Wiederherstellung dürfen die Daten der Abwesenheitskorrektur nicht verlieren:
 * Einträge (ID, Notiz, sickCaseId, Zeiten) und der Wochenplan samt `weekHistory` bleiben erhalten,
 * und die Neuberechnung nach der Wiederherstellung ergibt dieselben Beträge.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { restoreLocalBackupFile } from "./local-backup-restore";
import { payrollTotals } from "./payroll";
import { makeResolver } from "./resolve";
import { addAbsence, saveAbsenceEdit } from "./service";
import { EMPTY_DATA, getData, replaceAll, saveShift } from "./store";
import { contiguousAbsenceRange } from "./absence-range";
import { DEFAULT_SETTINGS, type FixedDay, type Job } from "./types";

const day = (active: boolean): FixedDay => ({
  active,
  start: "08:00",
  end: "13:00",
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
  week: MON_ONLY,
  weekHistory: [{ effectiveFrom: "2026-10-20", week: MON_FRI }],
} as Job;

beforeEach(() => {
  replaceAll({
    ...EMPTY_DATA,
    jobs: [JOB],
    shifts: [],
    settings: { ...DEFAULT_SETTINGS, activeJobId: "J", bundesland: "BE" },
  } as never);
});

describe("Sicherung → Wiederherstellung", () => {
  it("Abwesenheiten mit Notiz/Fall-ID und der historische Wochenplan überleben die Wiederherstellung", async () => {
    addAbsence(JOB, "krank", "2026-09-07", "2026-09-13");
    const wed = getData().shifts.find((s) => s.date === "2026-09-09")!;
    saveShift({ ...wed, note: "Notiz bleibt" });
    // Zeitraum verlängern (Differenz-Speichern): dieselbe Krankheitsfall-ID, keine Neuanlage.
    const monday = getData().shifts.find((s) => s.date === "2026-09-07")!;
    saveAbsenceEdit(
      JOB,
      "krank",
      "2026-09-07",
      "2026-09-18",
      contiguousAbsenceRange(monday, getData().shifts).ids,
    );

    const settings = getData().settings;
    const before = getData();
    const totalsBefore = payrollTotals(
      before.shifts,
      makeResolver(before.jobs, settings),
      before.shifts,
    );
    const json = JSON.stringify(before);

    replaceAll({ ...EMPTY_DATA, settings: { ...DEFAULT_SETTINGS } } as never);
    expect(getData().shifts).toHaveLength(0);

    const result = await restoreLocalBackupFile(new Blob([json], { type: "application/json" }));
    expect(result).toBe("restored");

    const after = getData();
    expect(after.shifts.map((s) => s.id).sort()).toEqual(before.shifts.map((s) => s.id).sort());
    expect(after.shifts.find((s) => s.date === "2026-09-09")?.note).toBe("Notiz bleibt");
    expect(
      new Set(after.shifts.filter((s) => s.kind === "krank").map((s) => s.sickCaseId)).size,
    ).toBe(1);
    expect(after.jobs[0]!.weekHistory).toEqual(JOB.weekHistory);
    expect(after.jobs[0]!.week).toEqual(MON_ONLY);

    const totalsAfter = payrollTotals(
      after.shifts,
      makeResolver(after.jobs, after.settings),
      after.shifts,
    );
    expect(totalsAfter).toEqual(totalsBefore);
  });
});
