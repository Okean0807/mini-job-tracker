/**
 * K1 – Stundensatz-Genauigkeit im echten Editor (react-dom/client + act, happy-dom, ECHTER Store).
 *
 * Vor dem Fix schrieb der Editor bei JEDEM Speichern die auf zwei Stellen formatierte Anzeige als
 * Satz zurück (12.345 -> 12.35), auch ohne dass die Nutzerin den Satz angefasst hatte und auch bei
 * verstecktem Feld. Geprüft wird hier der gespeicherte Bestand:
 *  - unberührt: der exakte Ausgangswert bleibt erhalten (gespeicherte Schicht bzw. Vorschlag),
 *  - bearbeitet: kaufmännisch auf zwei Nachkommastellen gerundet,
 *  - leer / 0 und die Priorität Schicht > Job > Standard bleiben unverändert.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ShiftDialog } from "./ShiftDialog";
import { shiftBreakdown } from "@/lib/minijob/calc";
import { effectiveHourlyFromMonthly, effectiveShiftRate } from "@/lib/minijob/rate";
import { roundMoney } from "@/lib/minijob/rounding";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
  saveJob,
  updateSettings,
  useAppData,
} from "@/lib/minijob/store";
import { DEFAULT_SETTINGS, EMPTY_WEEK, type Job, type Shift } from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = "2026-09-24";

let container: HTMLDivElement;
let root: Root;

function q<T extends Element = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
}

function maybe<T extends Element = HTMLElement>(sel: string): T | null {
  return document.querySelector<T>(sel);
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function blur(el: Element) {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error("missing element to click");
  act(() => {
    (el as HTMLElement).click();
  });
}

const rateField = () => q<HTMLInputElement>("#lohn");
const save = () => click(q('[data-testid="entry-save"]'));
const jobButton = (name: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(name));

function Harness({ shiftId }: { shiftId: string | null }) {
  const d = useAppData();
  const shift = shiftId ? (d.shifts.find((s) => s.id === shiftId) ?? null) : null;
  return createElement(ShiftDialog, {
    open: true,
    onOpenChange: () => undefined,
    date: DAY,
    shift,
    shiftId,
    jobs: d.jobs,
    customers: d.customers,
    projects: d.projects,
    settings: d.settings,
    objects: d.objects,
    history: d.shifts,
  });
}

const HOURLY: Job = { id: "j1", name: "Reinigung Nord", color: "#0d9488", mode: "flex", rate: 14 };
const MONTHLY = {
  id: "j1",
  name: "Büro Monatslohn",
  color: "#2563eb",
  mode: "fest",
  payType: "monthly",
  monthlyGross: 3000,
  week: EMPTY_WEEK,
} as Job;

/** 09:00–17:00 mit 30 Min. Pause = 7,5 bezahlte Stunden. */
const shiftWith = (rate: number | undefined, extra: Partial<Shift> = {}): Shift =>
  ({
    id: "s1",
    kind: "arbeit",
    date: DAY,
    start: "09:00",
    end: "17:00",
    breakMinutes: 30,
    jobId: "j1",
    ...(rate !== undefined ? { rate } : {}),
    ...extra,
  }) as Shift;

function seed(shifts: Shift[], jobs: Job[] = [HOURLY]) {
  act(() => {
    activateScope(DEMO_SCOPE);
    replaceAll({
      ...EMPTY_DATA,
      jobs,
      shifts,
      settings: {
        ...DEFAULT_SETTINGS,
        onboarded: true,
        localDemoMode: true,
        activeJobId: jobs[0]?.id,
      },
    } as never);
  });
}

function open(shiftId: string | null) {
  act(() => root.render(createElement(Harness, { shiftId })));
}

const stored = () => getData().shifts.find((s) => s.id === "s1");
const onlyShift = () => {
  const { shifts } = getData();
  expect(shifts).toHaveLength(1);
  return shifts[0]!;
};

beforeEach(() => {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
  loadFromStorage();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const PRECISE = [12.345, 12.3456, 13.999, 14.006, 0.001, 13.9, 15.5];

describe("K1 unberührter Satz bleibt exakt erhalten", () => {
  it.each(PRECISE)("öffnen und speichern ohne Änderung: %s bleibt exakt", (value) => {
    seed([shiftWith(value)]);
    open("s1");
    save();
    expect(stored()?.rate).toBe(value);
  });

  it.each(PRECISE)(
    "Feld fokussieren und verlassen ohne Eingabe: %s bleibt unverändert",
    (value) => {
      seed([shiftWith(value)]);
      open("s1");
      const shown = rateField().value;
      blur(rateField());
      // Die Anzeige ist nur Formatierung und ändert sich durch das Verlassen nicht.
      expect(rateField().value).toBe(shown);
      save();
      expect(stored()?.rate).toBe(value);
    },
  );

  it.each(PRECISE)("nur die Notiz ändern: Satz %s bleibt, die Notiz wird gespeichert", (value) => {
    seed([shiftWith(value)]);
    open("s1");
    click(q('[data-testid="entry-more-toggle"]'));
    setValue(q<HTMLTextAreaElement>("#notiz"), "nur Notiz");
    save();
    expect(stored()?.rate).toBe(value);
    expect(stored()?.note).toBe("nur Notiz");
  });

  it("die Anzeige bleibt zweistellig formatiert, gespeichert bleibt der exakte Wert", () => {
    seed([shiftWith(12.345)]);
    open("s1");
    expect(rateField().value).toBe("12,35");
    save();
    expect(stored()?.rate).toBe(12.345);
  });

  it("eine Eingabe, die den Text nicht ändert (herausgefiltertes Zeichen), ist keine Bearbeitung", () => {
    seed([shiftWith(12.345)]);
    open("s1");
    setValue(rateField(), "12,35€");
    expect(rateField().value).toBe("12,35");
    blur(rateField());
    save();
    expect(stored()?.rate).toBe(12.345);
  });

  it("bestehende Sätze mit höchstens zwei Nachkommastellen bleiben unverändert", () => {
    for (const value of [13.5, 15, 12.34, 14]) {
      seed([shiftWith(value)]);
      open("s1");
      blur(rateField());
      save();
      expect(stored()?.rate).toBe(value);
      act(() => root.render(createElement("div")));
    }
  });

  it("der exakte Satz übersteht Speichern und erneutes Laden aus dem Speicher", () => {
    seed([shiftWith(12.3456)]);
    open("s1");
    click(q('[data-testid="entry-more-toggle"]'));
    setValue(q<HTMLTextAreaElement>("#notiz"), "geändert");
    save();
    act(() => root.render(createElement("div")));
    act(() => {
      loadFromStorage();
    });
    expect(stored()?.rate).toBe(12.3456);
    expect(stored()?.note).toBe("geändert");
  });
});

describe("K1 verstecktes Satz-Feld", () => {
  it("Monatslohn-Job: das Feld ist nicht sichtbar, der gespeicherte Satz bleibt exakt", () => {
    seed([shiftWith(12.345)], [MONTHLY]);
    open("s1");
    expect(maybe("#lohn")).toBeNull();
    save();
    expect(stored()?.rate).toBe(12.345);
  });

  it("Selbstständigen-Job: das Feld ist nicht sichtbar, der gespeicherte Satz bleibt exakt", () => {
    const selfEmployed = { ...HOURLY, mode: "selbststaendig" } as Job;
    seed([shiftWith(13.999)], [selfEmployed]);
    open("s1");
    expect(maybe("#lohn")).toBeNull();
    save();
    expect(stored()?.rate).toBe(13.999);
  });
});

describe("K1 neue Einträge übernehmen den exakten Vorschlag", () => {
  it("Job-Satz 13.999: angezeigt 14,00, gespeichert 13.999", () => {
    seed([], [{ ...HOURLY, rate: 13.999 }]);
    open(null);
    expect(rateField().value).toBe("14,00");
    save();
    expect(onlyShift().rate).toBe(13.999);
  });

  it("aus dem Monatslohn abgeleiteter Satz behält die volle Genauigkeit", () => {
    const derived = effectiveHourlyFromMonthly(MONTHLY);
    expect(derived).toBeCloseTo(18.4615384615, 9);
    seed([], [MONTHLY]);
    open(null);
    save();
    expect(onlyShift().rate).toBe(derived);
    expect(onlyShift().rate).not.toBe(18.46);
  });

  it("ohne Job-Satz greift der Standardsatz exakt", () => {
    const noRate: Job = { id: "j1", name: "Ohne Satz", color: "#000", mode: "flex" };
    act(() => {
      activateScope(DEMO_SCOPE);
      replaceAll({
        ...EMPTY_DATA,
        jobs: [noRate],
        settings: {
          ...DEFAULT_SETTINGS,
          onboarded: true,
          localDemoMode: true,
          activeJobId: "j1",
          defaultRate: 13.905,
        },
      } as never);
    });
    open(null);
    save();
    expect(onlyShift().rate).toBe(13.905);
  });
});

describe("K1 bewusst bearbeiteter Satz wird kaufmännisch auf zwei Stellen gerundet", () => {
  const cases: Array<[typed: string, saved: number, shownAfterBlur: string]> = [
    ["13,5", 13.5, "13,50"],
    ["12,345", 12.35, "12,35"],
    ["14,006", 14.01, "14,01"],
    ["15", 15, "15,00"],
    // Dezimal-Grenzfall: als Gleitkommazahl läge 1.005 knapp unter der Hälfte (toFixed -> 1.00).
    ["1,005", 1.01, "1,01"],
    ["12,344", 12.34, "12,34"],
    ["12,3449", 12.34, "12,34"],
    ["13.999", 14, "14,00"],
  ];

  it.each(cases)("Eingabe %s wird als %s gespeichert", (typed, saved, shown) => {
    seed([shiftWith(20)]);
    open("s1");
    setValue(rateField(), typed);
    // Beim Tippen wird nichts abgeschnitten.
    expect(rateField().value).toBe(typed.replace(".", ","));
    blur(rateField());
    expect(rateField().value).toBe(shown);
    save();
    expect(stored()?.rate).toBe(saved);
  });

  it.each(cases)(
    "Eingabe %s wird auch ohne Verlassen des Felds als %s gespeichert",
    (typed, saved) => {
      seed([shiftWith(20)]);
      open("s1");
      setValue(rateField(), typed);
      save();
      expect(stored()?.rate).toBe(saved);
    },
  );

  it("K1-M1: eine Eingabe, die wieder dieselbe Anzeige ergibt (12,345 -> 12,35), ändert nichts", () => {
    seed([shiftWith(12.345)]);
    open("s1");
    setValue(rateField(), "12,345");
    save();
    expect(stored()?.rate).toBe(12.345);
  });

  it("ein bearbeiteter Satz gilt auch für einen neuen Eintrag", () => {
    seed([], [{ ...HOURLY, rate: 13.999 }]);
    open(null);
    setValue(rateField(), "15,555");
    save();
    expect(onlyShift().rate).toBe(15.56);
  });
});

describe("K1 leer und 0 behalten ihre Bedeutung", () => {
  it("Schicht ohne Satz: Feld leer, bleibt nach dem Speichern ungesetzt", () => {
    seed([shiftWith(undefined)]);
    open("s1");
    expect(rateField().value).toBe("");
    save();
    expect(stored()).toBeDefined();
    expect(stored()?.rate).toBeUndefined();
    expect("rate" in (stored() as Shift)).toBe(false);
  });

  it("gespeicherte 0 bleibt 0 (kein Rückfall auf den Job-Satz)", () => {
    seed([shiftWith(0)]);
    open("s1");
    expect(rateField().value).toBe("0,00");
    save();
    expect(stored()?.rate).toBe(0);
  });

  it("Feld geleert: der Satz der Schicht wird entfernt (nicht gesetzt)", () => {
    seed([shiftWith(12.345)]);
    open("s1");
    setValue(rateField(), "");
    blur(rateField());
    expect(rateField().value).toBe("");
    save();
    expect(stored()).toBeDefined();
    expect(stored()?.rate).toBeUndefined();
  });

  it("eingegebene 0 wird als 0 gespeichert", () => {
    seed([shiftWith(12.345)]);
    open("s1");
    setValue(rateField(), "0");
    blur(rateField());
    expect(rateField().value).toBe("0,00");
    save();
    expect(stored()?.rate).toBe(0);
  });

  it("ein winziger unberührter Satz wird nicht zu 0", () => {
    seed([shiftWith(0.001)]);
    open("s1");
    expect(rateField().value).toBe("0,00");
    save();
    expect(stored()?.rate).toBe(0.001);
    expect(stored()?.rate).not.toBe(0);
  });
});

describe("K1 Jobwechsel", () => {
  const JOBS: Job[] = [
    { ...HOURLY, rate: 13.999 },
    { id: "j2", name: "Lager Süd", color: "#2563eb", mode: "flex", rate: 16.125 },
  ];

  it("der Vorschlag des neuen Jobs wird exakt übernommen, ohne als Bearbeitung zu gelten", () => {
    seed([], JOBS);
    open(null);
    expect(rateField().value).toBe("14,00");
    click(jobButton("Lager Süd"));
    expect(rateField().value).toBe("16,13");
    save();
    expect(onlyShift().jobId).toBe("j2");
    expect(onlyShift().rate).toBe(16.125);
  });

  it("hin und zurück: wieder der exakte Vorschlag des ersten Jobs", () => {
    seed([], JOBS);
    open(null);
    click(jobButton("Lager Süd"));
    click(jobButton("Reinigung Nord"));
    blur(rateField());
    expect(rateField().value).toBe("14,00");
    save();
    expect(onlyShift().jobId).toBe("j1");
    expect(onlyShift().rate).toBe(13.999);
  });

  it("NEW-01: ein Jobwechsel nach einer Eingabe behält die getippte Eingabe", () => {
    seed([], JOBS);
    open(null);
    setValue(rateField(), "20,555");
    click(jobButton("Lager Süd"));
    expect(rateField().value).toBe("20,555");
    blur(rateField());
    expect(rateField().value).toBe("20,56");
    save();
    expect(onlyShift().rate).toBe(20.56);
    expect(onlyShift().jobId).toBe("j2");
  });

  it("eine Eingabe nach dem Jobwechsel zählt wieder als Bearbeitung", () => {
    seed([], JOBS);
    open(null);
    click(jobButton("Lager Süd"));
    setValue(rateField(), "16,5");
    save();
    expect(onlyShift().rate).toBe(16.5);
  });
});

describe("K1 Abrechnung rechnet mit dem erhaltenen Satz", () => {
  it("12.345 × 7,5 Std. bleibt 92,59 € und wird nicht zu 12,35 × 7,5 = 92,63 €", () => {
    seed([shiftWith(12.345)]);
    open("s1");
    click(q('[data-testid="entry-more-toggle"]'));
    setValue(q<HTMLTextAreaElement>("#notiz"), "nur Notiz");
    save();
    const saved = stored() as Shift;
    const breakdown = shiftBreakdown(saved, { job: HOURLY, defaultRate: 14 });
    expect(breakdown.hours).toBe(7.5);
    expect(breakdown.base).toBeCloseTo(92.5875, 10);
    expect(roundMoney(breakdown.base)).toBe(92.59);
    expect(roundMoney(breakdown.base)).not.toBe(roundMoney(7.5 * 12.35));
  });

  it("Priorität Schicht > Job > Standard bleibt: der erhaltene Schicht-Satz schlägt den Job-Satz", () => {
    seed([shiftWith(12.345)]);
    open("s1");
    save();
    expect(effectiveShiftRate(stored() as Shift, { job: HOURLY, defaultRate: 9 })).toBe(12.345);
    // Ohne Schicht-Satz greift weiter der Job-Satz, ohne Job-Satz der Standard.
    expect(effectiveShiftRate({}, { job: HOURLY, defaultRate: 9 })).toBe(14);
    expect(effectiveShiftRate({}, { defaultRate: 9 })).toBe(9);
  });
});

describe("K1 Regressionsmatrix je Wert (A–E)", () => {
  // Erwartung nach bewusster Eingabe desselben Werts: kaufmännisch auf zwei Stellen.
  const matrix: Array<[value: number, typed: string, afterEdit: number]> = [
    [12.345, "12,345", 12.35],
    [12.3456, "12,3456", 12.35],
    [13.999, "13,999", 14],
    [14.006, "14,006", 14.01],
    [0.001, "0,001", 0],
    [13.9, "13,90", 13.9],
    [15.5, "15,50", 15.5],
  ];
  const cancelButton = () => q('[data-testid="entry-save"]').previousElementSibling;
  const close = () => act(() => root.render(createElement("div")));

  it.each(matrix)(
    "C: %s – Eingabe %s über einen anderen Satz wird als %s gespeichert",
    (_v, typed, afterEdit) => {
      seed([shiftWith(20)]);
      open("s1");
      setValue(rateField(), typed);
      blur(rateField());
      save();
      expect(stored()?.rate).toBe(afterEdit);
    },
  );

  it.each(matrix)(
    "C (K1-M1): %s – denselben Wert (%s) erneut eintippen ergibt dieselbe Anzeige und ändert nichts",
    (value, typed) => {
      seed([shiftWith(value)]);
      open("s1");
      setValue(rateField(), typed);
      blur(rateField());
      save();
      expect(stored()?.rate).toBe(value);
    },
  );

  it.each(matrix)("D: %s – Abbrechen ändert nichts, auch nach einer Eingabe", (value) => {
    seed([shiftWith(value)]);
    const before = JSON.stringify(getData().shifts);
    open("s1");
    click(cancelButton());
    close();
    expect(JSON.stringify(getData().shifts)).toBe(before);

    open("s1");
    setValue(rateField(), "99,999");
    blur(rateField());
    click(cancelButton());
    close();
    expect(JSON.stringify(getData().shifts)).toBe(before);
    expect(stored()?.rate).toBe(value);
  });

  it.each(matrix)("E: %s – nach Speichern erneut öffnen und speichern bleibt exakt", (value) => {
    seed([shiftWith(value)]);
    open("s1");
    save();
    close();
    act(() => {
      loadFromStorage();
    });
    expect(stored()?.rate).toBe(value);
    open("s1");
    const shown = rateField().value;
    save();
    close();
    expect(stored()?.rate).toBe(value);
    open("s1");
    expect(rateField().value).toBe(shown);
  });

  it.each(matrix)(
    "E: %s – bearbeiteter Satz bleibt nach erneutem Öffnen stabil",
    (_v, typed, afterEdit) => {
      seed([shiftWith(20)]);
      open("s1");
      setValue(rateField(), typed);
      save();
      close();
      open("s1");
      save();
      expect(stored()?.rate).toBe(afterEdit);
    },
  );
});

describe("K1-M1 gleiche Anzeige nach dem Bearbeiten = exakter Ausgangswert", () => {
  const close = () => act(() => root.render(createElement("div")));
  const cancelButton = () => q('[data-testid="entry-save"]').previousElementSibling;
  /** Zweite Eingabestelle: Monatslohn-Job, Feld im Block "Mehr". */
  const openSecond = (rate: number) => {
    seed([shiftWith(rate)], [MONTHLY]);
    open("s1");
    click(q('[data-testid="entry-more-toggle"]'));
  };
  const places: Array<[label: string, start: (rate: number) => void]> = [
    [
      "erste Eingabestelle",
      (rate) => {
        seed([shiftWith(rate)]);
        open("s1");
      },
    ],
    ["zweite Eingabestelle", openSecond],
  ];

  describe.each(places)("%s", (_label, start) => {
    it("12.345 (12,35): löschen und neu tippen -> 12.345", () => {
      start(12.345);
      expect(rateField().value).toBe("12,35");
      setValue(rateField(), "");
      setValue(rateField(), "1");
      setValue(rateField(), "12,3");
      setValue(rateField(), "12,35");
      save();
      expect(stored()?.rate).toBe(12.345);
    });

    it("12.345: ein Zeichen löschen und wieder tippen, mit Verlassen des Felds -> 12.345", () => {
      start(12.345);
      setValue(rateField(), "12,3");
      setValue(rateField(), "12,35");
      blur(rateField());
      expect(rateField().value).toBe("12,35");
      save();
      expect(stored()?.rate).toBe(12.345);
    });

    it("12.3456: anderen Wert tippen, Feld verlassen, Anzeige wiederherstellen -> 12.3456", () => {
      start(12.3456);
      setValue(rateField(), "20");
      blur(rateField());
      expect(rateField().value).toBe("20,00");
      setValue(rateField(), "12,35");
      blur(rateField());
      save();
      expect(stored()?.rate).toBe(12.3456);
    });

    it("13.999 (14,00): '14' wiederherstellen -> 13.999", () => {
      start(13.999);
      expect(rateField().value).toBe("14,00");
      setValue(rateField(), "1");
      setValue(rateField(), "14");
      save();
      expect(stored()?.rate).toBe(13.999);
    });

    it("12.345: wirklich anderer Wert 12,36 -> 12.36", () => {
      start(12.345);
      setValue(rateField(), "12,36");
      save();
      expect(stored()?.rate).toBe(12.36);
    });

    it("12.345: wiederhergestellt, dann doch geändert -> der neue Wert zählt", () => {
      start(12.345);
      setValue(rateField(), "12,3");
      setValue(rateField(), "12,35");
      setValue(rateField(), "12,355");
      blur(rateField());
      expect(rateField().value).toBe("12,36");
      save();
      expect(stored()?.rate).toBe(12.36);
    });

    it("Abbrechen nach dem Bearbeiten speichert nichts", () => {
      start(12.345);
      const before = JSON.stringify(getData().shifts);
      setValue(rateField(), "12,3");
      setValue(rateField(), "12,35");
      setValue(rateField(), "99");
      click(cancelButton());
      close();
      expect(JSON.stringify(getData().shifts)).toBe(before);
    });
  });

  it("12.345: nur die Notiz ändern -> 12.345", () => {
    seed([shiftWith(12.345)]);
    open("s1");
    click(q('[data-testid="entry-more-toggle"]'));
    setValue(q<HTMLTextAreaElement>("#notiz"), "nur Notiz");
    save();
    expect(stored()?.rate).toBe(12.345);
    expect(stored()?.note).toBe("nur Notiz");
  });

  it("Satz wiederhergestellt und dazu die Notiz geändert -> Satz exakt, Notiz gespeichert", () => {
    seed([shiftWith(12.345)]);
    open("s1");
    setValue(rateField(), "");
    setValue(rateField(), "12,35");
    click(q('[data-testid="entry-more-toggle"]'));
    setValue(q<HTMLTextAreaElement>("#notiz"), "x");
    save();
    expect(stored()?.rate).toBe(12.345);
    expect(stored()?.note).toBe("x");
  });

  it("Eintrag ohne Satz: getippt und wieder geleert bleibt ungesetzt", () => {
    seed([shiftWith(undefined)]);
    open("s1");
    setValue(rateField(), "15");
    setValue(rateField(), "");
    save();
    expect(stored()).toBeDefined();
    expect("rate" in (stored() as Shift)).toBe(false);
  });

  it("neuer Eintrag: Vorschlag 13.999 gelöscht und '14' getippt -> 13.999", () => {
    seed([], [{ ...HOURLY, rate: 13.999 }]);
    open(null);
    setValue(rateField(), "");
    setValue(rateField(), "14");
    save();
    expect(onlyShift().rate).toBe(13.999);
  });
});

describe("K1 Hinweis auf den gespeicherten genauen Wert (M-A)", () => {
  const hint = () => maybe('[data-testid="entry-rate-exact"]');
  const places: Array<[label: string, start: (rate: number) => void]> = [
    [
      "erste Eingabestelle",
      (rate) => {
        seed([shiftWith(rate)]);
        open("s1");
      },
    ],
    [
      "zweite Eingabestelle",
      (rate) => {
        seed([shiftWith(rate)], [MONTHLY]);
        open("s1");
        click(q('[data-testid="entry-more-toggle"]'));
      },
    ],
  ];

  describe.each(places)("%s", (_label, start) => {
    it("(1) 12.345, Eingabe 12,354: Satz bleibt 12.345, Hinweis bleibt sichtbar", () => {
      start(12.345);
      expect(hint()?.textContent).toContain("12,345\u00a0€");
      setValue(rateField(), "12,354");
      expect(hint()?.textContent).toContain("12,345\u00a0€");
      blur(rateField());
      expect(rateField().value).toBe("12,35");
      expect(hint()?.textContent).toContain("12,345\u00a0€");
      save();
      expect(stored()?.rate).toBe(12.345);
    });

    it("(2) 0.001, Eingabe 0: Satz bleibt 0.001, Hinweis nennt den genauen Wert", () => {
      start(0.001);
      expect(rateField().value).toBe("0,00");
      expect(hint()?.textContent).toContain("0,001\u00a0€");
      setValue(rateField(), "0");
      blur(rateField());
      expect(hint()?.textContent).toContain("0,001\u00a0€");
      save();
      expect(stored()?.rate).toBe(0.001);
    });

    it("(3) 12.345, Eingabe 12,355: Satz wird 12.36, der alte Hinweis verschwindet", () => {
      start(12.345);
      expect(hint()).not.toBeNull();
      setValue(rateField(), "12,355");
      expect(hint()).toBeNull();
      blur(rateField());
      expect(rateField().value).toBe("12,36");
      expect(hint()).toBeNull();
      save();
      expect(stored()?.rate).toBe(12.36);
    });

    it("(4) 13.999 unberührt: Satz bleibt 13.999, Hinweis zeigt 13,999 €", () => {
      start(13.999);
      expect(rateField().value).toBe("14,00");
      expect(hint()?.textContent).toContain("13,999\u00a0€");
      save();
      expect(stored()?.rate).toBe(13.999);
    });

    it.each([13.9, 15.5, 14, 0])("(5) %s: kein überflüssiger Hinweis", (rate) => {
      start(rate);
      expect(hint()).toBeNull();
      expect(rateField().getAttribute("aria-describedby")).toBeNull();
    });

    it("der Hinweis ist mit dem Feld verknüpft und erklärt die Berechnung", () => {
      start(12.345);
      const el = hint();
      expect(el?.tagName).toBe("P");
      expect(rateField().getAttribute("aria-describedby")).toBe(el?.id);
      expect(el?.textContent).toContain("Gespeicherter genauer Wert");
      expect(el?.textContent).toContain("gerechnet");
    });

    it("zwischendurch anderer Wert, dann Anzeige wiederhergestellt: Hinweis kommt zurück", () => {
      start(12.345);
      setValue(rateField(), "20");
      expect(hint()).toBeNull();
      setValue(rateField(), "12,35");
      expect(hint()?.textContent).toContain("12,345\u00a0€");
    });
  });

  it("verstecktes Feld: Hinweis erst mit dem Feld sichtbar, danach wieder weg", () => {
    seed([shiftWith(12.345)], [MONTHLY]);
    open("s1");
    expect(maybe("#lohn")).toBeNull();
    expect(hint()).toBeNull();
    click(q('[data-testid="entry-more-toggle"]'));
    expect(hint()?.textContent).toContain("12,345\u00a0€");
    click(q('[data-testid="entry-more-toggle"]'));
    expect(hint()).toBeNull();
    save();
    expect(stored()?.rate).toBe(12.345);
  });

  it("neuer Eintrag: kein Hinweis auf einen gespeicherten Wert", () => {
    seed([], [{ ...HOURLY, rate: 13.999 }]);
    open(null);
    expect(rateField().value).toBe("14,00");
    expect(hint()).toBeNull();
  });
});

describe("K1-L1 Zahlenformat des Hinweises in allen Sprachen", () => {
  const hint = () => maybe('[data-testid="entry-rate-exact"]');
  const langs: Array<[lang: string, label: string]> = [
    ["de", "Gespeicherter genauer Wert"],
    ["en", "Exact stored value"],
    ["ru", "Сохранённое точное значение"],
    ["tr", "Kayıtlı tam değer"],
    ["pl", "Zapisana dokładna wartość"],
  ];
  const values: Array<[rate: number, shown: string, exact: string]> = [
    [12.345, "12,35", "12,345\u00a0€"],
    [12.3456, "12,35", "12,3456\u00a0€"],
    [13.999, "14,00", "13,999\u00a0€"],
    [0.001, "0,00", "0,001\u00a0€"],
  ];
  const seedLang = (rate: number, lang: string, second: boolean) => {
    const jobs = [second ? MONTHLY : HOURLY];
    act(() => {
      activateScope(DEMO_SCOPE);
      replaceAll({
        ...EMPTY_DATA,
        jobs,
        shifts: [shiftWith(rate)],
        settings: {
          ...DEFAULT_SETTINGS,
          onboarded: true,
          localDemoMode: true,
          activeJobId: jobs[0]?.id,
          language: lang,
        },
      } as never);
    });
    open("s1");
    if (second) click(q('[data-testid="entry-more-toggle"]'));
  };

  describe.each(langs)("%s", (lang, label) => {
    describe.each([
      ["erste Eingabestelle", false],
      ["zweite Eingabestelle", true],
    ] as const)("%s", (_where, second) => {
      it.each(values)("%s: Feld %s, Hinweis enthält %s", (rate, shown, exact) => {
        seedLang(rate, lang, second);
        expect(rateField().value).toBe(shown);
        const text = hint()?.textContent ?? "";
        expect(text).toContain(label);
        expect(text).toContain(exact);
        // dieselbe Dezimalkonvention wie das Feld: Komma, kein Punkt, Währung dahinter
        expect(text.includes(exact.replace(",", "."))).toBe(false);
        expect(text).not.toMatch(/€\d/);
        save();
        expect(stored()?.rate).toBe(rate);
      });

      it.each([13.9, 15.5])("%s: kein Hinweis", (rate) => {
        seedLang(rate, lang, second);
        expect(hint()).toBeNull();
      });
    });
  });
});

describe("K1 ausdrücklich den angezeigten Wert übernehmen", () => {
  const hint = () => maybe('[data-testid="entry-rate-exact"]');
  const accept = () => maybe<HTMLButtonElement>('[data-testid="entry-rate-accept"]');
  const cancelButton = () => q('[data-testid="entry-save"]').previousElementSibling;
  const places: Array<[label: string, start: (rate: number) => void]> = [
    [
      "erste Eingabestelle",
      (rate) => {
        seed([shiftWith(rate)]);
        open("s1");
      },
    ],
    [
      "zweite Eingabestelle",
      (rate) => {
        seed([shiftWith(rate)], [MONTHLY]);
        open("s1");
        click(q('[data-testid="entry-more-toggle"]'));
      },
    ],
  ];
  /** Dialog schließen und denselben Eintrag neu öffnen (gleicher Ort). */
  const reopen = (second: boolean) => {
    act(() => root.render(createElement("div")));
    open("s1");
    if (second) click(q('[data-testid="entry-more-toggle"]'));
  };

  describe.each(places)("%s", (label, start) => {
    const second = label.startsWith("zweite");

    it("A: 13.999 -> 14,00 übernehmen, speichern: exakt 14, Hinweis weg", () => {
      start(13.999);
      expect(rateField().value).toBe("14,00");
      expect(hint()?.textContent).toContain("13,999\u00a0€");
      expect(accept()?.textContent).toContain("14,00\u00a0€");
      click(accept());
      expect(hint()).toBeNull();
      expect(accept()).toBeNull();
      expect(rateField().value).toBe("14,00");
      save();
      expect(stored()?.rate).toBe(14);
      reopen(second);
      expect(rateField().value).toBe("14,00");
      expect(hint()).toBeNull();
      expect(accept()).toBeNull();
      save();
      expect(stored()?.rate).toBe(14);
    });

    it("B: 0.001 -> 0,00 übernehmen: gespeichert wird numerisch 0, nicht unset", () => {
      start(0.001);
      expect(rateField().value).toBe("0,00");
      expect(hint()?.textContent).toContain("0,001\u00a0€");
      click(accept());
      expect(hint()).toBeNull();
      save();
      const row = getData().shifts.find((x) => x.id === "s1") as Shift;
      expect("rate" in row).toBe(true);
      expect(row.rate).toBe(0);
      expect(Object.is(row.rate, 0)).toBe(true);
      reopen(second);
      expect(rateField().value).toBe("0,00");
      expect(hint()).toBeNull();
      save();
      expect(stored()?.rate).toBe(0);
    });

    it("12.345 -> 12,35 übernehmen: der neue Wert fließt in Vorschau und Speicherung", () => {
      start(12.345);
      click(accept());
      expect(rateField().value).toBe("12,35");
      save();
      expect(stored()?.rate).toBe(12.35);
    });

    it("C: ohne Übernahme speichern: 12.345 bleibt exakt", () => {
      start(12.345);
      expect(rateField().value).toBe("12,35");
      expect(hint()?.textContent).toContain("12,345\u00a0€");
      save();
      expect(stored()?.rate).toBe(12.345);
    });

    it("D: M1 – löschen und neu tippen, ohne Übernahme: exakter Wert bleibt, Knopf bleibt", () => {
      start(12.345);
      setValue(rateField(), "");
      setValue(rateField(), "12,35");
      blur(rateField());
      expect(hint()).not.toBeNull();
      expect(accept()).not.toBeNull();
      save();
      expect(stored()?.rate).toBe(12.345);
    });

    it("E: Übernahme gedrückt, dann Abbrechen: nichts wird gespeichert", () => {
      start(13.999);
      const before = JSON.stringify(getData().shifts);
      click(accept());
      expect(hint()).toBeNull();
      click(cancelButton());
      act(() => root.render(createElement("div")));
      expect(JSON.stringify(getData().shifts)).toBe(before);
      expect(stored()?.rate).toBe(13.999);
      reopen(second);
      expect(hint()?.textContent).toContain("13,999\u00a0€");
    });

    it("F: Notiz, Ende und Pause ändern ohne Übernahme: exakter Satz bleibt", () => {
      start(12.345);
      setValue(q<HTMLInputElement>("#bis"), "16:00");
      setValue(q<HTMLInputElement>("#pause"), "15");
      if (!maybe("#notiz")) click(q('[data-testid="entry-more-toggle"]'));
      setValue(q<HTMLTextAreaElement>("#notiz"), "nur Notiz");
      expect(hint()).not.toBeNull();
      save();
      const row = stored() as Shift;
      expect(row.rate).toBe(12.345);
      expect(row.end).toBe("16:00");
      expect(row.breakMinutes).toBe(15);
      expect(row.note).toBe("nur Notiz");
    });

    it("Öffnen, Fokus und Verlassen übernehmen nichts", () => {
      start(13.999);
      rateField().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      blur(rateField());
      expect(hint()).not.toBeNull();
      save();
      expect(stored()?.rate).toBe(13.999);
    });

    it("G: anderer Wert wird weiter halb aufgerundet; der Knopf verschwindet dabei", () => {
      start(12.345);
      setValue(rateField(), "12,355");
      expect(hint()).toBeNull();
      expect(accept()).toBeNull();
      blur(rateField());
      expect(rateField().value).toBe("12,36");
      save();
      expect(stored()?.rate).toBe(12.36);
    });

    it("nach Übernahme weiter bearbeiten: der neue Wert zählt, gerundet", () => {
      start(13.999);
      click(accept());
      setValue(rateField(), "15,555");
      blur(rateField());
      save();
      expect(stored()?.rate).toBe(15.56);
    });

    it("kein Knopf bei gewöhnlichen Zwei-Stellen-Sätzen", () => {
      for (const rate of [13.9, 15.5, 14, 0, 12.35]) {
        start(rate);
        expect(accept()).toBeNull();
        expect(hint()).toBeNull();
        act(() => root.render(createElement("div")));
      }
    });

    it("Knopf ist ein echter Button mit Namen, per Tastatur auslösbar und vom Feld getrennt", () => {
      start(13.999);
      const el = accept();
      expect(el?.tagName).toBe("BUTTON");
      expect(el?.getAttribute("type")).toBe("button");
      expect(el?.textContent?.trim()).toBe("14,00\u00a0€ als neuen Wert übernehmen");
      expect(el?.disabled).toBe(false);
      expect(el?.className).toContain("focus-visible:ring");
      // Hinweis bleibt der beschreibende Text des Feldes, der Knopf liegt außerhalb davon
      expect(rateField().getAttribute("aria-describedby")).toBe(hint()?.id);
      expect(hint()?.contains(el as Node)).toBe(false);
      // Enter/Leertaste lösen bei einem <button> den Klick aus; ein Klick genügt für die Übernahme
      click(el);
      expect(accept()).toBeNull();
    });
  });

  it("verstecktes Feld: Knopf erst mit dem Feld sichtbar", () => {
    seed([shiftWith(13.999)], [MONTHLY]);
    open("s1");
    expect(maybe("#lohn")).toBeNull();
    expect(accept()).toBeNull();
    click(q('[data-testid="entry-more-toggle"]'));
    expect(accept()).not.toBeNull();
  });

  it("neuer Eintrag: kein Knopf (der Satz ist ein Vorschlag, nichts Gespeichertes)", () => {
    seed([], [{ ...HOURLY, rate: 13.999 }]);
    open(null);
    expect(accept()).toBeNull();
  });

  describe.each([
    ["de", "14,00\u00a0€ als neuen Wert übernehmen"],
    ["en", "Use 14,00\u00a0€ as the new value"],
    ["ru", "Принять 14,00\u00a0€ как новое значение"],
    ["tr", "14,00\u00a0€ değerini yeni değer olarak kabul et"],
    ["pl", "Przyjmij 14,00\u00a0€ jako nową wartość"],
  ])("Sprache %s", (lang, text) => {
    it.each([false, true])("Beschriftung und Übernahme (zweite Stelle: %s)", (second) => {
      const jobs = [second ? MONTHLY : HOURLY];
      act(() => {
        activateScope(DEMO_SCOPE);
        replaceAll({
          ...EMPTY_DATA,
          jobs,
          shifts: [shiftWith(13.999)],
          settings: {
            ...DEFAULT_SETTINGS,
            onboarded: true,
            localDemoMode: true,
            activeJobId: jobs[0]?.id,
            language: lang,
          },
        } as never);
      });
      open("s1");
      if (second) click(q('[data-testid="entry-more-toggle"]'));
      expect(accept()?.textContent?.trim()).toBe(text);
      click(accept());
      save();
      expect(stored()?.rate).toBe(14);
    });
  });
});

describe("NEW-01 Jobwechsel ändert nur den Job", () => {
  const ALPHA: Job = { id: "j1", name: "Reinigung Nord", color: "#0d9488", mode: "flex", rate: 14 };
  const BETA: Job = { id: "j2", name: "Lager Süd", color: "#2563eb", mode: "flex", rate: 16.125 };
  const GAMMA: Job = { id: "j3", name: "Büro Mitte", color: "#7c3aed", mode: "flex", rate: 20 };
  const ABC = [ALPHA, BETA, GAMMA];
  /** Zwei Monatslohn-Jobs: ihr Satzfeld liegt im Block "Mehr" (zweite Eingabestelle). */
  const monthly = (id: string, name: string, gross: number) =>
    ({
      id,
      name,
      color: "#333",
      mode: "fest",
      payType: "monthly",
      monthlyGross: gross,
      week: EMPTY_WEEK,
    }) as Job;
  const M1J = monthly("j1", "Monat Eins", 3250); // 3250 / 162,5 h = 20 €/h
  const M2J = monthly("j2", "Monat Zwei", 2600); // 2600 / 162,5 h = 16 €/h
  const hint = () => maybe('[data-testid="entry-rate-exact"]');
  const useJob = () => maybe<HTMLButtonElement>('[data-testid="entry-rate-use-job"]');
  const cancelButton = () => q('[data-testid="entry-save"]').previousElementSibling;
  const close = () => act(() => root.render(createElement("div")));
  const row = () => getData().shifts.find((x) => x.id === "s1") as Shift;
  const more = () => click(q('[data-testid="entry-more-toggle"]'));
  const tap = (name: string) => click(jobButton(name));

  describe("bestehender Eintrag", () => {
    it("1: 12.345 bei Job A, A -> B -> A, speichern: Satz bleibt exakt 12.345", () => {
      seed([shiftWith(12.345)], ABC);
      open("s1");
      tap("Lager Süd");
      expect(rateField().value).toBe("12,35");
      expect(hint()?.textContent).toContain("12,345\u00a0€");
      tap("Reinigung Nord");
      expect(rateField().value).toBe("12,35");
      save();
      expect(row().rate).toBe(12.345);
      expect(row().jobId).toBe("j1");
    });

    it("A -> B und speichern: nur der Job ändert sich", () => {
      seed([shiftWith(12.345)], ABC);
      open("s1");
      tap("Lager Süd");
      save();
      expect(row().rate).toBe(12.345);
      expect(row().jobId).toBe("j2");
      close();
      open("s1");
      expect(rateField().value).toBe("12,35");
      save();
      expect(row().rate).toBe(12.345);
      expect(row().jobId).toBe("j2");
    });

    it("2: getippte, nicht gespeicherte Eingabe 99,5 bleibt beim Jobwechsel erhalten", () => {
      seed([shiftWith(12.345)], ABC);
      open("s1");
      setValue(rateField(), "99,5");
      tap("Lager Süd");
      expect(rateField().value).toBe("99,5");
      tap("Büro Mitte");
      expect(rateField().value).toBe("99,5");
      save();
      expect(row().rate).toBe(99.5);
      expect(row().jobId).toBe("j3");
    });

    it("2b: getippte Eingabe mit mehr Nachkommastellen wird beim Speichern halb aufgerundet", () => {
      seed([shiftWith(12.345)], ABC);
      open("s1");
      setValue(rateField(), "20,555");
      tap("Lager Süd");
      save();
      expect(row().rate).toBe(20.56);
    });

    it("3: Eintrag ohne eigenen Satz bleibt ohne Satz und erbt den Satz des neuen Jobs", () => {
      seed([shiftWith(undefined)], ABC);
      open("s1");
      expect(rateField().value).toBe("");
      tap("Lager Süd");
      expect(rateField().value).toBe("");
      expect(useJob()).toBeNull();
      save();
      expect("rate" in row()).toBe(false);
      expect(row().jobId).toBe("j2");
      const pay = shiftBreakdown(row(), { job: BETA, defaultRate: 14 });
      expect(pay.hours).toBe(7.5);
      expect(pay.base).toBeCloseTo(7.5 * 16.125, 10);
    });

    it("4: Abbrechen nach dem Jobwechsel speichert nichts", () => {
      seed([shiftWith(12.345)], ABC);
      const before = JSON.stringify(getData().shifts);
      open("s1");
      tap("Lager Süd");
      setValue(rateField(), "77");
      click(cancelButton());
      close();
      expect(JSON.stringify(getData().shifts)).toBe(before);
    });

    it.each([12.3456, 13.999, 0.001])("7: exakter Satz %s übersteht den Jobwechsel", (rate) => {
      seed([shiftWith(rate)], ABC);
      open("s1");
      tap("Lager Süd");
      expect(hint()).not.toBeNull();
      tap("Büro Mitte");
      save();
      expect(row().rate).toBe(rate);
      expect(row().jobId).toBe("j3");
    });

    it("8: dasselbe Job-Feld noch einmal antippen ändert nichts", () => {
      seed([shiftWith(12.345)], ABC);
      open("s1");
      const before = {
        rate: rateField().value,
        start: q<HTMLInputElement>("#von").value,
        end: q<HTMLInputElement>("#bis").value,
      };
      tap("Reinigung Nord");
      expect({
        rate: rateField().value,
        start: q<HTMLInputElement>("#von").value,
        end: q<HTMLInputElement>("#bis").value,
      }).toEqual(before);
      expect(hint()).not.toBeNull();
      save();
      expect(row().rate).toBe(12.345);
    });

    it("9: Monatslohn-Job: das versteckte Satzfeld ersetzt keinen Satz unsichtbar", () => {
      const jobs = [ALPHA, monthly("j9", "Monatslohn", 3000)];
      seed([shiftWith(12.345)], jobs);
      open("s1");
      tap("Monatslohn");
      expect(maybe("#lohn")).toBeNull();
      save();
      expect(row().rate).toBe(12.345);
      expect(row().jobId).toBe("j9");
    });

    it("9b: Monatslohn-Job, Eintrag ohne Satz: weiter ohne Satz", () => {
      const jobs = [ALPHA, monthly("j9", "Monatslohn", 3000)];
      seed([shiftWith(undefined)], jobs);
      open("s1");
      tap("Monatslohn");
      save();
      expect("rate" in row()).toBe(false);
    });

    it("10: zweite Eingabestelle (Block Mehr): Satz bleibt beim Wechsel zwischen Monatslohn-Jobs", () => {
      seed([shiftWith(12.345)], [M1J, M2J]);
      open("s1");
      more();
      expect(rateField().value).toBe("12,35");
      tap("Monat Zwei");
      expect(rateField().value).toBe("12,35");
      expect(hint()).not.toBeNull();
      save();
      expect(row().rate).toBe(12.345);
      expect(row().jobId).toBe("j2");
    });

    it("10b: zweite Eingabestelle: getippte Eingabe bleibt erhalten", () => {
      seed([shiftWith(12.345)], [M1J, M2J]);
      open("s1");
      more();
      setValue(rateField(), "30");
      tap("Monat Zwei");
      expect(rateField().value).toBe("30");
      save();
      expect(row().rate).toBe(30);
    });
  });

  describe("neuer Eintrag", () => {
    it("5: der Vorschlag folgt dem Job, solange der Satz unberührt ist", () => {
      seed([], ABC);
      open(null);
      expect(rateField().value).toBe("14,00");
      tap("Lager Süd");
      expect(rateField().value).toBe("16,13");
      tap("Büro Mitte");
      expect(rateField().value).toBe("20,00");
      save();
      expect(onlyShift().rate).toBe(20);
      expect(onlyShift().jobId).toBe("j3");
    });

    it("5b: exakter Vorschlag 16.125 wird gespeichert", () => {
      seed([], ABC);
      open(null);
      tap("Lager Süd");
      save();
      expect(onlyShift().rate).toBe(16.125);
    });

    it("6: getippte 18 bleibt beim Jobwechsel erhalten", () => {
      seed([], ABC);
      open(null);
      setValue(rateField(), "18");
      tap("Lager Süd");
      expect(rateField().value).toBe("18");
      tap("Büro Mitte");
      expect(rateField().value).toBe("18");
      save();
      expect(onlyShift().rate).toBe(18);
      expect(onlyShift().jobId).toBe("j3");
    });

    it("6b: Eingabe, die wieder dieselbe Anzeige ergibt, gilt als unberührt und folgt dem Job", () => {
      seed([], ABC);
      open(null);
      setValue(rateField(), "");
      setValue(rateField(), "14");
      tap("Lager Süd");
      expect(rateField().value).toBe("16,13");
      save();
      expect(onlyShift().rate).toBe(16.125);
    });

    it("kein Hinweis und kein Übernehmen-Knopf bei einem neuen Eintrag", () => {
      seed([], ABC);
      open(null);
      tap("Lager Süd");
      expect(hint()).toBeNull();
      expect(useJob()).toBeNull();
    });

    it("8b: erneutes Antippen desselben Jobs setzt den Vorschlag nicht neu", () => {
      seed([], ABC);
      open(null);
      expect(rateField().value).toBe("14,00");
      // Der Satz des Jobs ändert sich im Hintergrund; die Eingabe bleibt trotzdem stehen.
      act(() => {
        saveJob({ ...ALPHA, rate: 15 });
      });
      expect(rateField().value).toBe("14,00");
      tap("Reinigung Nord");
      expect(rateField().value).toBe("14,00");
    });
  });

  describe("ausdrückliche Übernahme des Job-Satzes", () => {
    it("11: Knopf erst nach dem Jobwechsel, nie durch die Auswahl; Übernahme setzt den Satz", () => {
      seed([shiftWith(12.345)], ABC);
      open("s1");
      expect(useJob()).toBeNull();
      tap("Lager Süd");
      expect(rateField().value).toBe("12,35"); // die Auswahl allein ändert nichts
      const button = useJob();
      expect(button?.tagName).toBe("BUTTON");
      expect(button?.textContent?.trim()).toBe("Satz von „Lager Süd“ verwenden: 16,125\u00a0€");
      click(button);
      expect(rateField().value).toBe("16,13");
      expect(useJob()).toBeNull();
      expect(hint()).toBeNull(); // der alte exakte Wert gilt nicht mehr
      save();
      expect(row().rate).toBe(16.125);
      expect(row().jobId).toBe("j2");
      close();
      open("s1");
      expect(rateField().value).toBe("16,13");
      // Der übernommene Satz ist jetzt der gespeicherte Satz des Eintrags: K1 zeigt seinen exakten Wert.
      expect(hint()?.textContent).toContain("16,125\u00a0€");
      expect(useJob()).toBeNull();
      save();
      expect(row().rate).toBe(16.125);
    });

    it("11b: zweite Eingabestelle: Übernahme funktioniert im Block Mehr", () => {
      seed([shiftWith(12.345)], [M1J, M2J]);
      open("s1");
      more();
      tap("Monat Zwei");
      expect(useJob()?.textContent).toContain("16,00\u00a0€");
      click(useJob());
      expect(rateField().value).toBe("16,00");
      expect(useJob()).toBeNull();
      save();
      expect(row().rate).toBe(16);
      expect(row().jobId).toBe("j2");
    });

    it("11c: nach der Übernahme zählt eine weitere Eingabe wieder normal, halb aufgerundet", () => {
      seed([shiftWith(12.345)], ABC);
      open("s1");
      tap("Lager Süd");
      click(useJob());
      setValue(rateField(), "20,005");
      blur(rateField());
      save();
      expect(row().rate).toBe(20.01);
    });

    it("11d: Übernahme gilt als bewusste Änderung: M1 hält den neuen Wert", () => {
      seed([shiftWith(12.345)], ABC);
      open("s1");
      tap("Lager Süd");
      click(useJob());
      setValue(rateField(), "");
      setValue(rateField(), "16,13");
      save();
      expect(row().rate).toBe(16.125);
    });

    it("12: Übernahme, dann Abbrechen speichert nichts", () => {
      seed([shiftWith(12.345)], ABC);
      const before = JSON.stringify(getData().shifts);
      open("s1");
      tap("Lager Süd");
      click(useJob());
      click(cancelButton());
      close();
      expect(JSON.stringify(getData().shifts)).toBe(before);
    });

    it("13: Zurück zum ursprünglichen Job: kein Knopf, der exakte Wert gilt wieder", () => {
      seed([shiftWith(12.345)], ABC);
      open("s1");
      tap("Lager Süd");
      expect(useJob()).not.toBeNull();
      tap("Reinigung Nord");
      expect(useJob()).toBeNull();
      expect(hint()).not.toBeNull();
      save();
      expect(row().rate).toBe(12.345);
    });

    it("13b: Job-Satz gleich dem Satz des Eintrags: kein Knopf", () => {
      seed([shiftWith(14)], ABC);
      open("s1");
      tap("Lager Süd");
      expect(useJob()).not.toBeNull();
      tap("Reinigung Nord");
      expect(useJob()).toBeNull();
    });

    it("Knopf ist eine echte Schaltfläche mit Namen und ohne Wirkung auf den Satz, solange nicht gedrückt", () => {
      seed([shiftWith(12.345)], ABC);
      open("s1");
      tap("Lager Süd");
      const button = useJob();
      expect(button?.getAttribute("type")).toBe("button");
      expect(button?.disabled).toBe(false);
      expect(button?.className).toContain("focus-visible:ring");
      save();
      expect(row().rate).toBe(12.345);
    });

    describe.each([
      ["de", "Satz von „Lager Süd“ verwenden: 16,125\u00a0€"],
      ["en", "Use rate from Lager Süd: 16,125\u00a0€"],
      ["ru", "Использовать ставку из «Lager Süd»: 16,125\u00a0€"],
      ["tr", "Lager Süd işinin ücretini kullan: 16,125\u00a0€"],
      ["pl", "Użyj stawki z „Lager Süd”: 16,125\u00a0€"],
    ])("Sprache %s", (lang, text) => {
      it("Beschriftung und Übernahme", () => {
        act(() => {
          activateScope(DEMO_SCOPE);
          replaceAll({
            ...EMPTY_DATA,
            jobs: ABC,
            shifts: [shiftWith(12.345)],
            settings: {
              ...DEFAULT_SETTINGS,
              onboarded: true,
              localDemoMode: true,
              activeJobId: "j1",
              language: lang,
            },
          } as never);
        });
        open("s1");
        tap("Lager Süd");
        expect(useJob()?.textContent?.trim()).toBe(text);
        click(useJob());
        save();
        expect(row().rate).toBe(16.125);
      });
    });
  });

  describe("Formular wird während der Bearbeitung nicht zurückgesetzt", () => {
    const typedSession = () => {
      seed([shiftWith(12.345)], ABC);
      open("s1");
      setValue(rateField(), "99,5");
      setValue(q<HTMLInputElement>("#bis"), "16:00");
    };
    const stillTyped = () => {
      expect(rateField().value).toBe("99,5");
      expect(q<HTMLInputElement>("#bis").value).toBe("16:00");
    };

    it("ein Cloud-Abgleich, der die Jobs ersetzt, löscht die Eingaben nicht", () => {
      typedSession();
      act(() => {
        replaceAll({ ...getData() });
      });
      stillTyped();
      save();
      expect(row().rate).toBe(99.5);
      expect(row().end).toBe("16:00");
    });

    it("ein umbenannter anderer Job löscht die Eingaben nicht", () => {
      typedSession();
      act(() => {
        saveJob({ ...BETA, name: "Lager Süd 2" });
      });
      stillTyped();
    });

    it("geänderter Standardsatz, aktiver Job oder Bundesland löschen die Eingaben nicht", () => {
      typedSession();
      act(() => {
        updateSettings({ defaultRate: 15 });
      });
      stillTyped();
      act(() => {
        updateSettings({ activeJobId: "j2" });
      });
      stillTyped();
      act(() => {
        updateSettings({ bundesland: "BY" });
      });
      stillTyped();
    });

    it("erneutes Öffnen befüllt das Formular wieder aus dem gespeicherten Eintrag", () => {
      typedSession();
      close();
      open("s1");
      expect(rateField().value).toBe("12,35");
      expect(q<HTMLInputElement>("#bis").value).toBe("17:00");
    });

    it("ein anderer Eintrag befüllt das Formular neu", () => {
      seed([shiftWith(12.345), shiftWith(13.5, { id: "s2", start: "06:00", end: "07:00" })], ABC);
      open("s1");
      setValue(rateField(), "99,5");
      open("s2");
      expect(rateField().value).toBe("13,50");
      expect(q<HTMLInputElement>("#von").value).toBe("06:00");
    });
  });
});
