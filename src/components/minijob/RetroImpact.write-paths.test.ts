/**
 * V10-P2-1 (QA Review R1 zu 145230f/4e4b64c): Verhaltenstests für die
 * datenschreibenden D3-Pfade, die bisher nur auf Lib-Ebene bzw. gar nicht
 * abgedeckt waren:
 *  - ShiftDialog SPEICHERN (Anlegen + Bearbeiten) mit rückwirkender Auswirkung (R6);
 *  - AbsenceDialog ANLEGEN mit rückwirkender Auswirkung (R8);
 *  - AbsenceDialog BEARBEITEN eines Zeitraums: alter Zeitraum wird ersetzt,
 *    keine Duplikate, gleiche Daten → identischer Bestand (R9, R14).
 * Echter Render + echter Store (Testmodus); Abbrechen speichert nichts.
 *
 * Fixture für die Auswirkung: Wochenplan bis 31.12.2026 Mo–Fr (weekHistory),
 * ab 2027 alle Tage. Eine unverknüpfte Krankheitskette Mo–Fr 02.11.–31.12.2026
 * überbrückt die (damals planfreien) Wochenenden; Dezember ist per O-2
 * bestätigt. Ein Eintrag am Wochenende 21./22.11. beendet die Kette → die
 * Bestätigung für 2026-12 verliert ihre Gültigkeit und die Dezember-Beträge
 * ändern sich. Genau das muss VOR dem Speichern gezeigt werden.
 * SICK_AUTO_CONTINUOUS_ENABLED bleibt aus (nicht berührt).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbsenceDialog } from "./AbsenceDialog";
import { ShiftDialog } from "./ShiftDialog";
import { isoDate } from "@/lib/minijob/calc";
import { retroImpact, type RetroImpact } from "@/lib/minijob/retro-impact";
import { planAbsence } from "@/lib/minijob/service";
import { withSickConfirmations } from "@/lib/minijob/sick-confirmation";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
  useAppData,
} from "@/lib/minijob/store";
import { DEFAULT_SETTINGS, type AppData, type Job, type Shift } from "@/lib/minijob/types";

// Durchreichender Spy: alle Tests nutzen die echte Berechnung; nur der
// AbsenceDialog-Anlege-Test (R8) setzt gezielt eine Auswirkung ein (siehe dort).
vi.mock("@/lib/minijob/retro-impact", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/minijob/retro-impact")>();
  return { ...actual, retroImpact: vi.fn(actual.retroImpact) };
});

const { retroImpact: realRetroImpact } = await vi.importActual<
  typeof import("@/lib/minijob/retro-impact")
>("@/lib/minijob/retro-impact");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const day = { start: "09:00", end: "14:00", breakMinutes: 0 };
const MON_FRI = [true, true, true, true, true, false, false].map((active) => ({ active, ...day }));
const ALL_DAYS = Array.from({ length: 7 }, () => ({ active: true, ...day }));

/** Plan bis 31.12.2026 Mo–Fr, ab 01.01.2027 alle Tage. */
const JOB_PLAN_CHANGE = {
  id: "j1",
  name: "Büro",
  color: "#0d9488",
  mode: "fest",
  employmentType: "minijob",
  rate: 15,
  startDate: "2025-01-01",
  week: ALL_DAYS,
  weekHistory: [{ effectiveFrom: "2027-01-01", week: MON_FRI }],
} as unknown as Job;

/** Einfacher Mo–Fr-Job für die Zeitraum-Bearbeitung (ohne Rückwirkung). */
const JOB_SIMPLE = {
  id: "j2",
  name: "Laden",
  color: "#2563eb",
  mode: "fest",
  employmentType: "minijob",
  rate: 15,
  startDate: "2025-01-01",
  week: MON_FRI,
} as unknown as Job;

function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");
  for (; d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() >= 1 && d.getDay() <= 5) out.push(isoDate(d));
  }
  return out;
}

const LEGACY_CHAIN: Shift[] = weekdays("2026-11-02", "2026-12-31").map(
  (date) => ({ id: `k-${date}`, jobId: "j1", kind: "krank", date, ...day }) as Shift,
);
/** Bestehender Eintrag außerhalb der Kette (Samstag 2027, Plan aktiv). */
const LATER_WORK = {
  id: "w-2027-01-09",
  jobId: "j1",
  kind: "arbeit",
  date: "2027-01-09",
  ...day,
} as Shift;
const CONF = withSickConfirmations(undefined, ["2026-12"], LEGACY_CHAIN, [JOB_PLAN_CHANGE]);

const VACATION: Shift[] = weekdays("2026-08-03", "2026-08-07").map(
  (date) => ({ id: `u-${date}`, jobId: "j2", kind: "urlaub", date, ...day }) as Shift,
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
function setValue(el: HTMLInputElement | null, value: string) {
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
function seedStore(jobs: Job[], shifts: Shift[], confirmations = CONF) {
  act(() =>
    replaceAll({
      ...EMPTY_DATA,
      jobs,
      shifts,
      settings: {
        ...DEFAULT_SETTINGS,
        onboarded: true,
        localDemoMode: true,
        sickContinuousConfirmations: confirmations,
      },
    } as never),
  );
}
const retroMonths = () =>
  [...document.querySelectorAll('[data-testid="retro-impact-row"]')].map((r) =>
    r.getAttribute("data-month"),
  );
const snapshot = () => JSON.stringify({ shifts: getData().shifts, settings: getData().settings });
const datesOf = (jobId: string, kind: Shift["kind"]) =>
  getData()
    .shifts.filter((s) => s.jobId === jobId && s.kind === kind)
    .map((s) => s.date)
    .sort();

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
  // nicht verbrauchte eingesetzte Auswirkungen dürfen nicht in andere Tests wandern
  vi.mocked(retroImpact).mockReset();
  vi.mocked(retroImpact).mockImplementation(realRetroImpact);
  act(() => root.unmount());
  container.remove();
});

function ShiftHarness({ shiftId, date }: { shiftId: string | null; date: string }) {
  const data = useAppData();
  return createElement(ShiftDialog, {
    open: true,
    onOpenChange: (open: boolean) => {
      if (!open) closed += 1;
    },
    date,
    shift: shiftId ? (data.shifts.find((s) => s.id === shiftId) ?? null) : null,
    shiftId,
    jobs: data.jobs,
    customers: data.customers,
    projects: data.projects,
    settings: data.settings,
    objects: data.objects,
    history: data.shifts,
  });
}

function AbsenceHarness({ seedId, defaultFrom }: { seedId?: string; defaultFrom?: string }) {
  const data = useAppData();
  return createElement(AbsenceDialog, {
    open: true,
    onOpenChange: (open: boolean) => {
      if (!open) closed += 1;
    },
    jobs: data.jobs,
    shifts: data.shifts,
    seed: seedId ? (data.shifts.find((s) => s.id === seedId) ?? null) : null,
    ...(defaultFrom ? { defaultFrom } : {}),
    defaultKind: "urlaub",
  });
}

describe("Fixture-Selbstprüfung", () => {
  it("O-2-Bestätigung liegt genau für 2026-12 vor", () => {
    expect(CONF.map((c) => c.month)).toEqual(["2026-12"]);
  });
});

describe("ShiftDialog: rückwirkendes SPEICHERN (R6)", () => {
  it("Anlegen am 21.11. → Vorher/Nachher; Abbrechen speichert nichts (auch nach Neuladen); Bestätigen speichert", () => {
    seedStore([JOB_PLAN_CHANGE], [...LEGACY_CHAIN, LATER_WORK]);
    const before = snapshot();
    act(() => root.render(createElement(ShiftHarness, { shiftId: null, date: "2026-11-21" })));
    click(tid("entry-save"));

    expect(tid("retro-impact-dialog")).not.toBeNull();
    expect(retroMonths()).toEqual(["2026-12"]);
    expect(tid("retro-impact-lapsed")).not.toBeNull();
    expect(snapshot()).toBe(before); // vor Bestätigung nichts geschrieben

    click(tid("retro-impact-cancel"));
    expect(tid("retro-impact-dialog")).toBeNull();
    expect(snapshot()).toBe(before);
    expect(closed).toBe(0);
    reload();
    expect(snapshot()).toBe(before);

    click(tid("entry-save"));
    click(tid("retro-impact-confirm"));
    const added = getData().shifts.filter((s) => s.date === "2026-11-21");
    expect(added).toHaveLength(1);
    expect(getData().shifts).toHaveLength(LEGACY_CHAIN.length + 2);
    expect(closed).toBe(1);
  });

  it("Bearbeiten (Datum 09.01.2027 → 21.11.2026) → Vorher/Nachher; Abbrechen ändert nichts; Bestätigen verschiebt", () => {
    seedStore([JOB_PLAN_CHANGE], [...LEGACY_CHAIN, LATER_WORK]);
    const before = snapshot();
    act(() =>
      root.render(createElement(ShiftHarness, { shiftId: LATER_WORK.id, date: LATER_WORK.date })),
    );
    setValue(q("#eintrag-datum") as HTMLInputElement, "2026-11-21");
    click(tid("entry-save"));

    expect(tid("retro-impact-dialog")).not.toBeNull();
    expect(retroMonths()).toEqual(["2026-12"]);
    expect(snapshot()).toBe(before);
    click(tid("retro-impact-cancel"));
    expect(snapshot()).toBe(before);
    expect(getData().shifts.find((s) => s.id === LATER_WORK.id)?.date).toBe("2027-01-09");
    expect(closed).toBe(0);

    click(tid("entry-save"));
    click(tid("retro-impact-confirm"));
    const moved = getData().shifts.filter((s) => s.id === LATER_WORK.id);
    expect(moved.map((s) => s.date)).toEqual(["2026-11-21"]);
    expect(getData().shifts).toHaveLength(LEGACY_CHAIN.length + 1);
    expect(closed).toBe(1);
  });

  it("Kontrolle: Speichern ohne Auswirkung auf andere Einträge → ohne Rückfrage", () => {
    seedStore([JOB_PLAN_CHANGE], [...LEGACY_CHAIN, LATER_WORK]);
    act(() => root.render(createElement(ShiftHarness, { shiftId: null, date: "2027-01-16" })));
    click(tid("entry-save"));
    expect(tid("retro-impact-dialog")).toBeNull();
    expect(getData().shifts.filter((s) => s.date === "2027-01-16")).toHaveLength(1);
    expect(closed).toBe(1);
  });
});

describe("AbsenceDialog: rückwirkendes ANLEGEN (R8)", () => {
  /*
   * Fixture-Änderung (V10-ABSENCE-HISTORICAL-SCHEDULE): Früher legte der Dialog
   * Urlaub am 21./22.11. an, obwohl das Wochenende laut damals gültigem Plan frei
   * war (Fehler: aktueller statt historischer Plan) – nur dadurch entstand die
   * Rückwirkung. Mit korrektem Plan wird dort nichts angelegt (Test unten).
   * Ein Anlegen ohne Entfernen kann mit gültigem Plan keine Kette beenden
   * (Abwesenheiten nur an Plan-Arbeitstagen; ein leerer Plan-Arbeitstag beendet
   * die Kette ohnehin; Krank-Zeiträume tragen eine eigene sickCaseId). Daher wird
   * die Auswirkung hier gezielt eingesetzt; geprüft wird, dass der Anlege-Pfad
   * die Vorschau mit dem echten Plan berechnet, vor Bestätigung nichts schreibt,
   * bei Abbrechen nichts ändert und erst nach Bestätigung speichert.
   */
  const INJECTED: RetroImpact = {
    months: [{ month: "2026-12", before: 675, after: 1725 }],
    lapsedMonths: ["2026-12"],
  };
  const inject = () =>
    vi.mocked(retroImpact).mockImplementationOnce((before, after, jobs, settings, ids) => {
      // Echte Eingaben des Dialogs: Nachher = Vorher + genau die 2 neuen Tage.
      const created = after.filter((s) => !before.some((b) => b.id === s.id));
      expect(created.map((s) => s.date)).toEqual(["2027-01-11", "2027-01-12"]);
      expect(after).toHaveLength(before.length + 2);
      expect(before.every((b) => after.some((a) => a.id === b.id))).toBe(true);
      expect([...ids].sort()).toEqual(created.map((s) => s.id).sort());
      // ECHTE Berechnung auf genau diesen Eingaben (QA P3-1): Invariante
      // "Anlegen ohne Entfernen ⇒ keine Auswirkung auf andere Einträge".
      const real = realRetroImpact(before, after, jobs, settings, ids);
      expect(real).toEqual({ months: [], lapsedMonths: [] });
      // Gegenprobe derselben echten Funktion: Löschen des ersten Kettentags wirkt
      // auf Dezember (Kette beginnt später) – echte Werte, vorher ≠ nachher.
      const firstSick = before.find((s) => s.id === "k-2026-11-02")!;
      const removal = realRetroImpact(
        before,
        before.filter((s) => s.id !== firstSick.id),
        jobs,
        settings,
        [firstSick.id],
      );
      expect(removal.months.map((m) => m.month)).toEqual(["2026-12"]);
      expect(removal.months[0]!.after).not.toBeCloseTo(removal.months[0]!.before, 2);
      expect(removal.lapsedMonths).toEqual(["2026-12"]);
      return INJECTED;
    });

  it("Urlaub 11.–12.01.2027 mit Auswirkung → Vorher/Nachher; Abbrechen speichert nichts; Bestätigen legt genau 2 Tage an", () => {
    seedStore([JOB_PLAN_CHANGE], [...LEGACY_CHAIN, LATER_WORK]);
    const before = snapshot();
    act(() => root.render(createElement(AbsenceHarness, { defaultFrom: "2027-01-11" })));
    setValue(q("#absence-from") as HTMLInputElement, "2027-01-11");
    setValue(q("#absence-to") as HTMLInputElement, "2027-01-12");
    inject();
    click(tid("absence-save"));

    expect(tid("retro-impact-dialog")).not.toBeNull();
    expect(retroMonths()).toEqual(["2026-12"]);
    expect(tid("retro-impact-lapsed")).not.toBeNull();
    expect(snapshot()).toBe(before);

    click(tid("retro-impact-cancel"));
    expect(snapshot()).toBe(before);
    expect(closed).toBe(0);
    reload();
    expect(snapshot()).toBe(before);

    inject();
    click(tid("absence-save"));
    click(tid("retro-impact-confirm"));
    expect(datesOf("j1", "urlaub")).toEqual(["2027-01-11", "2027-01-12"]);
    expect(closed).toBe(1);
  });

  it("Urlaub am damals planfreien Wochenende 21.–22.11. → nichts angelegt, keine Rückfrage, Bestand unverändert", () => {
    seedStore([JOB_PLAN_CHANGE], [...LEGACY_CHAIN, LATER_WORK]);
    const before = snapshot();
    act(() => root.render(createElement(AbsenceHarness, { defaultFrom: "2026-11-21" })));
    setValue(q("#absence-from") as HTMLInputElement, "2026-11-21");
    setValue(q("#absence-to") as HTMLInputElement, "2026-11-22");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).toBeNull();
    expect(snapshot()).toBe(before);
    expect(datesOf("j1", "urlaub")).toEqual([]);
  });
});

describe("AbsenceDialog: Zeitraum BEARBEITEN ersetzt den alten (R9, R14)", () => {
  it("gleiche Daten speichern → Bestand inhaltlich unverändert (kein Datenverlust, keine Duplikate)", () => {
    seedStore([JOB_SIMPLE], VACATION, []);
    act(() => root.render(createElement(AbsenceHarness, { seedId: "u-2026-08-03" })));
    expect((q("#absence-from") as HTMLInputElement).value).toBe("2026-08-03");
    expect((q("#absence-to") as HTMLInputElement).value).toBe("2026-08-07");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).toBeNull();
    expect(datesOf("j2", "urlaub")).toEqual(weekdays("2026-08-03", "2026-08-07"));
    expect(getData().shifts).toHaveLength(VACATION.length);
    expect(closed).toBe(1);
    reload();
    expect(datesOf("j2", "urlaub")).toEqual(weekdays("2026-08-03", "2026-08-07"));
  });

  it("verschobener Zeitraum 05.–11.08. → alte Tage weg, neue da, jedes Datum genau einmal", () => {
    seedStore([JOB_SIMPLE], VACATION, []);
    act(() => root.render(createElement(AbsenceHarness, { seedId: "u-2026-08-03" })));
    setValue(q("#absence-from") as HTMLInputElement, "2026-08-05");
    setValue(q("#absence-to") as HTMLInputElement, "2026-08-11");
    click(tid("absence-save"));
    expect(tid("retro-impact-dialog")).toBeNull();
    const dates = datesOf("j2", "urlaub");
    expect(dates).toEqual(weekdays("2026-08-05", "2026-08-11"));
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).not.toContain("2026-08-03");
    expect(dates).not.toContain("2026-08-04");
    expect(closed).toBe(1);
  });

  it("planAbsence (Lib): unverändert ersetzen → kein Eingriff; geänderter Zeitraum ersetzt vollständig", () => {
    const data = { ...EMPTY_DATA, jobs: [JOB_SIMPLE], shifts: VACATION } as unknown as AppData;
    const replace = { jobId: "j2", kind: "urlaub" as const, from: "2026-08-03", to: "2026-08-07" };
    // V10-ABS-PLAN-P2-1: unverändert gespeichert → nichts entfernen, nichts anlegen
    expect(planAbsence(JOB_SIMPLE, "urlaub", "2026-08-03", "2026-08-07", replace, data)).toEqual({
      removeIds: [],
      created: [],
    });
    // überlappend verschoben: alle 5 alten entfernt, 5 neue (04.–07.08. + 10.08.)
    const plan = planAbsence(JOB_SIMPLE, "urlaub", "2026-08-04", "2026-08-10", replace, data);
    expect(plan.removeIds.sort()).toEqual(VACATION.map((s) => s.id).sort());
    expect(plan.created.map((s) => s.date)).toEqual(weekdays("2026-08-04", "2026-08-10"));
  });
});
