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

  // NEW-01 (Option B): Ein Jobwechsel ersetzt eine eigene Eingabe NICHT mehr. Geprueft bleibt,
  // dass der Jobwechsel den Job wechselt und dass der Satz nach K1 kaufmaennisch gerundet wird -
  // nur eben der selbst getippte Wert statt des Vorschlags.
  it("ein Jobwechsel nach einer Eingabe laesst die Eingabe stehen (K1-Rundung bleibt)", () => {
    seed([], JOBS);
    open(null);
    setValue(rateField(), "20,555");
    click(jobButton("Lager Süd"));
    expect(rateField().value).toBe("20,555");
    blur(rateField());
    expect(rateField().value).toBe("20,56");
    save();
    expect(onlyShift().jobId).toBe("j2");
    expect(onlyShift().rate).toBe(20.56);
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

/**
 * NEW-01 (Option B): Ein Jobwechsel aendert nur den Job.
 *
 * Vorher ersetzte jeder Klick auf einen Job den Lohnsatz durch den Vorschlag des neuen Jobs - der
 * exakte gespeicherte Satz eines bestehenden Eintrags (12.345) und eine selbst getippte, noch nicht
 * gespeicherte Eingabe gingen dabei still verloren. Jetzt gilt:
 *  - bestehender Eintrag: der Satz bleibt unberuehrt (auch ohne Satz bleibt er ungesetzt),
 *  - neuer Eintrag: nur ein noch unberuehrtes Feld folgt dem Vorschlag des Jobs,
 *  - derselbe Job: vollstaendiges No-op (kein Satz, keine Zeiten),
 *  - der Satz des gewaehlten Jobs wird nur auf ausdrueckliches Antippen uebernommen.
 *
 * K1 bleibt unangetastet: unberuehrte Saetze exakt, eigene Eingaben kaufmaennisch gerundet,
 * Abbrechen speichert nichts, der Hinweis auf den gespeicherten Satz bleibt richtig.
 */
describe("NEW-01 Jobwechsel ruehrt den Lohnsatz nicht an", () => {
  const A = "Reinigung Nord";
  const B = "Lager Süd";
  const PAIR: Job[] = [
    { id: "j1", name: A, color: "#0d9488", mode: "flex", rate: 13.999 },
    { id: "j2", name: B, color: "#2563eb", mode: "flex", rate: 16.125 },
  ];
  /** Zweite Eingabestelle: Selbststaendige sehen das Satz-Feld erst unter "Weitere Angaben". */
  const PAIR_SELF: Job[] = PAIR.map((j) => ({ ...j, mode: "selbststaendig" }) as Job);

  const hint = () => maybe('[data-testid="entry-rate-exact"]');
  const accept = () => maybe<HTMLButtonElement>('[data-testid="entry-rate-accept"]');
  const useJob = () => maybe<HTMLButtonElement>('[data-testid="entry-rate-use-job"]');
  const cancelButton = () => q('[data-testid="entry-save"]').previousElementSibling;
  const times = () => [q<HTMLInputElement>("#von").value, q<HTMLInputElement>("#bis").value];
  /** Nur die Job-Auswahl (aria-pressed), nie der Uebernahme-Knopf mit demselben Jobnamen. */
  const jobChip = (name: string) =>
    [...document.querySelectorAll("button[aria-pressed]")].find((b) =>
      b.textContent?.includes(name),
    );

  describe.each([
    ["erste Eingabestelle", false, PAIR],
    ["zweite Eingabestelle", true, PAIR_SELF],
  ] as Array<[string, boolean, Job[]]>)("%s", (_label, second, pair) => {
    const start = (shifts: Shift[], id: string | null) => {
      seed(shifts, pair);
      open(id);
      if (second) click(q('[data-testid="entry-more-toggle"]'));
    };
    const reopen = (id: string) => {
      act(() => root.render(createElement("div")));
      open(id);
      if (second) click(q('[data-testid="entry-more-toggle"]'));
    };

    it("(1) gespeicherte 12.345: A -> B -> A und speichern bleibt exakt", () => {
      start([shiftWith(12.345)], "s1");
      expect(rateField().value).toBe("12,35");
      click(jobChip(B));
      expect(rateField().value).toBe("12,35");
      click(jobChip(A));
      expect(rateField().value).toBe("12,35");
      save();
      expect(stored()?.rate).toBe(12.345);
      expect(stored()?.jobId).toBe("j1");
    });

    it("(2) gespeicherte 12.345, getippt 99,5, dann Jobwechsel: der eigene Wert bleibt", () => {
      start([shiftWith(12.345)], "s1");
      setValue(rateField(), "99,5");
      click(jobChip(B));
      expect(rateField().value).toBe("99,5");
      blur(rateField());
      expect(rateField().value).toBe("99,50");
      save();
      expect(stored()?.rate).toBe(99.5);
      expect(stored()?.jobId).toBe("j2");
    });

    it("(3) Eintrag ohne eigenen Satz: der Jobwechsel legt keinen an", () => {
      start([shiftWith(undefined)], "s1");
      expect(rateField().value).toBe("");
      click(jobChip(B));
      expect(rateField().value).toBe("");
      save();
      const row = stored() as Shift;
      expect("rate" in row).toBe(false);
      expect(row.jobId).toBe("j2");
      // Der Satz ergibt sich weiter aus dem gewaehlten Job (Prioritaet Schicht > Job > Standard).
      expect(effectiveShiftRate(row, { job: pair[1]!, defaultRate: 9 })).toBe(16.125);
    });

    it("(4) Abbrechen nach dem Jobwechsel speichert nichts", () => {
      start([shiftWith(12.345)], "s1");
      const before = JSON.stringify(getData().shifts);
      click(jobChip(B));
      setValue(rateField(), "77");
      click(cancelButton());
      act(() => root.render(createElement("div")));
      expect(JSON.stringify(getData().shifts)).toBe(before);
      expect(stored()?.rate).toBe(12.345);
      expect(stored()?.jobId).toBe("j1");
    });

    it("(5) neuer Eintrag: der Vorschlag folgt dem Job, solange nichts getippt wurde", () => {
      start([], null);
      expect(rateField().value).toBe("14,00");
      click(jobChip(B));
      expect(rateField().value).toBe("16,13");
      // Nichts zu uebernehmen: der Satz IST schon der des Jobs.
      expect(useJob()).toBeNull();
      save();
      expect(onlyShift().rate).toBe(16.125);
      expect(onlyShift().jobId).toBe("j2");
    });

    it("(6) neuer Eintrag: getippte 18 uebersteht den Jobwechsel", () => {
      start([], null);
      setValue(rateField(), "18");
      click(jobChip(B));
      expect(rateField().value).toBe("18");
      save();
      expect(onlyShift().rate).toBe(18);
      expect(onlyShift().jobId).toBe("j2");
    });

    it.each([12.3456, 13.999, 0.001, 14.006, 12.345])(
      "(7) exakt gespeicherte %s uebersteht den Jobwechsel",
      (rate) => {
        start([shiftWith(rate)], "s1");
        click(jobChip(B));
        save();
        expect(stored()?.rate).toBe(rate);
      },
    );

    it("(8) derselbe Job: kein Satzwechsel und kein neues Zeit-Seeding", () => {
      start([shiftWith(14, { id: "a", start: "08:00", end: "10:30" })], null);
      // A1: Der Anschluss hat den Beginn vorbelegt, das Ende bleibt leer.
      expect(times()).toEqual(["10:30", ""]);
      setValue(rateField(), "17,5");
      click(jobChip(A));
      expect(rateField().value).toBe("17,5");
      expect(times()).toEqual(["10:30", ""]);
      expect(useJob()).toBeNull();
      setValue(q<HTMLInputElement>("#bis"), "12:00");
      save();
      const added = getData().shifts.find((x) => x.id !== "a") as Shift;
      expect(added.rate).toBe(17.5);
      expect(added.jobId).toBe("j1");
    });

    it("(11) Satz des Jobs ausdruecklich uebernehmen: exakt und als Aenderung gewertet", () => {
      start([shiftWith(12.345)], "s1");
      expect(hint()).not.toBeNull();
      click(jobChip(B));
      const button = useJob();
      expect(button?.tagName).toBe("BUTTON");
      expect(button?.textContent).toContain("16,125 €");
      click(button);
      expect(rateField().value).toBe("16,13");
      // Der gespeicherte Satz des Eintrags gilt nicht mehr: kein Hinweis, kein Angebot.
      expect(hint()).toBeNull();
      expect(accept()).toBeNull();
      expect(useJob()).toBeNull();
      save();
      expect(stored()?.rate).toBe(16.125);
      expect(stored()?.jobId).toBe("j2");
    });

    it("(12) Uebernahme und dann Abbrechen speichert nichts", () => {
      start([shiftWith(12.345)], "s1");
      const before = JSON.stringify(getData().shifts);
      click(jobChip(B));
      click(useJob());
      click(cancelButton());
      act(() => root.render(createElement("div")));
      expect(JSON.stringify(getData().shifts)).toBe(before);
      expect(stored()?.rate).toBe(12.345);
    });

    it("(13) der K1-Hinweis bleibt beim Jobwechsel und endet erst mit der Uebernahme", () => {
      start([shiftWith(12.345)], "s1");
      expect(hint()?.textContent).toContain("12,345 €");
      click(jobChip(B));
      // Der gespeicherte Satz gilt weiter -> der Hinweis bleibt richtig stehen.
      expect(hint()?.textContent).toContain("12,345 €");
      expect(accept()).not.toBeNull();
      expect(useJob()).not.toBeNull();
      // Zurueck zum Ausgangsjob: nichts mehr zu uebernehmen, der Hinweis bleibt.
      click(jobChip(A));
      expect(useJob()).toBeNull();
      expect(hint()?.textContent).toContain("12,345 €");
      click(jobChip(B));
      click(useJob());
      expect(hint()).toBeNull();
    });

    it("(14) erneutes Oeffnen und Speichern bewahrt das Ergebnis", () => {
      start([shiftWith(12.345)], "s1");
      click(jobChip(B));
      click(useJob());
      save();
      expect(stored()?.rate).toBe(16.125);
      reopen("s1");
      expect(rateField().value).toBe("16,13");
      // Jetzt ist 16.125 der gespeicherte Satz - K1 zeigt wieder seinen exakten Wert.
      expect(hint()?.textContent).toContain("16,125 €");
      expect(useJob()).toBeNull();
      save();
      expect(stored()?.rate).toBe(16.125);
      expect(stored()?.jobId).toBe("j2");
    });

    it("neuer Eintrag: nach eigener Eingabe laesst sich der Job-Satz ausdruecklich holen", () => {
      start([], null);
      setValue(rateField(), "18");
      click(jobChip(B));
      expect(useJob()?.textContent).toContain("16,125 €");
      click(useJob());
      expect(rateField().value).toBe("16,13");
      save();
      expect(onlyShift().rate).toBe(16.125);
    });

    it("nach der Uebernahme zaehlt eine Eingabe wieder als Bearbeitung (K1-Rundung)", () => {
      start([shiftWith(12.345)], "s1");
      click(jobChip(B));
      click(useJob());
      setValue(rateField(), "15,555");
      blur(rateField());
      save();
      expect(stored()?.rate).toBe(15.56);
    });

    it("Oeffnen ohne Jobwechsel zeigt kein Angebot, auch wenn der Job anders zahlt", () => {
      start([shiftWith(12.345)], "s1");
      expect(useJob()).toBeNull();
      save();
      expect(stored()?.rate).toBe(12.345);
    });
  });

  it("(9) Monatslohn-Job: der Wechsel auf einen Stundenlohn-Job ersetzt den Satz nicht", () => {
    const monthly = {
      id: "j1",
      name: "Büro Monatslohn",
      color: "#2563eb",
      mode: "fest",
      payType: "monthly",
      monthlyGross: 3000,
      week: EMPTY_WEEK,
    } as Job;
    const hourly: Job = { id: "j2", name: B, color: "#0d9488", mode: "flex", rate: 16.125 };
    seed([shiftWith(12.345)], [monthly, hourly]);
    open("s1");
    // Beim Monatslohn-Job ist das Satz-Feld nicht sichtbar.
    expect(maybe("#lohn")).toBeNull();
    click(jobChip(B));
    // Der Wechsel macht das Feld sichtbar - mit dem UNVERAENDERTEN Satz des Eintrags.
    expect(rateField().value).toBe("12,35");
    save();
    expect(stored()?.rate).toBe(12.345);
    expect(stored()?.jobId).toBe("j2");
  });

  it("(9) Wechsel AUF einen Monatslohn-Job: der Satz bleibt, obwohl das Feld verschwindet", () => {
    const monthly = {
      id: "j1",
      name: "Büro Monatslohn",
      color: "#2563eb",
      mode: "fest",
      payType: "monthly",
      monthlyGross: 3000,
      week: EMPTY_WEEK,
    } as Job;
    const hourly: Job = { id: "j2", name: B, color: "#0d9488", mode: "flex", rate: 16.125 };
    seed([shiftWith(12.345, { jobId: "j2" })], [monthly, hourly]);
    open("s1");
    expect(rateField().value).toBe("12,35");
    click(jobChip("Büro Monatslohn"));
    expect(maybe("#lohn")).toBeNull();
    save();
    expect(stored()?.rate).toBe(12.345);
    expect(stored()?.jobId).toBe("j1");
  });

  it("der Knopf ist ein echter Button mit Namen, per Tastatur ausloesbar und vom Feld getrennt", () => {
    seed([shiftWith(12.345)], PAIR);
    open("s1");
    click(jobChip(B));
    const el = useJob();
    expect(el?.tagName).toBe("BUTTON");
    expect(el?.getAttribute("type")).toBe("button");
    expect(el?.textContent?.trim()).toBe("Satz von Lager Süd übernehmen: 16,125 €");
    expect(el?.disabled).toBe(false);
    expect(el?.className).toContain("focus-visible:ring");
    // Der Knopf steht neben dem Feld, nicht in dessen Beschreibung (aria-describedby).
    expect(rateField().getAttribute("aria-describedby")).toBe(hint()?.id);
    expect(hint()?.contains(el as Node)).toBe(false);
    // Enter/Leertaste loesen bei einem <button> den Klick aus; ein Klick genuegt.
    click(el);
    expect(useJob()).toBeNull();
  });

  describe.each([
    ["de", "Satz von Lager Süd übernehmen: 16,125 €"],
    ["en", "Use rate from Lager Süd: 16,125 €"],
    ["ru", "Взять ставку из Lager Süd: 16,125 €"],
    ["tr", "Lager Süd işinin ücretini kullan: 16,125 €"],
    ["pl", "Użyj stawki z Lager Süd: 16,125 €"],
  ])("Sprache %s", (lang, text) => {
    it.each([false, true])("Beschriftung und Uebernahme (zweite Stelle: %s)", (second) => {
      const pair = second ? PAIR_SELF : PAIR;
      act(() => {
        activateScope(DEMO_SCOPE);
        replaceAll({
          ...EMPTY_DATA,
          jobs: pair,
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
      if (second) click(q('[data-testid="entry-more-toggle"]'));
      click(jobChip(B));
      expect(useJob()?.textContent?.trim()).toBe(text);
      click(useJob());
      save();
      expect(stored()?.rate).toBe(16.125);
    });
  });
});

/**
 * NEW-01/INIT: Das Befuellen des Formulars haengt an der Prop `jobs`. Liefert die Eltern-Komponente
 * beim Neu-Rendern eine NEUE Array-Referenz mit gleichem Inhalt (ueblich bei abgeleiteten Listen),
 * lief der Init-Effekt erneut und setzte den gesamten Editor zurueck - mitten im Bearbeiten.
 */
describe("NEW-01/INIT neue jobs-Referenz setzt das offene Formular nicht zurueck", () => {
  const PAIR: Job[] = [
    { id: "j1", name: "Reinigung Nord", color: "#0d9488", mode: "flex", rate: 13.999 },
    { id: "j2", name: "Lager Süd", color: "#2563eb", mode: "flex", rate: 16.125 },
  ];

  /** Jede neue `rev` liefert eine frische jobs-Referenz mit identischem Inhalt. */
  function FreshJobsHarness(props: { shiftId: string | null; rev: number }) {
    const d = useAppData();
    const shift = props.shiftId ? (d.shifts.find((s) => s.id === props.shiftId) ?? null) : null;
    return createElement(ShiftDialog, {
      open: true,
      onOpenChange: () => undefined,
      date: DAY,
      shift,
      shiftId: props.shiftId,
      jobs: d.jobs.map((j) => ({ ...j })),
      customers: d.customers,
      projects: d.projects,
      settings: d.settings,
      objects: d.objects,
      history: d.shifts,
    });
  }

  const render = (rev: number) =>
    act(() => root.render(createElement(FreshJobsHarness, { shiftId: "s1", rev })));

  it("Eingaben, Job und Satz ueberleben ein Neu-Rendern der Eltern", () => {
    seed([shiftWith(12.345)], PAIR);
    render(1);
    expect(rateField().value).toBe("12,35");
    setValue(rateField(), "19,5");
    setValue(q<HTMLInputElement>("#bis"), "16:00");
    click(
      [...document.querySelectorAll("button[aria-pressed]")].find((b) =>
        b.textContent?.includes("Lager Süd"),
      ),
    );
    render(2);
    expect(rateField().value).toBe("19,5");
    expect(q<HTMLInputElement>("#bis").value).toBe("16:00");
    save();
    expect(stored()?.rate).toBe(19.5);
    expect(stored()?.jobId).toBe("j2");
  });

  it("ein unberuehrter exakter Satz bleibt ueber ein Neu-Rendern exakt", () => {
    seed([shiftWith(12.345)], PAIR);
    render(1);
    render(2);
    render(3);
    save();
    expect(stored()?.rate).toBe(12.345);
  });
});
