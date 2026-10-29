/**
 * QA P1 (Rest): Die Vorschau im Eintrags-Editor bewertete Abwesenheiten ohne Historie und ohne die
 * Fall-ID des bearbeiteten Eintrags. Ein Krankheitstag nach dem 42. Tag erschien dort bezahlt, während
 * Liste und Monatsbetrag ihn (mit voller Historie) als unbezahlt führten; Urlaub ignorierte den
 * 13-Wochen-Durchschnitt. Außerdem ging beim Speichern im Editor die sickCaseId verloren.
 *
 * Nicht geändert (Rechtsregel, Owner): 28 Tage Wartezeit, 42 Kalendertage je Fall.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ShiftDialog } from "./ShiftDialog";
import { formatEuro } from "@/lib/minijob/calc";
import { shiftPayroll } from "@/lib/minijob/payroll";
import { makeResolver } from "@/lib/minijob/resolve";
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
import { DEFAULT_SETTINGS, type FixedDay, type Job, type Shift } from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const day = (): FixedDay => ({ active: true, start: "08:00", end: "13:00", breakMinutes: 0 }); // 5 h
const JOB: Job = {
  id: "J",
  name: "Fest",
  color: "#2563eb",
  mode: "fest",
  employmentType: "minijob",
  startDate: "2026-01-01",
  rate: 15,
  week: [0, 1, 2, 3, 4, 5, 6].map(day),
} as Job;

let container: HTMLDivElement;
let root: Root;

function Harness({ shiftId, date }: { shiftId: string | null; date: string }) {
  const data = useAppData();
  const shift = shiftId ? (data.shifts.find((s) => s.id === shiftId) ?? null) : null;
  return createElement(ShiftDialog, {
    open: true,
    onOpenChange: () => {},
    date,
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

const open = (shiftId: string | null, date: string) =>
  act(() => root.render(createElement(Harness, { shiftId, date })));
const unmount = () => act(() => root.render(createElement("div")));
const click = (el: Element) => act(() => (el as HTMLElement).click());
const save = () => click(document.querySelector('[data-testid="entry-save"]')!);
const previewEl = () =>
  document.querySelector<HTMLElement>('[data-testid="entry-absence-preview"]')!;
const previewText = () => (previewEl().textContent ?? "").replace(/ /g, " ");
const euro = (n: number) => formatEuro(n, "de").replace(/ /g, " ");

function seed(shifts: Shift[]) {
  act(() => {
    replaceAll({
      ...EMPTY_DATA,
      jobs: [JOB],
      shifts,
      settings: {
        ...DEFAULT_SETTINGS,
        language: "de",
        onboarded: true,
        localDemoMode: true,
        activeJobId: JOB.id,
        bundesland: "BE",
      },
    } as never);
  });
}

function clearAppKeys() {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
}

/** Referenzwert wie Liste und Monatsbetrag: volle Historie. */
function listValue(entry: Shift) {
  const data = getData();
  return shiftPayroll(entry, {
    ...makeResolver(data.jobs, data.settings)(entry),
    history: data.shifts,
  });
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

// Fall beginnt am 10.08.2026 (Vormonat). Kalendertag 42 = 20.09., Kalendertag 43 = 21.09.
const sick = () => generateAbsence(JOB, "krank", "2026-08-10", "2026-10-09", "BE");
const entryOn = (date: string) => getData().shifts.find((s) => s.date === date)!;

describe("Vorschau eines Krankheitstags = Liste = Monatsbetrag", () => {
  for (const [date, label, paid] of [
    ["2026-09-18", "Tag 40", true],
    ["2026-09-20", "Tag 42", true],
    ["2026-09-21", "Tag 43", false],
    ["2026-10-02", "Tag 54", false],
  ] as const) {
    it(`${label} (${date}): Fall begann im Vormonat – Vorschau zeigt ${paid ? "bezahlt" : "unbezahlt"}`, () => {
      seed(sick());
      const entry = entryOn(date);
      const expected = listValue(entry);
      expect(expected.paid).toBe(paid);

      open(entry.id, date);
      expect(Number(previewEl().dataset["hours"])).toBe(paid ? 5 : 0);
      expect(previewText()).toContain(euro(expected.earnings));
      expect(previewText()).toContain(euro(paid ? 75 : 0));
      unmount();
    });
  }

  it("ein NEUER Krankheitstag (kein Fall) bleibt Tag 1 und damit bezahlt", () => {
    seed([]);
    open(null, "2026-09-21");
    act(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="shift-dialog"] button[data-kind="krank"]')!
        .click();
    });
    expect(previewText()).toContain(euro(75));
    unmount();
  });
});

describe("Vorschau eines Urlaubstags nutzt den 13-Wochen-Durchschnitt wie die Liste", () => {
  it("6 Arbeitstage à 8 h vor dem Urlaub: Vorschau = Durchschnitt (120 €), nicht Planstunden (75 €)", () => {
    const work: Shift[] = ["06", "07", "08", "09", "10", "11"].map((d) => ({
      id: `w${d}`,
      jobId: "J",
      kind: "arbeit",
      date: `2026-07-${d}`,
      start: "08:00",
      end: "16:00",
      breakMinutes: 0,
      rate: 15,
    })) as Shift[];
    const vacation = generateAbsence(JOB, "urlaub", "2026-08-03", "2026-08-03", "BE");
    seed([...work, ...vacation]);
    const entry = entryOn("2026-08-03");
    const expected = listValue(entry);
    expect(expected.basis).toBe("average13");
    expect(expected.earnings).toBe(120);

    open(entry.id, "2026-08-03");
    expect(previewText()).toContain(euro(120));
    expect(Number(previewEl().dataset["hours"])).toBe(8);
    unmount();
  });
});

describe("Speichern im Editor behält die Fall-ID", () => {
  it("unverändert speichern: sickCaseId bleibt, der Tag bleibt Tag 43 (unbezahlt)", () => {
    seed(sick());
    const before = entryOn("2026-09-21");
    expect(before.sickCaseId).toBeTruthy();

    open(before.id, "2026-09-21");
    save();
    unmount();

    const after = entryOn("2026-09-21");
    expect(after.id).toBe(before.id);
    expect(after.sickCaseId).toBe(before.sickCaseId);
    expect(listValue(after).paid).toBe(false);
  });

  it("Art ändern (Krank → Urlaub): die Fall-ID entfällt", () => {
    seed(sick());
    const before = entryOn("2026-09-21");
    open(before.id, "2026-09-21");
    click(document.querySelector('[data-testid="shift-dialog"] button[data-kind="urlaub"]')!);
    save();
    unmount();
    const after = entryOn("2026-09-21");
    expect(after.kind).toBe("urlaub");
    expect(after.sickCaseId).toBeUndefined();
  });
});
