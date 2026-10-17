/**
 * V10-ABS-PLAN-P2-1 (QA V10_ABS_PLAN_ACCEPTANCE_R1): Ersetzen eines bestehenden
 * Abwesenheitszeitraums darf Einträge nie still löschen.
 *  - Unverändert speichern → keine Datenänderung (auch bei Altbestand an laut
 *    gültigem Plan freien Tagen und bei unbekanntem historischem Plan).
 *  - Ändert sich Anzahl oder Entgelt bzw. entfallen Einträge im Zeitraum → Rückfrage
 *    mit Vorher/Nachher (RetroImpactDialog) VOR dem Speichern; Abbrechen ändert nichts.
 * Echter Render, echter Store, echte Berechnung (kein Spy). Beträge über payrollTotals.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsenceDialog } from "./AbsenceDialog";
import { isoDate } from "@/lib/minijob/calc";
import { payrollTotals, shiftPayroll } from "@/lib/minijob/payroll";
import { makeResolver } from "@/lib/minijob/resolve";
import { absenceRangeChange } from "@/lib/minijob/retro-impact";
import { planAbsence, shiftsAfterPlan } from "@/lib/minijob/service";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
  useAppData,
} from "@/lib/minijob/store";
import {
  DEFAULT_SETTINGS,
  type AppData,
  type FixedDay,
  type Job,
  type Shift,
} from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const d5 = { start: "09:00", end: "14:00", breakMinutes: 0 };
const days = (flags: boolean[]): FixedDay[] => flags.map((active) => ({ active, ...d5 }));
const MON_FRI = days([true, true, true, true, true, false, false]);
const ALL = days([true, true, true, true, true, true, true]);

/** Plan bis 30.09.2026 Mo–Fr, ab 01.10.2026 alle Tage (QA-Repro). */
const JOB_EXTENDED = {
  id: "j1",
  name: "Büro",
  color: "#0d9488",
  mode: "fest",
  employmentType: "minijob",
  rate: 15,
  startDate: "2025-01-01",
  week: ALL,
  weekHistory: [{ effectiveFrom: "2026-10-01", week: MON_FRI }],
} as unknown as Job;
/** Wie oben, aber der historische Eintrag hat keine Plan-Daten (unbekannt). */
const JOB_UNKNOWN = {
  ...JOB_EXTENDED,
  weekHistory: [{ effectiveFrom: "2026-10-01" }],
} as unknown as Job;
/** Plan Mo–Fr ohne Historie. */
const JOB_PLAIN = { ...JOB_EXTENDED, week: MON_FRI, weekHistory: undefined } as unknown as Job;

function eachDay(from: string, to: string, weekdaysOnly = false): string[] {
  const out: string[] = [];
  const d = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");
  for (; d <= end; d.setDate(d.getDate() + 1)) {
    if (!weekdaysOnly || (d.getDay() >= 1 && d.getDay() <= 5)) out.push(isoDate(d));
  }
  return out;
}
/** Altbestand: 7 Einträge Mo 07.–So 13.09.2026 (vom früheren Fehler nach aktuellem Plan). */
const legacy = (kind: "urlaub" | "krank"): Shift[] =>
  eachDay("2026-09-07", "2026-09-13").map(
    (date) =>
      ({
        id: `${kind}-${date}`,
        jobId: "j1",
        kind,
        date,
        ...d5,
        rate: 15,
        ...(kind === "krank" ? { sickCaseId: "c1" } : {}),
      }) as Shift,
  );

let container: HTMLDivElement;
let root: Root;
let closed = 0;

function clearAppKeys() {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const tid = (id: string) => q(`[data-testid="${id}"]`);
function click(el: Element | null) {
  if (!el) throw new Error("element missing");
  act(() => (el as HTMLElement).click());
}
function setValue(el: HTMLElement | null, value: string) {
  if (!el) throw new Error("input missing");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function reload() {
  act(() => {
    loadFromStorage();
    activateScope(DEMO_SCOPE);
  });
}
function seed(jobs: Job[], shifts: Shift[]) {
  act(() =>
    replaceAll({
      ...EMPTY_DATA,
      jobs,
      shifts,
      settings: { ...DEFAULT_SETTINGS, onboarded: true, localDemoMode: true },
    } as never),
  );
}
const snapshot = () => JSON.stringify(getData().shifts);
const saved = (kind: Shift["kind"]) =>
  getData()
    .shifts.filter((s) => s.jobId === "j1" && s.kind === kind)
    .sort((a, b) => a.date.localeCompare(b.date));
/** Gespeichertes Entgelt dieser Art (gleiche Bewertung wie Dashboard/Grenze). */
const totalOf = (kind: Shift["kind"]) => {
  const d = getData();
  const list = saved(kind);
  return payrollTotals(list, makeResolver(d.jobs, d.settings), d.shifts).earnings;
};

function Harness({ seedId }: { seedId: string }) {
  const data = useAppData();
  return createElement(AbsenceDialog, {
    open: true,
    onOpenChange: (open: boolean) => {
      if (!open) closed += 1;
    },
    jobs: data.jobs,
    shifts: data.shifts,
    seed: data.shifts.find((s) => s.id === seedId) ?? null,
  });
}
const open = (seedId: string) => act(() => root.render(createElement(Harness, { seedId })));
const rangeRow = () => tid("retro-impact-range-row");

beforeEach(() => {
  clearAppKeys();
  loadFromStorage();
  act(() => activateScope(DEMO_SCOPE));
  closed = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Unverändert speichern → keine Datenänderung", () => {
  it("Urlaub: 7 Einträge / 525 € (Sa/So laut gültigem Plan frei) bleiben 7 / 525 €, ohne Rückfrage", () => {
    seed([JOB_EXTENDED], legacy("urlaub"));
    expect(totalOf("urlaub")).toBe(525);
    const before = snapshot();
    open("urlaub-2026-09-07");
    expect((q("#absence-from") as HTMLInputElement).value).toBe("2026-09-07");
    expect((q("#absence-to") as HTMLInputElement).value).toBe("2026-09-13");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).toBeNull();
    expect(snapshot()).toBe(before);
    expect(saved("urlaub").map((s) => s.date)).toEqual(eachDay("2026-09-07", "2026-09-13"));
    expect(totalOf("urlaub")).toBe(525);
    expect(closed).toBe(1);
    reload();
    expect(snapshot()).toBe(before);
  });

  it("Krank: 7 Einträge bleiben unverändert (gleiche IDs, gleicher Fall, gleicher Betrag)", () => {
    seed([JOB_EXTENDED], legacy("krank"));
    const total = totalOf("krank");
    expect(total).toBe(375); // Sa/So damals planfrei → unbezahlt
    const before = snapshot();
    open("krank-2026-09-07");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).toBeNull();
    expect(snapshot()).toBe(before);
    expect(saved("krank").every((s) => s.sickCaseId === "c1")).toBe(true);
    expect(totalOf("krank")).toBe(total);
  });

  it("historischer Plan unbekannt: 7 / 525 € bleiben 7 / 525 € (nicht 0 / 0 €)", () => {
    seed([JOB_UNKNOWN], legacy("urlaub"));
    expect(totalOf("urlaub")).toBe(525);
    const before = snapshot();
    open("urlaub-2026-09-07");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).toBeNull();
    expect(snapshot()).toBe(before);
    expect(saved("urlaub")).toHaveLength(7);
    expect(totalOf("urlaub")).toBe(525);
  });
});

describe("unbekannter historischer Plan bei echter Änderung", () => {
  it("Verlängern auf 07.–14.09.: Einträge an unbekannten Tagen bleiben, nichts geraten, nichts genullt", () => {
    seed([JOB_UNKNOWN], legacy("urlaub"));
    const before = snapshot();
    open("urlaub-2026-09-07");
    setValue(q("#absence-to"), "2026-09-14");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).toBeNull();
    expect(snapshot()).toBe(before); // 14.09. unbekannt → nicht angelegt; Altbestand bleibt
    expect(totalOf("urlaub")).toBe(525);
    expect(closed).toBe(1);
  });

  it("Art ändern (Urlaub → Krank) bei unbekanntem Plan: Rückfrage zeigt Verlust; Abbrechen ändert nichts", () => {
    seed([JOB_UNKNOWN], legacy("urlaub"));
    const before = snapshot();
    open("urlaub-2026-09-07");
    click([...document.querySelectorAll("button")].find((b) => b.textContent === "Krank") ?? null);
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).not.toBeNull();
    expect(rangeRow()?.getAttribute("data-days-before")).toBe("7");
    expect(rangeRow()?.getAttribute("data-before")).toBe("525.00");
    expect(rangeRow()?.getAttribute("data-days-after")).toBe("0");
    expect(rangeRow()?.getAttribute("data-after")).toBe("0.00");
    expect(tid("retro-impact-range-lost")?.getAttribute("data-days")).toBe(
      eachDay("2026-09-07", "2026-09-13").join(","),
    );
    click(tid("retro-impact-cancel"));
    expect(snapshot()).toBe(before);
    expect(totalOf("urlaub")).toBe(525);
    expect(closed).toBe(0);
  });
});

describe("echte Änderung mit Vorher/Nachher-Rückfrage", () => {
  it("Urlaub 07.–13.09. → 07.–20.09. (Plan Mo–Fr): 7 / 525 € → 10 / 750 €, Sa/So entfallen; Abbrechen ändert nichts, Bestätigen speichert", () => {
    seed([JOB_EXTENDED], legacy("urlaub"));
    const before = snapshot();
    open("urlaub-2026-09-07");
    setValue(q("#absence-to"), "2026-09-20");
    click(tid("absence-save"));

    expect(tid("retro-impact-dialog")).not.toBeNull();
    expect(snapshot()).toBe(before); // vor Bestätigung nichts gespeichert
    expect(rangeRow()?.getAttribute("data-days-before")).toBe("7");
    expect(rangeRow()?.getAttribute("data-before")).toBe("525.00");
    expect(rangeRow()?.getAttribute("data-days-after")).toBe("10");
    expect(rangeRow()?.getAttribute("data-after")).toBe("750.00");
    expect(tid("retro-impact-range-lost")?.getAttribute("data-days")).toBe("2026-09-12,2026-09-13");
    expect(rangeRow()?.textContent).toContain("7");
    expect(rangeRow()?.textContent).toContain("10");

    click(tid("retro-impact-cancel"));
    expect(tid("retro-impact-dialog")).toBeNull();
    expect(snapshot()).toBe(before);
    expect(totalOf("urlaub")).toBe(525);
    expect(closed).toBe(0);
    reload();
    expect(snapshot()).toBe(before);

    open("urlaub-2026-09-07");
    setValue(q("#absence-to"), "2026-09-20");
    click(tid("absence-save"));
    click(tid("retro-impact-confirm"));
    expect(saved("urlaub").map((s) => s.date)).toEqual(eachDay("2026-09-07", "2026-09-20", true));
    expect(totalOf("urlaub")).toBe(750);
    expect(closed).toBe(1);
  });

  it("gleiche Anzahl und gleicher Betrag, aber Sa/So entfallen (07.–13.09. → 07.–15.09.) → trotzdem Rückfrage", () => {
    seed([JOB_EXTENDED], legacy("urlaub"));
    const before = snapshot();
    open("urlaub-2026-09-07");
    setValue(q("#absence-to"), "2026-09-15");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).not.toBeNull();
    expect(rangeRow()?.getAttribute("data-days-before")).toBe("7");
    expect(rangeRow()?.getAttribute("data-days-after")).toBe("7");
    expect(rangeRow()?.getAttribute("data-before")).toBe("525.00");
    expect(rangeRow()?.getAttribute("data-after")).toBe("525.00");
    expect(tid("retro-impact-range-lost")?.getAttribute("data-days")).toBe("2026-09-12,2026-09-13");
    click(tid("retro-impact-cancel"));
    expect(snapshot()).toBe(before);
    click(tid("absence-save"));
    click(tid("retro-impact-confirm"));
    expect(saved("urlaub").map((s) => s.date)).toEqual(eachDay("2026-09-07", "2026-09-15", true));
    expect(totalOf("urlaub")).toBe(525);
  });

  it("Krank verkürzen 07.–13.09. → 07.–09.09.: Rückfrage 7 / 375 € → 3 / 225 €; Bestätigen speichert 3 Tage", () => {
    seed([JOB_EXTENDED], legacy("krank"));
    open("krank-2026-09-07");
    setValue(q("#absence-to"), "2026-09-09");
    click(tid("absence-save"));
    expect(rangeRow()?.getAttribute("data-days-before")).toBe("7");
    expect(rangeRow()?.getAttribute("data-before")).toBe("375.00");
    expect(rangeRow()?.getAttribute("data-days-after")).toBe("3");
    expect(rangeRow()?.getAttribute("data-after")).toBe("225.00");
    expect(tid("retro-impact-range-lost")).toBeNull(); // 10.–13.09. liegen außerhalb des neuen Zeitraums
    click(tid("retro-impact-confirm"));
    expect(saved("krank").map((s) => s.date)).toEqual(["2026-09-07", "2026-09-08", "2026-09-09"]);
    expect(totalOf("krank")).toBe(225);
  });

  it("Kontrolle: verschieben bei gleicher Anzahl und gleichem Betrag (Mo–Fr) → ohne Rückfrage", () => {
    const five = eachDay("2026-08-03", "2026-08-07").map(
      (date) => ({ id: `u-${date}`, jobId: "j1", kind: "urlaub", date, ...d5 }) as Shift,
    );
    seed([JOB_PLAIN], five);
    open("u-2026-08-03");
    setValue(q("#absence-from"), "2026-08-10");
    setValue(q("#absence-to"), "2026-08-14");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).toBeNull();
    expect(saved("urlaub").map((s) => s.date)).toEqual(eachDay("2026-08-10", "2026-08-14"));
    expect(totalOf("urlaub")).toBe(375);
  });
});

describe("Lib: planAbsence / absenceRangeChange", () => {
  const data = (jobs: Job[], shifts: Shift[]) =>
    ({ ...EMPTY_DATA, jobs, shifts, settings: DEFAULT_SETTINGS }) as unknown as AppData;
  const replace = { jobId: "j1", kind: "urlaub" as const, from: "2026-09-07", to: "2026-09-13" };

  it("unverändert → leerer Plan; unbekannte Tage im neuen Zeitraum werden nicht entfernt", () => {
    const d = data([JOB_UNKNOWN], legacy("urlaub"));
    expect(planAbsence(JOB_UNKNOWN, "urlaub", "2026-09-07", "2026-09-13", replace, d)).toEqual({
      removeIds: [],
      created: [],
    });
    const p = planAbsence(JOB_UNKNOWN, "urlaub", "2026-09-09", "2026-09-30", replace, d);
    // 07./08.09. liegen außerhalb des neuen Zeitraums → entfernt; 09.–13.09. unbekannt → bleiben
    expect(p.removeIds.sort()).toEqual(["urlaub-2026-09-07", "urlaub-2026-09-08"]);
    expect(p.created).toEqual([]);
  });

  it("absenceRangeChange liefert echte Tage/Beträge und entfallende Tage im Zeitraum", () => {
    const d = data([JOB_EXTENDED], legacy("urlaub"));
    const plan = planAbsence(JOB_EXTENDED, "urlaub", "2026-09-07", "2026-09-20", replace, d);
    const change = absenceRangeChange(
      d.shifts,
      shiftsAfterPlan(d.shifts, plan),
      d.jobs,
      d.settings,
      plan,
      { from: "2026-09-07", to: "2026-09-20" },
    );
    expect(change).toEqual({
      daysBefore: 7,
      before: 525,
      daysAfter: 10,
      after: 750,
      lostInRange: ["2026-09-12", "2026-09-13"],
    });
  });
});

/**
 * V10-ABS-PLAN-P2-1b (QA): Krank 03.08.–30.09.2026 (Mo–Fr, ein Fall), History-Eintrag ohne
 * Plan-Daten ab 17.08. → vor dem 17.08. Plan unbekannt. Verlängern auf 02.10. darf den Fall
 * NICHT teilen (sonst zweite 42-Tage-Frist: 40 statt 30 bezahlte Tage, 3000 statt 2250 €).
 * Referenz gemessen auf 78ef353 (Zeitraum = ein Fall): 45 Krank-Tage, 1 Fall, 30 bezahlt
 * (letzter 11.09.), 2250 €.
 */
describe("Krank-Zeitraum ersetzen bleibt EIN Krankheitsfall (QA P2-1b)", () => {
  const JOB_QA = {
    ...JOB_PLAIN,
    weekHistory: [{ effectiveFrom: "2026-08-17" }],
  } as unknown as Job;
  const work = eachDay("2026-07-01", "2026-07-31", true).map(
    (date) => ({ id: `w-${date}`, jobId: "j1", kind: "arbeit", date, ...d5 }) as Shift,
  );
  const sick = eachDay("2026-08-03", "2026-09-30", true).map(
    (date) =>
      ({ id: `k-${date}`, jobId: "j1", kind: "krank", date, ...d5, sickCaseId: "old" }) as Shift,
  );
  const REF_78EF353 = {
    sickDays: 45,
    caseIds: ["old"],
    paidDays: 30,
    lastPaid: "2026-09-11",
    eur: 2250,
  };
  const summary = (jobs: Job[], shifts: Shift[], settings: AppData["settings"]) => {
    const res = makeResolver(jobs, settings);
    const k = shifts.filter((s) => s.kind === "krank").sort((a, b) => a.date.localeCompare(b.date));
    const paid = k.filter((s) => shiftPayroll(s, { ...res(s), history: shifts }).paid);
    return {
      sickDays: k.length,
      caseIds: [...new Set(k.map((s) => s.sickCaseId))],
      paidDays: paid.length,
      lastPaid: paid.at(-1)?.date,
      eur: payrollTotals(k, res, shifts).earnings,
    };
  };

  it("Lib: 03.08.–30.09. → 03.08.–02.10.: eine sickCaseId, 30 bezahlte Tage / 2250 € (= 78ef353)", () => {
    const settings = { ...DEFAULT_SETTINGS, bundesland: "BE" };
    const before = [...work, ...sick];
    const d = { ...EMPTY_DATA, jobs: [JOB_QA], shifts: before, settings } as unknown as AppData;
    expect(summary([JOB_QA], before, settings)).toEqual({ ...REF_78EF353, sickDays: 43 });
    const plan = planAbsence(
      JOB_QA,
      "krank",
      "2026-08-03",
      "2026-10-02",
      { jobId: "j1", kind: "krank", from: "2026-08-03", to: "2026-09-30" },
      d,
    );
    // 03.–14.08. (unbekannt) bleiben stehen; 17.08.–02.10. nach Plan neu – alle im Fall "old"
    expect(plan.created.map((s) => s.date)).toEqual(eachDay("2026-08-17", "2026-10-02", true));
    expect(plan.created.every((s) => s.sickCaseId === "old")).toBe(true);
    const after = shiftsAfterPlan(before, plan);
    expect(summary([JOB_QA], after, settings)).toEqual(REF_78EF353);
  });

  it("Dialog (Kalendertage, wie früher nach Plan „alle Tage“ angelegt): Bestätigen speichert EINEN Fall, 30 bezahlte Tage / 2250 € (= 78ef353)", () => {
    // Der Dialog bearbeitet einen kalendarisch zusammenhängenden Block → Altbestand an allen Tagen.
    const sickCal = eachDay("2026-08-03", "2026-09-30").map(
      (date) =>
        ({ id: `k-${date}`, jobId: "j1", kind: "krank", date, ...d5, sickCaseId: "old" }) as Shift,
    );
    seed([JOB_QA], [...work, ...sickCal]);
    const before = snapshot();
    open("k-2026-08-03");
    expect((q("#absence-to") as HTMLInputElement).value).toBe("2026-09-30");
    setValue(q("#absence-to"), "2026-10-02");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).not.toBeNull();
    expect(snapshot()).toBe(before);
    // Abbrechen ändert nichts (auch nach Neuladen)
    click(tid("retro-impact-cancel"));
    expect(snapshot()).toBe(before);
    reload();
    expect(snapshot()).toBe(before);
    expect(saved("krank")).toHaveLength(59);
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).not.toBeNull();
    // ersetzt 17.08.–30.09. (45 Tage) → 17.08.–02.10. Mo–Fr (35 Tage), Entgelt im selben Fall gleich
    expect(rangeRow()?.getAttribute("data-days-before")).toBe("45");
    expect(rangeRow()?.getAttribute("data-before")).toBe("1500.00");
    expect(rangeRow()?.getAttribute("data-days-after")).toBe("35");
    expect(rangeRow()?.getAttribute("data-after")).toBe("1500.00");
    expect(tid("retro-impact-range-lost")?.getAttribute("data-days")?.split(",")).toHaveLength(12);
    click(tid("retro-impact-confirm"));
    const d = getData();
    // 03.–16.08. (Plan unbekannt) bleiben; ab 17.08. nach Plan Mo–Fr bis 02.10.
    expect(saved("krank").map((s) => s.date)).toEqual([
      ...eachDay("2026-08-03", "2026-08-16"),
      ...eachDay("2026-08-17", "2026-10-02", true),
    ]);
    const { sickDays, ...paid } = summary(d.jobs, d.shifts, d.settings);
    expect(sickDays).toBe(49);
    expect(paid).toEqual({ caseIds: ["old"], paidDays: 30, lastPaid: "2026-09-11", eur: 2250 });
    reload();
    expect(new Set(saved("krank").map((s) => s.sickCaseId))).toEqual(new Set(["old"]));
    // Erneut unverändert speichern (03.08.–02.10.): keine Einträge/Beträge verloren
    const afterSave = snapshot();
    act(() => root.unmount());
    root = createRoot(container);
    // Block 03.–21.08. (behaltene unbekannte Tage + 17.–21.08.) unverändert speichern
    open("k-2026-08-03");
    expect((q("#absence-to") as HTMLInputElement).value).toBe("2026-08-21");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).toBeNull();
    expect(snapshot()).toBe(afterSave);
    const again = getData();
    expect(summary(again.jobs, again.shifts, again.settings)).toEqual({
      sickDays: 49,
      caseIds: ["old"],
      paidDays: 30,
      lastPaid: "2026-09-11",
      eur: 2250,
    });
  });

  it("Lib: behaltene Einträge mit abweichender sickCaseId werden in denselben Fall übernommen", () => {
    const mixed = sick.map((s) => (s.date === "2026-08-10" ? { ...s, sickCaseId: "x" } : s));
    const d = {
      ...EMPTY_DATA,
      jobs: [JOB_QA],
      shifts: [...work, ...mixed],
      settings: DEFAULT_SETTINGS,
    } as unknown as AppData;
    const plan = planAbsence(
      JOB_QA,
      "krank",
      "2026-08-03",
      "2026-10-02",
      { jobId: "j1", kind: "krank", from: "2026-08-03", to: "2026-09-30" },
      d,
    );
    const after = shiftsAfterPlan(d.shifts, plan).filter((s) => s.kind === "krank");
    expect(after).toHaveLength(45);
    expect(new Set(after.map((s) => s.sickCaseId))).toEqual(new Set(["old"]));
    expect(after.find((s) => s.date === "2026-08-10")?.id).toBe("k-2026-08-10");
  });
});
