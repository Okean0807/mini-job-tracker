/**
 * V10-LATEBLOCK-CASE (QA V10_LATEBLOCK_QA_R1, Orakel Abschnitt 7; Daten = fixture_A.json):
 * Krank 03.08.–02.10.2026 (Mo–Fr, Fall "old"); der Dialog bearbeitet nur den lückenlosen
 * Block 28.09.–02.10. Vorher (4db2a1c = 78ef353): neuer Fall → zweite 42-Tage-Frist.
 * Regeln (DECISIONS R3, Juri-Default; Juri 22.10.: neuer Zeitraum nie still zuordnen):
 *  (a) bearbeiteter Block des Falls, lückenlose Grenze (dazwischen nur laut gültigem Plan
 *      freie Tage) → bleibt derselbe Fall; ein NEUER Zeitraum neben einem Fall → Hinweis +
 *      Entscheidung (Haken) vor dem Speichern, ohne Haken Rückfrage „neuer Krankheitsfall“;
 *  (b) leerer Arbeitstag / unbekannter Plan an der Grenze → Warnung + Haken (Standard aus);
 *  (c) ≥ 6 leere Tage → nie; (d) gespeicherte Fälle/Einträge ohne sickCaseId unangetastet;
 *  (e) der Dialog zeigt, ob ein neuer Fall beginnt.
 * Echter Render, echter Store, echte Berechnung (kein Spy).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsenceDialog } from "./AbsenceDialog";
import { isoDate } from "@/lib/minijob/calc";
import { payrollTotals, shiftPayroll } from "@/lib/minijob/payroll";
import { makeResolver } from "@/lib/minijob/resolve";
import { planAbsence, shiftsAfterPlan, sickSplitImpact } from "@/lib/minijob/service";
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
const MON_FRI: FixedDay[] = [true, true, true, true, true, false, false].map((active) => ({
  active,
  ...d5,
}));
const JOB_PLAIN = {
  id: "j1",
  name: "Büro",
  color: "#0d9488",
  mode: "fest",
  employmentType: "minijob",
  rate: 15,
  startDate: "2025-01-01",
  week: MON_FRI,
} as unknown as Job;
/** History-Eintrag ohne Plan-Daten ab 17.08. → Plan davor unbekannt (P2-1b-Kontext). */
const JOB_HISTORY = {
  ...JOB_PLAIN,
  weekHistory: [{ effectiveFrom: "2026-08-17" }],
} as unknown as Job;

function eachDay(from: string, to: string, weekdaysOnly = false): string[] {
  const out: string[] = [];
  const d = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");
  for (; d <= end; d.setDate(d.getDate() + 1)) {
    if (!weekdaysOnly || (d.getDay() >= 1 && d.getDay() <= 5)) out.push(isoDate(d));
  }
  return out;
}
const work = eachDay("2026-07-01", "2026-07-31", true).map(
  (date) => ({ id: `w-${date}`, jobId: "j1", kind: "arbeit", date, ...d5 }) as Shift,
);
const sickDay = (date: string, sickCaseId = "old") =>
  ({ id: `k-${date}`, jobId: "j1", kind: "krank", date, ...d5, rate: 15, sickCaseId }) as Shift;
const sick = eachDay("2026-08-03", "2026-10-02", true).map((d) => sickDay(d));
const SETTINGS = { ...DEFAULT_SETTINGS, bundesland: "BE" } as AppData["settings"];
/** Plan bis 28.09. unbekannt (QA-Variante F). */
const JOB_F = { ...JOB_PLAIN, weekHistory: [{ effectiveFrom: "2026-09-28" }] } as unknown as Job;
const LATE = { jobId: "j1", kind: "krank" as const, from: "2026-09-28", to: "2026-10-02" };

/** Erwartung nach Erweitern 28.09.–02.10. → 05.10. (ein Fall). */
const EXPECTED = {
  sickDays: 46,
  caseIds: ["old"],
  paidDays: 30,
  lastPaid: "2026-09-11",
  eur: 2250,
};

function summary(jobs: Job[], shifts: Shift[], settings: AppData["settings"]) {
  const res = makeResolver(jobs, settings);
  const k = shifts.filter((s) => s.kind === "krank").sort((a, b) => a.date.localeCompare(b.date));
  const paid = k.filter((s) => shiftPayroll(s, { ...res(s), history: shifts }).paid);
  return {
    cases: new Set(k.map((s) => s.sickCaseId ?? "-")).size,
    sickDays: k.length,
    paidDays: paid.length,
    lastPaid: paid.at(-1)?.date,
    eur: payrollTotals(k, res, shifts).earnings,
  };
}
const libData = (job: Job, shifts: Shift[]) =>
  ({ ...EMPTY_DATA, jobs: [job], shifts, settings: SETTINGS }) as unknown as AppData;
/** Ergebnis-Tupel wie im QA-Bericht: Fälle / Krank-Tage / bezahlt / letzter bezahlt / €. */
const R = (cases: number, sickDays: number, paidDays: number, lastPaid: string, eur: number) => ({
  cases,
  sickDays,
  paidDays,
  lastPaid,
  eur,
});
const BEFORE = R(1, 45, 30, "2026-09-11", 2250);
const ONE_A = R(1, 46, 30, "2026-09-11", 2250);
function plan(
  job: Job,
  before: Shift[],
  from: string,
  to: string,
  replace: typeof LATE | null = LATE,
  linkCaseId?: string,
) {
  const p = planAbsence(job, "krank", from, to, replace ?? undefined, libData(job, before), {
    linkCaseId,
  });
  const after = shiftsAfterPlan(before, p);
  return { p, after, result: summary([job], after, SETTINGS) };
}
const noticesOf = (job: Job, shifts: Shift[]) => {
  const res = makeResolver([job], SETTINGS);
  return shifts
    .filter((s) => s.kind === "krank")
    .map((s) => shiftPayroll(s, { ...res(s), history: shifts }));
};

let container: HTMLDivElement;
let root: Root;
let closed = 0;
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
      settings: { ...SETTINGS, onboarded: true, localDemoMode: true },
    } as never),
  );
}
const snapshot = () => JSON.stringify(getData().shifts);
const savedSummary = () => {
  const d = getData();
  return summary(d.jobs, d.shifts, d.settings);
};
function Harness({ seedId, defaultFrom }: { seedId?: string; defaultFrom?: string }) {
  const data = useAppData();
  return createElement(AbsenceDialog, {
    open: true,
    onOpenChange: (open: boolean) => {
      if (!open) closed += 1;
    },
    jobs: data.jobs,
    shifts: data.shifts,
    seed: data.shifts.find((s) => s.id === seedId) ?? null,
    defaultKind: "krank",
    ...(defaultFrom ? { defaultFrom } : {}),
  });
}
function open(seedId?: string, defaultFrom?: string) {
  act(() => root.unmount());
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(Harness, {
        ...(seedId ? { seedId } : {}),
        ...(defaultFrom ? { defaultFrom } : {}),
      }),
    ),
  );
}
const caseInfo = () => tid("absence-sick-case");
const linkBox = () => q('[data-testid="absence-sick-link"] input') as HTMLInputElement | null;
/** Speichern; erscheint die Vorher/Nachher-Rückfrage, wird bestätigt. */
function saveConfirm() {
  click(tid("absence-save"));
  if (tid("retro-impact-dialog")) click(tid("retro-impact-confirm"));
}
const rangeRow = () => tid("retro-impact-range-row");

beforeEach(() => {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
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

describe("Lib: QA-Orakel Abschnitt 7 (planAbsence → shiftsAfterPlan → payroll)", () => {
  const before = [...work, ...sick];

  it("A 28.09.–02.10. → 05.10.: 1 Fall „old“ / 46 / 30 / 11.09. / 2250 €; neue Tage alle sick-exceeded, kein sick-case-ambiguous", () => {
    expect(summary([JOB_PLAIN], before, SETTINGS)).toEqual(BEFORE);
    const { p, after, result } = plan(JOB_PLAIN, before, "2026-09-28", "2026-10-05");
    expect(p.removeIds.sort()).toEqual(
      eachDay("2026-09-28", "2026-10-02", true).map((d) => `k-${d}`),
    );
    expect(p.created.map((s) => s.date)).toEqual(eachDay("2026-09-28", "2026-10-05", true));
    expect(p.created.every((s) => s.sickCaseId === "old")).toBe(true);
    expect(p.sickCase).toMatchObject({ mode: "continued", caseId: "old", start: "2026-08-03" });
    expect(p.sickCase?.linkCandidate).toBeUndefined();
    expect(result).toEqual(ONE_A);
    const res = makeResolver([JOB_PLAIN], SETTINGS);
    for (const s of after.filter((x) => x.kind === "krank" && x.date >= "2026-09-28")) {
      expect(shiftPayroll(s, { ...res(s), history: after }).reason).toBe("sick-exceeded");
    }
    expect(noticesOf(JOB_PLAIN, after).some((x) => x.notice === "sick-case-ambiguous")).toBe(false);
  });

  it("A3 Verkürzen → 01.10.: 1 / 44 / 30 / 11.09. / 2250 €", () => {
    expect(plan(JOB_PLAIN, before, "2026-09-28", "2026-10-01").result).toEqual(
      R(1, 44, 30, "2026-09-11", 2250),
    );
  });

  it("B Plan vor 17.08. unbekannt: 1 / 46 / 30 / 11.09. / 2250 €", () => {
    expect(plan(JOB_HISTORY, before, "2026-09-28", "2026-10-05").result).toEqual(ONE_A);
  });

  it("H neuer Zeitraum 05.10.–09.10. ohne Ersetzen: NICHT still zugeordnet; ohne Haken 2 / 50 / 35 / 09.10. / 2625 €, mit Haken 1 / 50 / 30 / 11.09. / 2250 €", () => {
    const off = plan(JOB_PLAIN, before, "2026-10-05", "2026-10-09", null);
    expect(off.p.removeIds).toEqual([]);
    expect(off.p.created.some((s) => s.sickCaseId === "old")).toBe(false);
    expect(off.p.sickCase).toMatchObject({
      mode: "new",
      start: "2026-10-05",
      linkCandidate: { caseId: "old", start: "2026-08-03", boundary: "continuous" },
    });
    expect(off.result).toEqual(R(2, 50, 35, "2026-10-09", 2625));
    const on = plan(JOB_PLAIN, before, "2026-10-05", "2026-10-09", null, "old");
    expect(on.p.sickCase).toMatchObject({ mode: "linked", caseId: "old", start: "2026-08-03" });
    expect(on.result).toEqual(R(1, 50, 30, "2026-09-11", 2250));
  });

  it("C Kalendertage (Block = ganzer Zeitraum): unverändert 1 / 46 / 30 / 11.09. / 2250 € (neuer Fall wie 78ef353)", () => {
    const cal = [...work, ...eachDay("2026-08-03", "2026-10-02").map((d) => sickDay(d))];
    const { p, result } = plan(JOB_PLAIN, cal, "2026-08-03", "2026-10-05", {
      ...LATE,
      from: "2026-08-03",
    });
    expect(p.sickCase?.mode).toBe("new");
    expect(result).toEqual(ONE_A);
  });

  it("A2 Verschieben 29.09.–06.10. (Mo 28.09. leerer Arbeitstag): unklar → ohne Haken 2 / 46 / 36 / 06.10. / 2700 €, mit Haken 1 / 46 / 30 / 2250 €", () => {
    const off = plan(JOB_PLAIN, before, "2026-09-29", "2026-10-06");
    expect(off.p.sickCase).toMatchObject({
      mode: "new",
      start: "2026-09-29",
      linkCandidate: { caseId: "old", start: "2026-08-03" },
    });
    expect(off.result).toEqual(R(2, 46, 36, "2026-10-06", 2700));
    const on = plan(JOB_PLAIN, before, "2026-09-29", "2026-10-06", LATE, "old");
    expect(on.p.sickCase).toMatchObject({ mode: "linked", caseId: "old", start: "2026-08-03" });
    expect(on.result).toEqual(R(1, 46, 30, "2026-09-11", 2250));
  });

  it("E 25.09. leer (Arbeitstag): unklar → ohne Haken 2 / 45 / 36 / 05.10. / 2700 €, mit Haken 1 / 45 / 30 / 2250 €", () => {
    const e = before.filter((s) => s.date !== "2026-09-25");
    const off = plan(JOB_PLAIN, e, "2026-09-28", "2026-10-05");
    expect(off.p.sickCase?.linkCandidate).toEqual({
      caseId: "old",
      start: "2026-08-03",
      boundary: "ambiguous",
    });
    expect(off.result).toEqual(R(2, 45, 36, "2026-10-05", 2700));
    expect(plan(JOB_PLAIN, e, "2026-09-28", "2026-10-05", LATE, "old").result).toEqual(
      R(1, 45, 30, "2026-09-11", 2250),
    );
  });

  it("F Plan vor 28.09. unbekannt (Grenze unbekannt): unklar → ohne Haken 2 / 46 / 21 / 05.10. / 1575 €, mit Haken 1 / 46 / 15 / 21.08. / 1125 €", () => {
    const off = plan(JOB_F, before, "2026-09-28", "2026-10-05");
    expect(off.p.sickCase?.linkCandidate?.caseId).toBe("old");
    expect(off.result).toEqual(R(2, 46, 21, "2026-10-05", 1575));
    expect(plan(JOB_F, before, "2026-09-28", "2026-10-05", LATE, "old").result).toEqual(
      R(1, 46, 15, "2026-08-21", 1125),
    );
  });

  it("G Arbeit 25.09., eigener Fall c2: kein Zusammenführen, kein Angebot (auch ein untergeschobener Haken wirkt nicht): 2 / 45 / 36 / 05.10. / 2700 €", () => {
    const g = [
      ...work,
      ...eachDay("2026-08-03", "2026-09-24", true).map((d) => sickDay(d)),
      { id: "w-2026-09-25", jobId: "j1", kind: "arbeit", date: "2026-09-25", ...d5 } as Shift,
      ...eachDay("2026-09-28", "2026-10-02", true).map((d) => sickDay(d, "c2")),
    ];
    const { p, result } = plan(JOB_PLAIN, g, "2026-09-28", "2026-10-05", LATE, "old");
    expect(p.sickCase?.mode).toBe("new");
    expect(p.sickCase?.linkCandidate).toBeUndefined();
    expect(p.created.some((s) => s.sickCaseId === "old")).toBe(false);
    expect(result).toEqual(R(2, 45, 36, "2026-10-05", 2700));
  });

  it("(a) Nachfolger: neuer Zeitraum 03.–07.08. direkt vor Fall ab 10.08. → nicht still; nur mit Haken derselbe Fall ab 03.08. (1 / 45 / 30 / 11.09. / 2250 €)", () => {
    const later = [...work, ...eachDay("2026-08-10", "2026-10-02", true).map((d) => sickDay(d))];
    expect(summary([JOB_PLAIN], later, SETTINGS)).toEqual(R(1, 40, 30, "2026-09-18", 2250));
    const off = plan(JOB_PLAIN, later, "2026-08-03", "2026-08-07", null);
    expect(off.p.sickCase).toMatchObject({
      mode: "new",
      linkCandidate: { caseId: "old", start: "2026-08-10", boundary: "continuous" },
    });
    expect(off.result.cases).toBe(2);
    const on = plan(JOB_PLAIN, later, "2026-08-03", "2026-08-07", null, "old");
    expect(on.p.sickCase).toMatchObject({ mode: "linked", caseId: "old", start: "2026-08-03" });
    expect(on.result).toEqual(R(1, 45, 30, "2026-09-11", 2250));
  });

  it("Lücke IM Fall durch Verkürzen eines mittleren Blocks: nicht automatisch (Grenze zum Folgeblock unklar)", () => {
    const mid = { ...LATE, from: "2026-09-14", to: "2026-09-18" };
    const { p } = plan(JOB_PLAIN, before, "2026-09-14", "2026-09-16", mid);
    expect(p.sickCase?.mode).toBe("new");
    expect(p.sickCase?.linkCandidate).toMatchObject({ caseId: "old" });
    expect(p.created.some((s) => s.sickCaseId === "old")).toBe(false);
  });

  it("(c) ≥ 6 leere Tage nie automatisch – auch wenn alle laut Plan frei sind (Plan nur montags)", () => {
    const monOnly = {
      ...JOB_PLAIN,
      week: MON_FRI.map((d, i) => ({ ...d, active: i === 0 })),
    } as unknown as Job;
    const mondays = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"].map((d) => sickDay(d));
    const { p } = plan(monOnly, mondays, "2026-10-05", "2026-10-05", null);
    expect(p.created.map((s) => s.date)).toEqual(["2026-10-05"]);
    expect(p.sickCase?.mode).toBe("new");
    expect(p.sickCase?.linkCandidate).toBeUndefined();
    expect(p.created[0]?.sickCaseId).not.toBe("old");
    // Gegenprobe: 12.10. nach Fall bis 02.10. (Mo–Fr) – 9 leere Tage → neuer Fall, kein Angebot
    const gap = plan(JOB_PLAIN, before, "2026-10-12", "2026-10-16", null);
    expect(gap.p.sickCase?.linkCandidate).toBeUndefined();
    expect(gap.result).toEqual(R(2, 50, 35, "2026-10-16", 2625));
  });

  it("(d) Nachbar ohne sickCaseId (Bestand/D1) wird nicht angefasst, kein Angebot", () => {
    const legacy = [...work, ...sick.map(({ sickCaseId: _drop, ...s }) => s as Shift)];
    const { p, after } = plan(JOB_PLAIN, legacy, "2026-10-05", "2026-10-09", null);
    expect(p.sickCase?.mode).toBe("new");
    expect(p.sickCase?.linkCandidate).toBeUndefined();
    const untouched = after.filter((s) => s.kind === "krank" && s.date <= "2026-10-02");
    expect(untouched).toHaveLength(45);
    expect(untouched.every((s) => s.sickCaseId === undefined)).toBe(true);
  });
});

describe("Dialog: Fallanzeige vor dem Speichern, Rückfrage, Haken (echter Store)", () => {
  for (const [name, job] of [
    ["A ohne Plan-Historie", JOB_PLAIN],
    ["B mit unvollständiger Plan-Historie", JOB_HISTORY],
  ] as const) {
    it(`${name}: zeigt „gehört zum Fall ab 03.08.“; Abbrechen ändert nichts; Bestätigen → 1 / 46 / 30 / 2250 €; erneut speichern verlustfrei`, () => {
      seed([job], [...work, ...sick]);
      const before = snapshot();
      open("k-2026-09-28");
      expect((q("#absence-from") as HTMLInputElement).value).toBe("2026-09-28");
      expect((q("#absence-to") as HTMLInputElement).value).toBe("2026-10-02");
      setValue(q("#absence-to"), "2026-10-05");
      expect(caseInfo()?.getAttribute("data-mode")).toBe("continued");
      expect(caseInfo()?.getAttribute("data-start")).toBe("2026-08-03");
      expect(caseInfo()?.textContent).toContain("03.08.2026");
      expect(tid("absence-sick-ambiguous")).toBeNull();
      click(tid("absence-save"));
      expect(tid("retro-impact-dialog")).not.toBeNull();
      expect(snapshot()).toBe(before);
      expect(rangeRow()?.getAttribute("data-days-before")).toBe("5");
      expect(rangeRow()?.getAttribute("data-before")).toBe("0.00");
      expect(rangeRow()?.getAttribute("data-days-after")).toBe("6");
      expect(rangeRow()?.getAttribute("data-after")).toBe("0.00");
      expect(tid("retro-impact-cases")).toBeNull(); // Zahl der Fälle bleibt 1
      click(tid("retro-impact-cancel"));
      expect(snapshot()).toBe(before);
      reload();
      expect(snapshot()).toBe(before);
      expect(savedSummary()).toEqual(BEFORE);

      click(tid("absence-save"));
      click(tid("retro-impact-confirm"));
      expect(savedSummary()).toEqual(ONE_A);
      reload();
      expect(savedSummary()).toEqual(ONE_A);
      expect(
        new Set(
          getData()
            .shifts.filter((s) => s.kind === "krank")
            .map((s) => s.sickCaseId),
        ),
      ).toEqual(new Set(["old"]));

      // erneut unverändert speichern (Block 28.09.–02.10. und Block 05.10.) → keine Änderung
      const afterSave = snapshot();
      open(getData().shifts.find((s) => s.date === "2026-09-28")!.id);
      expect((q("#absence-to") as HTMLInputElement).value).toBe("2026-10-02");
      click(tid("absence-save"));
      expect(tid("retro-impact-dialog")).toBeNull();
      const late = getData().shifts.find((s) => s.date === "2026-10-05")!;
      open(late.id);
      expect((q("#absence-from") as HTMLInputElement).value).toBe("2026-10-05");
      click(tid("absence-save"));
      expect(tid("retro-impact-dialog")).toBeNull();
      expect(snapshot()).toBe(afterSave);
      expect(savedSummary()).toEqual(ONE_A);
    });
  }

  it("H neuer Zeitraum 05.–09.10.: Hinweis + Haken (aus) vor dem Speichern; ohne Haken Rückfrage „1 → 2 Fälle, neuer Fall ab 05.10.“; Abbrechen ändert nichts", () => {
    seed([JOB_PLAIN], [...work, ...sick]);
    const before = snapshot();
    open(undefined, "2026-10-05");
    setValue(q("#absence-to"), "2026-10-09");
    expect(caseInfo()?.getAttribute("data-mode")).toBe("new");
    expect(caseInfo()?.getAttribute("data-start")).toBe("2026-10-05");
    expect(tid("absence-sick-ambiguous")?.getAttribute("data-boundary")).toBe("continuous");
    expect(tid("absence-sick-ambiguous")?.textContent).toContain("03.08.2026");
    expect(tid("absence-sick-ambiguous")?.textContent).toContain("Schließt direkt an");
    expect(tid("absence-sick-ambiguous")?.textContent).not.toContain("Unklare Grenze");
    expect(linkBox()?.checked).toBe(false);
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).not.toBeNull();
    expect(snapshot()).toBe(before);
    expect(tid("retro-impact-cases-row")?.getAttribute("data-before")).toBe("1");
    expect(tid("retro-impact-cases-row")?.getAttribute("data-after")).toBe("2");
    expect(tid("retro-impact-new-case")?.getAttribute("data-start")).toBe("2026-10-05");
    click(tid("retro-impact-cancel"));
    expect(snapshot()).toBe(before);
    reload();
    expect(snapshot()).toBe(before);
    expect(savedSummary()).toEqual(BEFORE);
  });

  it("H ohne Haken bestätigt: getrennter Fall 2 / 50 / 35 / 09.10. / 2625 €", () => {
    seed([JOB_PLAIN], [...work, ...sick]);
    open(undefined, "2026-10-05");
    setValue(q("#absence-to"), "2026-10-09");
    click(tid("absence-save"));
    click(tid("retro-impact-confirm"));
    expect(savedSummary()).toEqual(R(2, 50, 35, "2026-10-09", 2625));
  });

  it("H mit Haken: Anzeige „zugeordnet ab 03.08.“, gespeichert 1 / 50 / 30 / 11.09. / 2250 €", () => {
    seed([JOB_PLAIN], [...work, ...sick]);
    open(undefined, "2026-10-05");
    setValue(q("#absence-to"), "2026-10-09");
    click(linkBox());
    expect(caseInfo()?.getAttribute("data-mode")).toBe("linked");
    expect(caseInfo()?.getAttribute("data-start")).toBe("2026-08-03");
    saveConfirm();
    expect(savedSummary()).toEqual(R(1, 50, 30, "2026-09-11", 2250));
  });

  it("A3 Verkürzen auf 01.10. im Dialog: Gesamt bleibt 2250 € (1 / 44 / 30 / 11.09.), Rückfrage zeigt 5 → 4 Tage", () => {
    seed([JOB_PLAIN], [...work, ...sick]);
    open("k-2026-09-28");
    setValue(q("#absence-to"), "2026-10-01");
    expect(caseInfo()?.getAttribute("data-mode")).toBe("continued");
    click(tid("absence-save"));
    expect(rangeRow()?.getAttribute("data-days-before")).toBe("5");
    expect(rangeRow()?.getAttribute("data-days-after")).toBe("4");
    expect(rangeRow()?.getAttribute("data-after")).toBe("0.00");
    expect(tid("retro-impact-cases")).toBeNull();
    click(tid("retro-impact-confirm"));
    expect(savedSummary()).toEqual(R(1, 44, 30, "2026-09-11", 2250));
  });

  it("A2 unklar: Warnung + Haken (aus) VOR dem Speichern; ohne Haken neuer Fall (2 / 46 / 36 / 2700 €), Abbrechen ändert nichts", () => {
    seed([JOB_PLAIN], [...work, ...sick]);
    const before = snapshot();
    open("k-2026-09-28");
    setValue(q("#absence-from"), "2026-09-29");
    setValue(q("#absence-to"), "2026-10-06");
    expect(tid("absence-sick-ambiguous")).not.toBeNull();
    expect(tid("absence-sick-link")?.getAttribute("data-case-start")).toBe("2026-08-03");
    expect(tid("absence-sick-ambiguous")?.getAttribute("data-boundary")).toBe("ambiguous");
    expect(tid("absence-sick-ambiguous")?.textContent).toContain("Unklare Grenze");
    expect(linkBox()?.checked).toBe(false);
    expect(caseInfo()?.getAttribute("data-mode")).toBe("new");
    expect(caseInfo()?.getAttribute("data-start")).toBe("2026-09-29");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).not.toBeNull();
    expect(tid("retro-impact-cases-row")?.getAttribute("data-after")).toBe("2");
    expect(tid("retro-impact-new-case")?.getAttribute("data-start")).toBe("2026-09-29");
    click(tid("retro-impact-cancel"));
    expect(snapshot()).toBe(before);
    saveConfirm();
    expect(savedSummary()).toEqual(R(2, 46, 36, "2026-10-06", 2700));
  });

  it("A2 mit Haken: Anzeige „zugeordnet“, gespeichert 1 / 46 / 30 / 11.09. / 2250 €", () => {
    seed([JOB_PLAIN], [...work, ...sick]);
    open("k-2026-09-28");
    setValue(q("#absence-from"), "2026-09-29");
    setValue(q("#absence-to"), "2026-10-06");
    click(linkBox());
    expect(linkBox()?.checked).toBe(true);
    expect(caseInfo()?.getAttribute("data-mode")).toBe("linked");
    expect(caseInfo()?.getAttribute("data-start")).toBe("2026-08-03");
    saveConfirm();
    expect(savedSummary()).toEqual(R(1, 46, 30, "2026-09-11", 2250));
  });

  it("F (Plan an der Grenze unbekannt) mit Haken: 1 / 46 / 15 / 21.08. / 1125 €", () => {
    seed([JOB_F], [...work, ...sick]);
    open("k-2026-09-28");
    setValue(q("#absence-to"), "2026-10-05");
    expect(tid("absence-sick-ambiguous")).not.toBeNull();
    click(linkBox());
    saveConfirm();
    expect(savedSummary()).toEqual(R(1, 46, 15, "2026-08-21", 1125));
  });

  it("G (Arbeit 25.09.): kein Haken, Anzeige „neuer Fall ab 28.09.“", () => {
    const g = [
      ...work,
      ...eachDay("2026-08-03", "2026-09-24", true).map((d) => sickDay(d)),
      { id: "w-2026-09-25", jobId: "j1", kind: "arbeit", date: "2026-09-25", ...d5 } as Shift,
      ...eachDay("2026-09-28", "2026-10-02", true).map((d) => sickDay(d, "c2")),
    ];
    seed([JOB_PLAIN], g);
    open("k-2026-09-28");
    setValue(q("#absence-to"), "2026-10-05");
    expect(tid("absence-sick-link")).toBeNull();
    expect(caseInfo()?.getAttribute("data-mode")).toBe("new");
    expect(caseInfo()?.getAttribute("data-start")).toBe("2026-09-28");
    saveConfirm();
    expect(savedSummary()).toEqual(R(2, 45, 36, "2026-10-05", 2700));
  });
});

/**
 * QA-Delta P2-1 (V10_LATEBLOCK_DELTA_QA_R1, Regel W-1/K-05): Eine Änderung, die IM Fall eine
 * Lücke von ≥ 6 leeren Kalendertagen erzeugt, wird nie still gespeichert und bleibt nie ein
 * Fall (auch nicht per Haken). Die späteren Blöcke bekommen erst im bestätigten Speichern eine
 * neue sickCaseId; Abbrechen ändert nichts.
 */
describe("Lücke ≥ 6 Tage im Fall durch Verkürzen (QA-Delta P2-1)", () => {
  const before = [...work, ...sick];
  const MID = { jobId: "j1", kind: "krank" as const, from: "2026-09-14", to: "2026-09-18" };
  const casesOf = (shifts: Shift[]) => {
    const by = new Map<string, string[]>();
    for (const s of shifts
      .filter((x) => x.kind === "krank")
      .sort((a, b) => a.date.localeCompare(b.date))) {
      by.set(s.sickCaseId ?? "-", [...(by.get(s.sickCaseId ?? "-") ?? []), s.date]);
    }
    return [...by.entries()].map(([id, d]) => ({
      old: id === "old",
      days: d.length,
      from: d[0],
      to: d.at(-1),
    }));
  };
  const M5_CASES = [
    { old: true, days: 31, from: "2026-08-03", to: "2026-09-14" },
    { old: false, days: 10, from: "2026-09-21", to: "2026-10-02" },
  ];

  it("M5 14.–18.09. → 14.09. (Lücke 15.–20.09. = 6 Tage): getrennt, 2 / 41 / 40 / 02.10. / 3000 €; Haken ändert nichts", () => {
    for (const link of [undefined, "old"]) {
      const { p, after, result } = plan(JOB_PLAIN, before, "2026-09-14", "2026-09-14", MID, link);
      expect(p.sickCase?.split).toEqual({ start: "2026-09-21" });
      expect(casesOf(after)).toEqual(M5_CASES);
      expect(result).toEqual(R(2, 41, 40, "2026-10-02", 3000));
    }
  });

  it("M6 14.–18.09. → 18.09. (Lücke 12.–17.09. = 6 Tage): 18.09. gehört zum späteren, eigenen Fall: 2 / 41 / 41 / 02.10. / 3075 €", () => {
    const { p, after, result } = plan(JOB_PLAIN, before, "2026-09-18", "2026-09-18", MID);
    expect(p.sickCase).toMatchObject({ mode: "new", start: "2026-09-18" });
    expect(p.sickCase?.split).toEqual({ start: "2026-09-18" });
    expect(casesOf(after)).toEqual([
      { old: true, days: 30, from: "2026-08-03", to: "2026-09-11" },
      { old: false, days: 11, from: "2026-09-18", to: "2026-10-02" },
    ]);
    expect(result).toEqual(R(2, 41, 41, "2026-10-02", 3075));
  });

  it("Regelgrenze 5 Tage (14.–18.09. → 14.–15.09., Lücke 16.–20.09.): keine Zwangstrennung; ohne Haken wie 3ebd240, mit Haken ein Fall", () => {
    const off = plan(JOB_PLAIN, before, "2026-09-14", "2026-09-15", MID);
    expect(off.p.sickCase?.split).toBeUndefined();
    expect(off.p.sickCase?.linkCandidate?.caseId).toBe("old");
    expect(off.result).toEqual(R(2, 42, 32, "2026-09-15", 2400));
    const on = plan(JOB_PLAIN, before, "2026-09-14", "2026-09-15", MID, "old");
    expect(on.p.sickCase?.split).toBeUndefined();
    expect(on.p.sickCase?.mode).toBe("linked");
    expect(on.result).toEqual(R(1, 42, 30, "2026-09-11", 2250));
  });

  it("Lücke, die schon VORHER bestand, wird nicht angefasst (keine Änderung vergangener Zeiträume)", () => {
    const holey = before.filter((s) => !(s.date >= "2026-09-14" && s.date <= "2026-09-18"));
    expect(summary([JOB_PLAIN], holey, SETTINGS)).toEqual(R(1, 40, 30, "2026-09-11", 2250));
    const late = { ...MID, from: "2026-09-28", to: "2026-10-02" };
    const { p, result } = plan(JOB_PLAIN, holey, "2026-09-28", "2026-10-05", late);
    expect(p.sickCase?.split).toBeUndefined();
    expect(p.sickCase?.mode).toBe("continued");
    expect(result).toEqual(R(1, 41, 30, "2026-09-11", 2250));
  });

  it("Dialog M5: Hinweis vor dem Speichern, Rückfrage „1 → 2 Fälle, neuer Fall ab 21.09.“ mit Tagen/€; Abbrechen + Neuladen ändern nichts; Bestätigen → 2 / 41 / 40 / 3000 €", () => {
    seed([JOB_PLAIN], before);
    const snap = snapshot();
    open("k-2026-09-14");
    expect((q("#absence-to") as HTMLInputElement).value).toBe("2026-09-18");
    setValue(q("#absence-to"), "2026-09-14");
    expect(tid("absence-sick-split")?.getAttribute("data-start")).toBe("2026-09-21");
    expect(tid("absence-sick-split")?.textContent).toContain("21.09.2026");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).not.toBeNull();
    expect(snapshot()).toBe(snap);
    expect(tid("retro-impact-cases-row")?.getAttribute("data-before")).toBe("1");
    expect(tid("retro-impact-cases-row")?.getAttribute("data-after")).toBe("2");
    expect(tid("retro-impact-new-case")?.getAttribute("data-start")).toBe("2026-09-21");
    // betroffen: Block 14.–18.09. (5) + umgeschriebene 21.09.–02.10. (10); vorher alle jenseits 42 Tage
    expect(rangeRow()?.getAttribute("data-days-before")).toBe("15");
    expect(rangeRow()?.getAttribute("data-before")).toBe("0.00");
    expect(rangeRow()?.getAttribute("data-days-after")).toBe("11");
    expect(rangeRow()?.getAttribute("data-after")).toBe("750.00");
    click(tid("retro-impact-cancel"));
    expect(snapshot()).toBe(snap);
    reload();
    expect(snapshot()).toBe(snap);
    expect(savedSummary()).toEqual(BEFORE);
    click(tid("absence-save"));
    click(tid("retro-impact-confirm"));
    expect(savedSummary()).toEqual(R(2, 41, 40, "2026-10-02", 3000));
    expect(casesOf(getData().shifts)).toEqual(M5_CASES);
    reload();
    expect(savedSummary()).toEqual(R(2, 41, 40, "2026-10-02", 3000));
  });

  it("Dialog: auch MIT Haken bleibt es bei 6-Tage-Lücke kein Fall (11.09. leer, 14.–18.09. → 14.09.): Rückfrage 1 → 2, 2 / 40 / 39 / 2925 €", () => {
    seed(
      [JOB_PLAIN],
      before.filter((s) => s.date !== "2026-09-11"),
    );
    open("k-2026-09-14");
    setValue(q("#absence-to"), "2026-09-14");
    expect(tid("absence-sick-ambiguous")?.getAttribute("data-boundary")).toBe("ambiguous");
    click(linkBox());
    expect(caseInfo()?.getAttribute("data-mode")).toBe("linked");
    expect(tid("absence-sick-split")?.getAttribute("data-start")).toBe("2026-09-21");
    click(tid("absence-save"));
    expect(tid("retro-impact-cases-row")?.getAttribute("data-after")).toBe("2");
    click(tid("retro-impact-confirm"));
    expect(savedSummary()).toEqual(R(2, 40, 39, "2026-10-02", 2925));
  });
});

/**
 * t653u (QA R2b P2-R2b-1, Regel W-1/K-05): unklare linke Grenze (11.09. leer) + neue Lücke
 * 15.–20.09. (6 leere Kalendertage) rechts vom bearbeiteten Block. Die späteren Blöcke ab 21.09.
 * bleiben weder ohne noch mit Haken still im alten Fall: Sie werden – wie bei jeder neuen
 * 6-Tage-Lücke (4c76a20) – ein eigener Fall. Ohne Haken ist 14.09. ein neuer Fall (Regel (b)),
 * mit Haken gehört 14.09. zum Fall ab 03.08. (Regel H bleibt: Zuordnung nur per Haken).
 * Echte Berechnung, echter Store, keine Spies.
 */
describe("t653u: unklare Grenze + neue Lücke ≥ 6 Tage → spätere Blöcke nie still im alten Fall", () => {
  const before = [...work, ...sick].filter((s) => s.date !== "2026-09-11");
  const MID = { jobId: "j1", kind: "krank" as const, from: "2026-09-14", to: "2026-09-18" };
  /** Fälle nach Datum: id "old" bleibt "old", jede andere id als "neu ab <Beginn>". */
  const casesOf = (shifts: Shift[]) => {
    const by = new Map<string, string[]>();
    for (const s of shifts
      .filter((x) => x.kind === "krank")
      .sort((a, b) => a.date.localeCompare(b.date))) {
      by.set(s.sickCaseId ?? "-", [...(by.get(s.sickCaseId ?? "-") ?? []), s.date]);
    }
    return [...by.entries()].map(([id, d]) => ({
      case: id === "old" ? "old" : id === "-" ? "-" : `neu ab ${d[0]}`,
      days: d.length,
      from: d[0],
      to: d.at(-1),
    }));
  };
  const BEFORE_P2 = R(1, 44, 29, "2026-09-10", 2175);
  const OFF_CASES = [
    { case: "old", days: 29, from: "2026-08-03", to: "2026-09-10" },
    { case: "neu ab 2026-09-14", days: 1, from: "2026-09-14", to: "2026-09-14" },
    { case: "neu ab 2026-09-21", days: 10, from: "2026-09-21", to: "2026-10-02" },
  ];
  const ON_CASES = [
    { case: "old", days: 30, from: "2026-08-03", to: "2026-09-14" },
    { case: "neu ab 2026-09-21", days: 10, from: "2026-09-21", to: "2026-10-02" },
  ];

  it("Ausgangslage: 1 Fall / 44 / 29 / 10.09. / 2175 €", () => {
    expect(summary([JOB_PLAIN], before, SETTINGS)).toEqual(BEFORE_P2);
  });

  it("OHNE Haken: 14.09. neuer Fall, 21.09.–02.10. eigener Fall (nicht mehr still „old“): 3 / 40 / 40 / 02.10. / 3000 €", () => {
    const { p, after, result } = plan(JOB_PLAIN, before, "2026-09-14", "2026-09-14", MID);
    expect(p.sickCase).toMatchObject({
      mode: "new",
      start: "2026-09-14",
      split: { start: "2026-09-21" },
      linkCandidate: { caseId: "old", start: "2026-08-03", boundary: "ambiguous" },
    });
    expect(casesOf(after)).toEqual(OFF_CASES);
    // 14.09. und der abgetrennte Teil sind verschiedene Fälle (dazwischen 6 leere Tage)
    const id14 = after.find((s) => s.date === "2026-09-14")!.sickCaseId;
    const id21 = after.find((s) => s.date === "2026-09-21")!.sickCaseId;
    expect(id14).not.toBe("old");
    expect(id21).not.toBe("old");
    expect(id21).not.toBe(id14);
    expect(after.filter((s) => s.sickCaseId === id21).map((s) => s.date)).toEqual(
      eachDay("2026-09-21", "2026-10-02", true),
    );
    expect(result).toEqual(R(3, 40, 40, "2026-10-02", 3000));
  });

  it("MIT Haken (unverändert): 14.09. zum Fall ab 03.08., 21.09.–02.10. eigener Fall: 2 / 40 / 39 / 02.10. / 2925 €", () => {
    const { p, after, result } = plan(JOB_PLAIN, before, "2026-09-14", "2026-09-14", MID, "old");
    expect(p.sickCase).toMatchObject({
      mode: "linked",
      caseId: "old",
      split: { start: "2026-09-21" },
    });
    expect(casesOf(after)).toEqual(ON_CASES);
    expect(result).toEqual(R(2, 40, 39, "2026-10-02", 2925));
  });

  it("Vorher/Nachher für die Rückfrage (sickSplitImpact): Fälle / Tage / bezahlt / € und Block → Fall", () => {
    const off = plan(JOB_PLAIN, before, "2026-09-14", "2026-09-14", MID);
    const offImpact = sickSplitImpact("j1", before, off.after, [JOB_PLAIN], SETTINGS);
    expect(offImpact.before).toEqual({ cases: 1, days: 44, paidDays: 29, eur: 2175 });
    expect(offImpact.after).toEqual({ cases: 3, days: 40, paidDays: 40, eur: 3000 });
    expect(offImpact.moves).toEqual([
      {
        from: "2026-09-14",
        to: "2026-09-14",
        days: 1,
        fromCaseStart: "2026-08-03",
        toCaseStart: "2026-09-14",
        toCaseNew: true,
      },
      {
        from: "2026-09-21",
        to: "2026-10-02",
        days: 10,
        fromCaseStart: "2026-08-03",
        toCaseStart: "2026-09-21",
        toCaseNew: true,
      },
    ]);
    const on = plan(JOB_PLAIN, before, "2026-09-14", "2026-09-14", MID, "old");
    const onImpact = sickSplitImpact("j1", before, on.after, [JOB_PLAIN], SETTINGS);
    expect(onImpact.after).toEqual({ cases: 2, days: 40, paidDays: 39, eur: 2925 });
    expect(onImpact.moves).toEqual([
      {
        from: "2026-09-21",
        to: "2026-10-02",
        days: 10,
        fromCaseStart: "2026-08-03",
        toCaseStart: "2026-09-21",
        toCaseNew: true,
      },
    ]);
  });

  it("Arbeit am 17.09. in der Lücke: keine Trennung (Lauf 15.–16. / 18.–20.), wie bisher 2 / 40 / 30 / 14.09. / 2250 €", () => {
    const withWork = [
      ...before,
      { id: "w-2026-09-17", jobId: "j1", kind: "arbeit", date: "2026-09-17", ...d5 } as Shift,
    ];
    const { p, after, result } = plan(JOB_PLAIN, withWork, "2026-09-14", "2026-09-14", MID);
    expect(p.sickCase?.split).toBeUndefined();
    expect(after.find((s) => s.date === "2026-09-21")?.sickCaseId).toBe("old");
    expect(result).toEqual(R(2, 40, 30, "2026-09-14", 2250));
  });

  it("Bestehender Krank-Tag eines ANDEREN Falls (21.09., nicht aus dieser Änderung) schließt die Lücke wie bisher: keine Trennung, 22.09.–02.10. bleibt „old“", () => {
    const base = [...work, ...sick]
      .filter((s) => s.date !== "2026-09-21")
      .concat([sickDay("2026-09-21", "x")]);
    const { p, after } = plan(JOB_PLAIN, base, "2026-09-14", "2026-09-14", MID);
    expect(p.sickCase?.split).toBeUndefined();
    expect(after.find((s) => s.date === "2026-09-14")?.sickCaseId).toBe("old");
    expect(after.find((s) => s.date === "2026-09-21")?.sickCaseId).toBe("x");
    expect(
      after.filter((s) => s.kind === "krank" && s.date >= "2026-09-22").map((s) => s.sickCaseId),
    ).toEqual(Array(9).fill("old"));
  });

  it("Grenze 5 Tage (14.–18.09. → 14.–15.09., Lücke 16.–20.09.), 11.09. leer: keine Trennung", () => {
    const { p, after } = plan(JOB_PLAIN, before, "2026-09-14", "2026-09-15", MID);
    expect(p.sickCase?.split).toBeUndefined();
    expect(after.find((s) => s.date === "2026-09-21")?.sickCaseId).toBe("old");
  });

  it("Regression: neuer Fall MITTEN im Fall ohne leere 6 Tage (A2/„mittlerer Block“) wird nicht getrennt", () => {
    const mid = { ...LATE, from: "2026-09-14", to: "2026-09-18" };
    const { p, after } = plan(JOB_PLAIN, [...work, ...sick], "2026-09-14", "2026-09-16", mid);
    expect(p.sickCase?.split).toBeUndefined();
    expect(after.find((s) => s.date === "2026-09-21")?.sickCaseId).toBe("old");
  });

  it("Dialog OHNE Haken: Hinweis vor dem Speichern; Rückfrage 1 → 3 mit Vorher/Nachher (Fälle/Tage/bezahlt/€) und Block → Fall; Abbrechen + Neuladen ändern nichts; Bestätigen → 3 / 40 / 40 / 3000 €", () => {
    seed([JOB_PLAIN], before);
    const snap = snapshot();
    open("k-2026-09-14");
    setValue(q("#absence-to"), "2026-09-14");
    expect(tid("absence-sick-ambiguous")?.getAttribute("data-boundary")).toBe("ambiguous");
    expect(linkBox()?.checked).toBe(false);
    expect(caseInfo()?.getAttribute("data-mode")).toBe("new");
    expect(caseInfo()?.getAttribute("data-start")).toBe("2026-09-14");
    expect(tid("absence-sick-split")?.getAttribute("data-start")).toBe("2026-09-21");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).not.toBeNull();
    expect(snapshot()).toBe(snap);
    expect(tid("retro-impact-cases-row")?.getAttribute("data-before")).toBe("1");
    expect(tid("retro-impact-cases-row")?.getAttribute("data-after")).toBe("3");
    expect(tid("retro-impact-new-case")?.getAttribute("data-start")).toBe("2026-09-21");
    const totals = tid("retro-impact-split-totals");
    expect(totals?.getAttribute("data-before")).toBe("1/44/29/2175.00");
    expect(totals?.getAttribute("data-after")).toBe("3/40/40/3000.00");
    expect(totals?.textContent).toContain("Krankheitsfälle 1 → 3");
    expect(totals?.textContent).toContain("Krankheitstage 44 → 40");
    expect(totals?.textContent).toContain("bezahlt 29 → 40 Tage");
    const moves = [...document.querySelectorAll('[data-testid="retro-impact-split-move"]')];
    expect(
      moves.map((m) => [
        m.getAttribute("data-from"),
        m.getAttribute("data-to"),
        m.getAttribute("data-days"),
        m.getAttribute("data-from-case"),
        m.getAttribute("data-to-case"),
        m.getAttribute("data-to-new"),
      ]),
    ).toEqual([
      ["2026-09-14", "2026-09-14", "1", "2026-08-03", "2026-09-14", "1"],
      ["2026-09-21", "2026-10-02", "10", "2026-08-03", "2026-09-21", "1"],
    ]);
    expect(moves[1]?.textContent).toBe(
      "21.09.–02.10. (10 Tage): Fall ab 03.08. → neuer Fall ab 21.09.",
    );
    click(tid("retro-impact-cancel"));
    expect(tid("retro-impact-split")).toBeNull();
    expect(snapshot()).toBe(snap);
    reload();
    expect(snapshot()).toBe(snap);
    expect(savedSummary()).toEqual(BEFORE_P2);
    click(tid("absence-save"));
    click(tid("retro-impact-confirm"));
    expect(savedSummary()).toEqual(R(3, 40, 40, "2026-10-02", 3000));
    expect(casesOf(getData().shifts)).toEqual(OFF_CASES);
    reload();
    expect(savedSummary()).toEqual(R(3, 40, 40, "2026-10-02", 3000));
    expect(casesOf(getData().shifts)).toEqual(OFF_CASES);
  });

  it("Dialog MIT Haken: Rückfrage 1 → 2, Vorher/Nachher 1/44/29/2175 → 2/40/39/2925, nur 21.09.–02.10. wechselt; Abbrechen ändert nichts; Bestätigen → 2 / 40 / 39 / 2925 €", () => {
    seed([JOB_PLAIN], before);
    const snap = snapshot();
    open("k-2026-09-14");
    setValue(q("#absence-to"), "2026-09-14");
    click(linkBox());
    expect(caseInfo()?.getAttribute("data-mode")).toBe("linked");
    expect(tid("absence-sick-split")?.getAttribute("data-start")).toBe("2026-09-21");
    click(tid("absence-save"));
    expect(tid("retro-impact-cases-row")?.getAttribute("data-after")).toBe("2");
    expect(tid("retro-impact-split-totals")?.getAttribute("data-before")).toBe("1/44/29/2175.00");
    expect(tid("retro-impact-split-totals")?.getAttribute("data-after")).toBe("2/40/39/2925.00");
    const moves = [...document.querySelectorAll('[data-testid="retro-impact-split-move"]')];
    expect(moves.map((m) => [m.getAttribute("data-from"), m.getAttribute("data-to-case")])).toEqual(
      [["2026-09-21", "2026-09-21"]],
    );
    click(tid("retro-impact-cancel"));
    expect(snapshot()).toBe(snap);
    reload();
    expect(snapshot()).toBe(snap);
    click(tid("absence-save"));
    click(tid("retro-impact-confirm"));
    expect(savedSummary()).toEqual(R(2, 40, 39, "2026-10-02", 2925));
    expect(casesOf(getData().shifts)).toEqual(ON_CASES);
  });

  it("Dialog M5 (11.09. belegt): Rückfrage zeigt jetzt auch Vorher/Nachher 1/45/30/2250 → 2/41/40/3000 und 21.09.–02.10. → neuer Fall", () => {
    seed([JOB_PLAIN], [...work, ...sick]);
    open("k-2026-09-14");
    setValue(q("#absence-to"), "2026-09-14");
    click(tid("absence-save"));
    expect(tid("retro-impact-split-totals")?.getAttribute("data-before")).toBe("1/45/30/2250.00");
    expect(tid("retro-impact-split-totals")?.getAttribute("data-after")).toBe("2/41/40/3000.00");
    const moves = [...document.querySelectorAll('[data-testid="retro-impact-split-move"]')];
    expect(moves.map((m) => [m.getAttribute("data-from"), m.getAttribute("data-to")])).toEqual([
      ["2026-09-21", "2026-10-02"],
    ]);
  });

  it("Ohne Trennung (A, H) keine Trennungs-Box in der Rückfrage", () => {
    seed([JOB_PLAIN], [...work, ...sick]);
    open("k-2026-09-28");
    setValue(q("#absence-to"), "2026-10-05");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).not.toBeNull();
    expect(tid("retro-impact-split")).toBeNull();
    click(tid("retro-impact-cancel"));
    open(undefined, "2026-10-05");
    setValue(q("#absence-to"), "2026-10-09");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).not.toBeNull();
    expect(tid("retro-impact-split")).toBeNull();
  });
});
