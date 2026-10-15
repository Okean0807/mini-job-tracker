/**
 * D5 (Owner R4): Schutz vor veralteten O-2-Bestätigungen bleibt; eine
 * aufgehobene Bestätigung wird NIE still entfernt, sondern als
 * `settings.sickConfirmationsLapsed` gemerkt und angezeigt, bis der Nutzer den
 * Hinweis schließt oder den Monat erneut bestätigt. Echter Store (Testmodus).
 */
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { isoDate } from "./calc";
import {
  lapsedWithout,
  sanitizeLapsedMonths,
  withCurrentSickConfirmations,
  withSickConfirmations,
} from "./sick-confirmation";
import { DEMO_SCOPE } from "./storage-scope";
import {
  EMPTY_DATA,
  activateScope,
  applyShiftChanges,
  deleteShift,
  getData,
  loadFromStorage,
  normalize,
  replaceAll,
  updateSettings,
} from "./store";
import { DEFAULT_SETTINGS, type AppData, type Job, type Shift } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const day = { start: "09:00", end: "14:00", breakMinutes: 0 };
const JOB = {
  id: "j1",
  name: "j1",
  color: "#000",
  mode: "fest",
  rate: 15,
  startDate: "2025-01-01",
  week: Array.from({ length: 7 }, () => ({ active: true, ...day })),
} as unknown as Job;
const RUN: Shift[] = Array.from({ length: 61 }, (_, i) => {
  const date = isoDate(new Date(2026, 10, 1 + i));
  return { id: `k-${date}`, jobId: "j1", kind: "krank", date, ...day } as Shift;
});
const CONF = withSickConfirmations(undefined, ["2026-12"], RUN, [JOB]);

function clearAppKeys() {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
}

beforeEach(() => {
  clearAppKeys();
  loadFromStorage();
  act(() => {
    activateScope(DEMO_SCOPE);
    replaceAll({
      ...EMPTY_DATA,
      jobs: [JOB],
      shifts: RUN,
      settings: {
        ...DEFAULT_SETTINGS,
        onboarded: true,
        localDemoMode: true,
        sickContinuousConfirmations: CONF,
      },
    } as never);
  });
});

describe("sanitizeLapsedMonths / lapsedWithout", () => {
  it("nur gültige YYYY-MM, eindeutig, sortiert", () => {
    expect(sanitizeLapsedMonths(["2026-12", "x", "2026-13", "2026-01", "2026-12", 5])).toEqual([
      "2026-01",
      "2026-12",
    ]);
    expect(sanitizeLapsedMonths(undefined)).toEqual([]);
    expect(sanitizeLapsedMonths("2026-12")).toEqual([]);
  });
  it("erneut bestätigte Monate werden entfernt", () => {
    expect(lapsedWithout(["2026-11", "2026-12"], ["2026-12"])).toEqual(["2026-11"]);
  });
});

describe("D5 im Store", () => {
  it("Ausgangslage: Bestätigung gültig, nichts aufgehoben", () => {
    expect(getData().settings.sickContinuousConfirmations).toEqual(CONF);
    expect(getData().settings.sickConfirmationsLapsed).toBeUndefined();
  });

  it("Löschen eines Krankheitstags hebt die Bestätigung auf – mit Meldung (nicht still)", () => {
    act(() => deleteShift("k-2026-11-20"));
    const s = getData().settings;
    expect(s.sickContinuousConfirmations).toBeUndefined(); // Schutz bleibt
    expect(s.sickConfirmationsLapsed).toEqual(["2026-12"]); // aber gemeldet
  });

  it("Meldung übersteht Neustart (Persistenz + normalize)", () => {
    act(() => deleteShift("k-2026-11-20"));
    act(() => {
      loadFromStorage();
      activateScope(DEMO_SCOPE);
    });
    expect(getData().settings.sickConfirmationsLapsed).toEqual(["2026-12"]);
    expect(
      normalize({ settings: { sickConfirmationsLapsed: ["2026-12", "bad"] } } as never).settings
        .sickConfirmationsLapsed,
    ).toEqual(["2026-12"]);
    expect(
      normalize({ settings: { sickConfirmationsLapsed: ["bad"] } } as never).settings,
    ).not.toHaveProperty("sickConfirmationsLapsed");
  });

  it("Schließen entfernt nur die Meldung, nicht den Schutz", () => {
    act(() => deleteShift("k-2026-11-20"));
    act(() => updateSettings({ sickConfirmationsLapsed: [] }));
    expect(sanitizeLapsedMonths(getData().settings.sickConfirmationsLapsed)).toEqual([]);
    expect(getData().settings.sickContinuousConfirmations).toBeUndefined();
  });

  it("erneute Bestätigung entfernt den Monat aus der Meldung (wie Dashboard onConfirm)", () => {
    // Ersten Tag löschen: Fall beginnt einen Tag später, Dezember bleibt
    // abweichend, aber mit neuer Signatur → Bestätigung aufgehoben, neu bestätigbar.
    act(() => deleteShift("k-2026-11-01"));
    expect(getData().settings.sickConfirmationsLapsed).toEqual(["2026-12"]);
    const data = getData();
    act(() =>
      updateSettings({
        sickContinuousConfirmations: withSickConfirmations(
          data.settings.sickContinuousConfirmations,
          ["2026-12"],
          data.shifts,
          data.jobs,
        ),
        sickConfirmationsLapsed: lapsedWithout(data.settings.sickConfirmationsLapsed, ["2026-12"]),
      }),
    );
    const s = getData().settings;
    expect(s.sickContinuousConfirmations?.map((c) => c.month)).toEqual(["2026-12"]);
    expect(sanitizeLapsedMonths(s.sickConfirmationsLapsed)).toEqual([]);
  });

  it("applyShiftChanges: Entfernen + Neu-Anlegen derselben Tage in EINEM Schritt hebt nichts auf", () => {
    const target = RUN.filter((s) => s.date >= "2026-11-10" && s.date <= "2026-11-12");
    act(() =>
      applyShiftChanges(
        target.map((s) => s.id),
        target.map((s) => ({ ...s })),
      ),
    );
    expect(getData().settings.sickContinuousConfirmations).toEqual(CONF);
    expect(getData().settings.sickConfirmationsLapsed).toBeUndefined();
  });

  it("Zeit-Änderung an einem Tag ohne Signaturwirkung → Bestätigung bleibt, keine Meldung", () => {
    const s = RUN.find((x) => x.date === "2026-11-05")!;
    act(() => applyShiftChanges([], [{ ...s, note: "Attest liegt vor" } as Shift]));
    expect(getData().settings.sickContinuousConfirmations).toEqual(CONF);
    expect(getData().settings.sickConfirmationsLapsed).toBeUndefined();
  });
});

describe("withCurrentSickConfirmations (rein)", () => {
  const base = {
    ...EMPTY_DATA,
    jobs: [JOB],
    shifts: RUN,
    settings: { ...DEFAULT_SETTINGS, sickContinuousConfirmations: CONF },
  } as unknown as AppData;
  it("bestehende Meldungen werden mit neuen zusammengeführt", () => {
    const data = {
      ...base,
      shifts: RUN.filter((s) => s.date !== "2026-11-20"),
      settings: { ...base.settings, sickConfirmationsLapsed: ["2026-10"] },
    } as AppData;
    expect(withCurrentSickConfirmations(data).settings.sickConfirmationsLapsed).toEqual([
      "2026-10",
      "2026-12",
    ]);
  });
  it("Vorabversions-Feld ohne Signatur wird gemeldet statt still verworfen", () => {
    const data = {
      ...base,
      settings: { ...DEFAULT_SETTINGS, sickContinuousConfirmedMonths: ["2026-11"] },
    } as unknown as AppData;
    const out = withCurrentSickConfirmations(data).settings as unknown as Record<string, unknown>;
    expect(out["sickContinuousConfirmedMonths"]).toBeUndefined();
    expect(out["sickConfirmationsLapsed"]).toEqual(["2026-11"]);
  });
});
