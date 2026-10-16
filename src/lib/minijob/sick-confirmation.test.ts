/**
 * DECISIONS R3 Punkte 1 und 4 + QA P3 (R3/R1): Herkunftsmerkmal neu erfasster
 * Krankheitstage, signaturgebundene O-2-Bestätigungen, Neuprüfung nach
 * Änderung/Import/Ersetzen, Typprüfung, Sync-Zusammenführung, Export-Felder.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { isoDate } from "./calc";
import { sickExportFields } from "./export";
import { payrollTotals, shiftPayroll } from "./payroll";
import { makeResolver } from "./resolve";
import {
  confirmedSickMonths,
  mergeSickConfirmationsForRestore,
  sanitizeSickConfirmations,
  sickMonthSignature,
  sickRuleForSave,
  withSickConfirmations,
} from "./sick-confirmation";
import { DEMO_SCOPE } from "./storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  normalize,
  replaceAll,
  saveShift,
  updateSettings,
} from "./store";
import { DEFAULT_SETTINGS, type Job, type Shift } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const day = { start: "09:00", end: "14:00", breakMinutes: 0 };
const JOB: Job = {
  id: "j1",
  name: "Job",
  color: "#000",
  mode: "fest",
  employmentType: "minijob",
  rate: 15,
  startDate: "2025-01-01",
  week: Array.from({ length: 7 }, () => ({ active: true, ...day })),
};
const sick = (date: string, extra: Partial<Shift> = {}): Shift => ({
  id: `k-${date}`,
  jobId: "j1",
  kind: "krank",
  date,
  ...day,
  ...extra,
});
const runFrom = (y: number, m: number, d: number, n: number, extra: Partial<Shift> = {}) =>
  Array.from({ length: n }, (_, i) => sick(isoDate(new Date(y, m, d + i)), extra));
/** 60 Tage ab 02.11.2026: Tag 43 = 14.12.2026. */
const RUN = runFrom(2026, 10, 2, 60);

function monthEarnings(key: string) {
  const d = getData();
  const r = makeResolver(d.jobs, d.settings);
  return payrollTotals(
    d.shifts.filter((s) => s.date.startsWith(key)),
    r,
    d.shifts,
  ).earnings;
}

function seed(shifts: Shift[], settings: Record<string, unknown> = {}) {
  act(() =>
    replaceAll({
      ...EMPTY_DATA,
      jobs: [JOB],
      shifts,
      settings: { ...DEFAULT_SETTINGS, onboarded: true, localDemoMode: true, ...settings },
    } as never),
  );
}

function confirm(months: string[]) {
  act(() =>
    updateSettings({
      sickContinuousConfirmations: withSickConfirmations(
        getData().settings.sickContinuousConfirmations,
        months,
        getData().shifts,
        getData().jobs,
      ),
    }),
  );
}

beforeEach(() => {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
  loadFromStorage();
  act(() => activateScope(DEMO_SCOPE));
});

describe("Herkunftsmerkmal (DECISIONS R3 Punkt 1)", () => {
  it("sickRuleForSave: neu/Artwechsel → continuous; bisheriger Krankheitstag bleibt", () => {
    expect(sickRuleForSave("krank", undefined)).toBe("continuous");
    expect(sickRuleForSave("krank", { kind: "arbeit" })).toBe("continuous");
    expect(sickRuleForSave("krank", { kind: "krank" })).toBeUndefined();
    expect(sickRuleForSave("krank", { kind: "krank", sickRule: "continuous" })).toBe("continuous");
    expect(sickRuleForSave("arbeit", { kind: "krank", sickRule: "continuous" })).toBeUndefined();
    expect(sickRuleForSave("urlaub", undefined)).toBeUndefined();
  });

  it("v1.0 (t617u): vollständig markierte Kette – ohne Bestätigung keine automatische Zusammenfassung; Tag 43 erst nach O-2 unbezahlt", () => {
    const run = runFrom(2026, 10, 2, 60, { sickRule: "continuous" });
    const p = (s: Shift, confirmed?: string[]) =>
      shiftPayroll(s, {
        job: JOB,
        defaultRate: 15,
        history: run,
        ...(confirmed ? { sickContinuousConfirmed: confirmed } : {}),
      });
    expect(p(run[41]!).reason).toBe("sick-pay");
    expect(p(run[42]!).reason).toBe("sick-pay");
    expect(p(run[42]!).notice).toBe("sick-legacy-over-limit");
    const month = run[42]!.date.slice(0, 7);
    expect(p(run[42]!, [month]).reason).toBe("sick-exceeded");
  });

  it("gemischte Kette (ein bisheriger Tag): bisheriges Verhalten + Hinweis, keine Änderung", () => {
    const run = runFrom(2026, 10, 2, 60, { sickRule: "continuous" });
    run[10] = sick(run[10]!.date); // ein Alt-Eintrag ohne Merkmal
    const p = shiftPayroll(run[49]!, { job: JOB, defaultRate: 15, history: run });
    expect(p.reason).toBe("sick-pay");
    expect(p.notice).toBe("sick-legacy-over-limit");
  });
});

describe("Bestätigungen: Signatur, Neuprüfung, Import (DECISIONS R3 Punkt 4)", () => {
  it("2325 → 975 erst nach Bestätigung; Signatur passt zum Datenstand", () => {
    seed(RUN);
    expect(monthEarnings("2026-12")).toBe(2325);
    confirm(["2026-12"]);
    expect(confirmedSickMonths(getData().settings)).toEqual(["2026-12"]);
    expect(getData().settings.sickContinuousConfirmations![0]!.signature).toBe(
      sickMonthSignature("2026-12", getData().shifts, [JOB]),
    );
    expect(monthEarnings("2026-12")).toBe(975);
  });

  it("neuer betroffener Krankheitstag → Bestätigung verfällt (erneut anbieten)", () => {
    const run = RUN.slice(0, 55); // bis 26.12.
    seed(run);
    confirm(["2026-12"]);
    expect(monthEarnings("2026-12")).toBe(975);
    act(() => saveShift(sick("2026-12-27")));
    expect(getData().settings.sickContinuousConfirmations).toBeUndefined();
    expect(monthEarnings("2026-12")).toBe(27 * 75);
  });

  it("Arbeitseintrag nach der Krankheit lässt die Bestätigung bestehen", () => {
    seed(RUN);
    confirm(["2026-12"]);
    act(() => saveShift({ id: "w1", jobId: "j1", kind: "arbeit", date: "2027-01-05", ...day }));
    expect(confirmedSickMonths(getData().settings)).toEqual(["2026-12"]);
    expect(monthEarnings("2026-12")).toBe(975);
  });

  it("vollständiges Ersetzen/Import: nicht passende Bestätigung wird verworfen, passende bleibt", () => {
    seed(RUN);
    confirm(["2026-12"]);
    const good = getData().settings.sickContinuousConfirmations!;
    seed(RUN.slice(0, 50), { sickContinuousConfirmations: good });
    expect(getData().settings.sickContinuousConfirmations).toBeUndefined();
    expect(monthEarnings("2026-12")).toBe(21 * 75); // 01.–21.12., bisheriges Verhalten
    seed(RUN, { sickContinuousConfirmations: good });
    expect(confirmedSickMonths(getData().settings)).toEqual(["2026-12"]);
    expect(monthEarnings("2026-12")).toBe(975);
  });

  it("Vorabversions-Feld ohne Signatur wird beim Import verworfen, ändert nichts", () => {
    seed(RUN, { sickContinuousConfirmedMonths: ["2026-12"] });
    const settings = getData().settings as unknown as Record<string, unknown>;
    expect("sickContinuousConfirmedMonths" in settings).toBe(false);
    expect(monthEarnings("2026-12")).toBe(2325);
  });

  it("Backup-Typprüfung: nur {month:'YYYY-MM', signature:string}", () => {
    expect(sanitizeSickConfirmations("2026-12")).toEqual([]);
    expect(sanitizeSickConfirmations({ month: "2026-12", signature: "x" })).toEqual([]);
    expect(
      sanitizeSickConfirmations([
        "2026-12",
        null,
        ["2026-12", "x"],
        { month: 202612, signature: "x" },
        { month: "2026-13", signature: "x" },
        { month: "2026-11", signature: "" },
        { month: "2026-11", signature: 5 },
        { month: "2026-12", signature: "a" },
        { month: "2026-12", signature: "b" },
        { month: "2026-10", signature: "c", extra: true },
      ]),
    ).toEqual([
      { month: "2026-10", signature: "c" },
      { month: "2026-12", signature: "a" },
    ]);
    const n = normalize({
      settings: { ...DEFAULT_SETTINGS, sickContinuousConfirmations: "kaputt" as never },
    });
    expect(n.settings.sickContinuousConfirmations).toBeUndefined();
  });

  it("normalize: sickRule nur 'continuous' und nur bei krank", () => {
    const n = normalize({
      jobs: [JOB],
      shifts: [
        sick("2026-11-02", { sickRule: "continuous" }),
        sick("2026-11-03", { sickRule: "bogus" as never }),
        {
          id: "w",
          jobId: "j1",
          kind: "arbeit",
          date: "2026-11-04",
          ...day,
          sickRule: "continuous",
        },
      ],
    });
    expect(n.shifts.map((s) => s.sickRule)).toEqual(["continuous", undefined, undefined]);
  });

  it("withSickConfirmations behält andere Monate (QA M144-35); ohne Änderung kein Eintrag", () => {
    const keep = { month: "2027-03", signature: "1:deadbeef" };
    const out = withSickConfirmations([keep], ["2026-12", "2026-11"], RUN, [JOB]);
    expect(out.map((c) => c.month)).toEqual(["2026-12", "2027-03"]);
    expect(out[1]).toEqual(keep);
  });
});

describe("Sync-Wiederherstellung (QA P3-R3-144-e)", () => {
  const sig = sickMonthSignature("2026-12", RUN, [JOB]);
  it("lokale Bestätigung bleibt beim Übernehmen eines Cloud-Stands erhalten", () => {
    expect(sig).not.toBe("");
    expect(
      mergeSickConfirmationsForRestore(undefined, [{ month: "2026-12", signature: sig }], RUN, [
        JOB,
      ]),
    ).toEqual([{ month: "2026-12", signature: sig }]);
  });
  it("Konflikt: es gewinnt die zur übernommenen Datenlage passende Signatur", () => {
    const local = [{ month: "2026-12", signature: sig }];
    const remote = [{ month: "2026-12", signature: "9:00000000" }];
    expect(mergeSickConfirmationsForRestore(remote, local, RUN, [JOB])).toEqual(local);
    expect(mergeSickConfirmationsForRestore(local, remote, RUN, [JOB])).toEqual(local);
  });
  it("cloud.ts applyRemote führt die Bestätigungen zusammen", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "cloud.ts"), "utf8");
    expect(src).toMatch(/mergeSickConfirmationsForRestore\(\s*authMerged\.settings/);
  });
});

describe("Export-Felder (QA M144-26)", () => {
  it("sickExportFields: volle Historie + gültige Monate", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      sickContinuousConfirmations: [{ month: "2026-12", signature: "x" }],
    };
    expect(sickExportFields(settings, RUN)).toEqual({
      history: RUN,
      sickContinuousConfirmed: ["2026-12"],
    });
  });
  it.each(["einstellungen.tsx", "statistik.tsx"])("%s nutzt sickExportFields", (file) => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../routes", file),
      "utf8",
    );
    expect(src).toMatch(/\.\.\.sickExportFields\(settings,\s*shifts\)/);
  });
});
