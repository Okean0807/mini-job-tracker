/**
 * P2-1: Neue Abwesenheiten im Eintrags-Editor nutzen dieselbe Stundenlogik wie
 * der Zeitraum-Dialog (schedule.ts generateAbsence → absenceDayTimes):
 * Wochenplan-Tag oder 09:00–17:00 ohne Pause – nie die versteckten
 * Editor-Zeiten (Default 09–17 mit 30 min Pause oder vorher eingegebene Zeiten).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ShiftDialog } from "./ShiftDialog";
import { shiftHours } from "@/lib/minijob/calc";
import { shiftPayroll } from "@/lib/minijob/payroll";
import { generateAbsence } from "@/lib/minijob/schedule";
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
  type FixedDay,
  type Job,
  type Shift,
  type ShiftKind,
} from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = "2026-09-24"; // Donnerstag, kein Feiertag (Bundesland-Default)
const PLAN_DAY: FixedDay = { active: true, start: "07:00", end: "13:30", breakMinutes: 30 }; // 6 h
const WEEK: FixedDay[] = Array.from({ length: 7 }, (_, i) =>
  i < 5 ? { ...PLAN_DAY } : { active: false, start: "09:00", end: "17:00", breakMinutes: 0 },
);
const FLEX: Job = { id: "j-flex", name: "Flex", color: "#0d9488", mode: "flex", rate: 15 };
const FEST: Job = {
  id: "j-fest",
  name: "Fest",
  color: "#2563eb",
  mode: "fest",
  rate: 15,
  week: WEEK,
};
const ABSENCE_KINDS: ShiftKind[] = ["urlaub", "krank", "feiertag", "frei", "sonstige"];

let container: HTMLDivElement;
let root: Root;

function Harness({ shiftId }: { shiftId: string | null }) {
  const data = useAppData();
  const shift = shiftId ? (data.shifts.find((s) => s.id === shiftId) ?? null) : null;
  return createElement(ShiftDialog, {
    open: true,
    onOpenChange: () => {},
    date: DAY,
    shift,
    shiftId,
    jobs: data.jobs,
    customers: data.customers,
    projects: data.projects,
    settings: data.settings,
    objects: data.objects,
    onRequestAbsence: () => {},
  });
}

const open = (shiftId: string | null) =>
  act(() => root.render(createElement(Harness, { shiftId })));
const unmount = () => act(() => root.render(createElement("div")));
const click = (el: Element) => act(() => (el as HTMLElement).click());
const kindButton = (k: ShiftKind) =>
  document.querySelector<HTMLButtonElement>(
    `[data-testid="shift-dialog"] button[data-kind="${k}"]`,
  )!;
const save = () => click(document.querySelector('[data-testid="entry-save"]')!);

function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function seed(job: Job, shifts: Shift[] = []) {
  act(() => {
    replaceAll({
      ...EMPTY_DATA,
      jobs: [job],
      shifts,
      settings: {
        ...DEFAULT_SETTINGS,
        onboarded: true,
        localDemoMode: true,
        activeJobId: job.id,
      },
    } as never);
  });
}

/** Neuer Eintrag im Editor mit Art k speichern → gespeicherte Schicht. */
function createViaEditor(k: ShiftKind): Shift {
  const before = new Set(getData().shifts.map((s) => s.id));
  open(null);
  click(kindButton(k));
  save();
  unmount();
  const created = getData().shifts.filter((s) => !before.has(s.id));
  expect(created).toHaveLength(1);
  return created[0]!;
}

const times = (s: Shift) => ({ start: s.start, end: s.end, breakMinutes: s.breakMinutes });

/** Zwei Arbeitstage gleicher Wochentag → regelmäßiger Arbeitstag (Krank/Feiertag bezahlt). */
const history = (jobId: string): Shift[] => [
  {
    id: "h1",
    kind: "arbeit",
    jobId,
    date: "2026-09-10",
    start: "10:00",
    end: "14:00",
    breakMinutes: 0,
  },
  {
    id: "h2",
    kind: "arbeit",
    jobId,
    date: "2026-09-17",
    start: "10:00",
    end: "14:00",
    breakMinutes: 0,
  },
];

function clearAppKeys() {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
}

beforeEach(() => {
  clearAppKeys();
  loadFromStorage();
  act(() => activateScope(DEMO_SCOPE));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("P2-1: Stunden neuer Abwesenheiten im Editor", () => {
  it("A: neuer Urlaub ohne Wochenplan → 8 h (09–17 ohne Pause), nicht 7,5 h", () => {
    seed(FLEX);
    const s = createViaEditor("urlaub");
    expect(times(s)).toEqual({ start: "09:00", end: "17:00", breakMinutes: 0 });
    expect(shiftHours(s)).toBe(8);
    expect(shiftPayroll(s, { job: FLEX }).paidAbsenceHours).toBe(8);
  });

  it("B: neuer Krank ohne Wochenplan → gleiche Zeiten/Stunden wie Zeitraum-Dialog", () => {
    seed(FLEX);
    const s = createViaEditor("krank");
    const ref = generateAbsence(FLEX, "krank", DAY, DAY, "BE")[0]!;
    expect(times(s)).toEqual(times(ref));
    expect(times(s)).toEqual({ start: "09:00", end: "17:00", breakMinutes: 0 });
  });

  it("C: neuer Feiertag ohne Wochenplan → gleiche Logik (09–17 ohne Pause)", () => {
    seed(FLEX);
    const s = createViaEditor("feiertag");
    const ref = generateAbsence(FLEX, "feiertag", DAY, DAY, "BE")[0]!;
    expect(times(s)).toEqual(times(ref));
    expect(shiftHours(s)).toBe(8);
  });

  it("D: neuer Urlaub mit Wochenplan → Zeiten und Stunden des Plans", () => {
    seed(FEST);
    const s = createViaEditor("urlaub");
    expect(times(s)).toEqual({ start: "07:00", end: "13:30", breakMinutes: 30 });
    const pay = shiftPayroll(s, { job: FEST });
    expect(pay.paidAbsenceHours).toBe(6);
    expect(pay.basis).toBe("plan");
  });

  describe("E: Zeitraum-Dialog-Weg und Editor-Weg liefern für denselben Tag dieselben Stunden", () => {
    for (const job of [FLEX, FEST]) {
      for (const k of ABSENCE_KINDS) {
        it(`${job.week ? "mit" : "ohne"} Wochenplan – ${k}`, () => {
          seed(job);
          const viaEditor = createViaEditor(k);
          const viaRange = generateAbsence(job, k, DAY, DAY, "BE")[0]!;
          expect(times(viaEditor)).toEqual(times(viaRange));
          const opts = { job, history: history(job.id) };
          const a = shiftPayroll(viaEditor, opts);
          const b = shiftPayroll(viaRange, opts);
          expect(a.paidAbsenceHours).toBe(b.paidAbsenceHours);
          expect(a.earnings).toBe(b.earnings);
          expect(a.reason).toBe(b.reason);
        });
      }
    }
  });

  it("vorher eingegebene Zeiten (06–14) + Wechsel auf Krank → keine Übernahme", () => {
    seed(FLEX);
    open(null);
    setValue(document.querySelector<HTMLInputElement>("#von")!, "06:00");
    setValue(document.querySelector<HTMLInputElement>("#bis")!, "14:00");
    click(kindButton("krank"));
    save();
    const s = getData().shifts[0]!;
    expect(s.kind).toBe("krank");
    expect(times(s)).toEqual({ start: "09:00", end: "17:00", breakMinutes: 0 });
  });

  it("Vorschau im Editor zeigt dieselben Stunden wie gespeichert (Urlaub ohne Plan = 8)", () => {
    seed(FLEX);
    open(null);
    click(kindButton("urlaub"));
    const preview = document.querySelector('[data-testid="entry-absence-preview"]')!;
    expect(preview.getAttribute("data-hours")).toBe("8");
    save();
    expect(shiftHours(getData().shifts[0]!)).toBe(8);
  });

  it("Vorschau mit Wochenplan = Planstunden", () => {
    seed(FEST);
    open(null);
    click(kindButton("urlaub"));
    expect(
      document.querySelector('[data-testid="entry-absence-preview"]')!.getAttribute("data-hours"),
    ).toBe("6");
  });

  it("F: neue Arbeit mit Standard 30 min Pause bleibt unverändert", () => {
    seed(FLEX);
    const s = createViaEditor("arbeit");
    expect(s.kind).toBe("arbeit");
    expect(times(s)).toEqual({ start: "09:00", end: "17:00", breakMinutes: 30 });
    expect(shiftHours(s)).toBe(7.5);
  });

  it("F: neue Arbeit mit Wochenplan übernimmt NICHT die Abwesenheitslogik", () => {
    seed(FEST);
    open(null);
    setValue(document.querySelector<HTMLInputElement>("#von")!, "06:00");
    setValue(document.querySelector<HTMLInputElement>("#bis")!, "14:00");
    save();
    const s = getData().shifts[0]!;
    expect(times(s)).toEqual({ start: "06:00", end: "14:00", breakMinutes: 30 });
  });

  describe("G: bestehende Einträge bleiben unverändert (laden + speichern)", () => {
    for (const k of ["urlaub", "krank", "feiertag", "frei", "sonstige", "arbeit"] as ShiftKind[]) {
      it(`${k}: Zeiten/Pause/Art/ID unverändert`, () => {
        const old: Shift = {
          id: `old-${k}`,
          kind: k,
          jobId: FEST.id,
          date: DAY,
          start: "06:00",
          end: "14:00",
          breakMinutes: 30,
          createdAt: "2026-09-01",
        };
        seed(FEST, [old]);
        open(old.id);
        save();
        const after = getData().shifts;
        expect(after).toHaveLength(1);
        expect(after[0]!.id).toBe(old.id);
        expect(after[0]!.kind).toBe(k);
        expect(times(after[0]!)).toEqual({ start: "06:00", end: "14:00", breakMinutes: 30 });
      });
    }

    it("bestehende Arbeit → auf Urlaub umstellen: bisheriges Verhalten (Zeiten bleiben)", () => {
      const old: Shift = {
        id: "old-work",
        kind: "arbeit",
        jobId: FLEX.id,
        date: DAY,
        start: "06:00",
        end: "14:00",
        breakMinutes: 30,
      };
      seed(FLEX, [old]);
      open(old.id);
      click(kindButton("urlaub"));
      save();
      const s = getData().shifts[0]!;
      expect(s.id).toBe("old-work");
      expect(s.kind).toBe("urlaub");
      expect(times(s)).toEqual({ start: "06:00", end: "14:00", breakMinutes: 30 });
    });
  });

  it("Urlaub im neuen Eintrag bleibt EIN Tag", () => {
    seed(FEST);
    createViaEditor("urlaub");
    expect(getData().shifts).toHaveLength(1);
    expect(getData().shifts[0]!.date).toBe(DAY);
  });
});
