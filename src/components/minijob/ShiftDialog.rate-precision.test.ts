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

  it("ein Jobwechsel nach einer Eingabe ersetzt sie durch den exakten Vorschlag", () => {
    seed([], JOBS);
    open(null);
    setValue(rateField(), "20,555");
    click(jobButton("Lager Süd"));
    expect(rateField().value).toBe("16,13");
    blur(rateField());
    save();
    expect(onlyShift().rate).toBe(16.125);
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
