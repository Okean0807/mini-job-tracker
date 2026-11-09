/**
 * Paket A im echten Editor (react-dom/client + act, happy-dom, ECHTER Store im Testmodus-Scope):
 * Zeit-Anschluss, manuelle Tätigkeit, Vorschläge je Job, "Letzten Eintrag übernehmen" und die
 * Prüfungen vor dem Speichern.
 *
 * Geprüft wird der gespeicherte Bestand, nicht nur die Oberfläche: kein Eintrag darf durch einen
 * Vorschlag verändert werden, und ein blockierter Fall darf nichts speichern.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ShiftDialog } from "./ShiftDialog";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
  useAppData,
} from "@/lib/minijob/store";
import { DEFAULT_SETTINGS, type Shift } from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = "2026-09-24";
const PREV = "2026-09-23";

let container: HTMLDivElement;
let root: Root;
let closed = 0;

function Harness({ shiftId, date }: { shiftId: string | null; date: string }) {
  const data = useAppData();
  const shift = shiftId ? (data.shifts.find((s) => s.id === shiftId) ?? null) : null;
  return createElement(ShiftDialog, {
    open: true,
    onOpenChange: (open: boolean) => {
      if (!open) closed += 1;
    },
    date,
    shift,
    shiftId,
    jobs: data.jobs,
    customers: data.customers,
    projects: data.projects,
    settings: data.settings,
    objects: data.objects,
    history: data.shifts,
  });
}

function open(shiftId: string | null, date = DAY) {
  act(() => {
    root.render(createElement(Harness, { shiftId, date }));
  });
}

function q<T extends Element = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
}

function maybe<T extends Element = HTMLElement>(sel: string): T | null {
  return document.querySelector<T>(sel);
}

function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const proto =
      el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function click(el: Element | null) {
  if (!el) throw new Error("missing element to click");
  act(() => {
    (el as HTMLElement).click();
  });
}

function save() {
  click(q('[data-testid="entry-save"]'));
}

function unmount() {
  act(() => root.render(createElement("div")));
}

function byText(fragment: string): HTMLElement | undefined {
  return [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(fragment));
}

const work = (partial: Partial<Shift> & { id: string }): Shift =>
  ({
    kind: "arbeit",
    date: DAY,
    start: "08:00",
    end: "10:30",
    breakMinutes: 0,
    jobId: "j1",
    ...partial,
  }) as Shift;

function seed(shifts: Shift[], extra: Partial<typeof EMPTY_DATA> = {}) {
  act(() => {
    activateScope(DEMO_SCOPE);
    replaceAll({
      ...EMPTY_DATA,
      jobs: [
        { id: "j1", name: "Reinigung Nord", color: "#0d9488", mode: "flex", rate: 14 },
        { id: "j2", name: "Lager Süd", color: "#2563eb", mode: "flex", rate: 16 },
      ],
      objects: [
        {
          id: "obj-1",
          name: "Bürohaus Mitte",
          street: "Hauptstraße",
          houseNo: "5",
          zip: "10115",
          city: "Berlin",
        },
      ],
      shifts,
      settings: { ...DEFAULT_SETTINGS, onboarded: true, localDemoMode: true, activeJobId: "j1" },
      ...extra,
    } as never);
  });
}

beforeEach(() => {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
  loadFromStorage();
  closed = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("A1 Zeit-Anschluss im Editor", () => {
  it("(1) erster Eintrag des Tages: unveränderte Vorgaben, kein Anschluss-Hinweis", () => {
    seed([]);
    open(null);
    expect(q<HTMLInputElement>("#von").value).toBe("09:00");
    expect(q<HTMLInputElement>("#bis").value).toBe("17:00");
    expect(maybe('[data-testid="entry-continuation-hint"]')).toBeNull();
    expect(maybe('[data-testid="entry-continuation-apply"]')).toBeNull();
  });

  it("(2) zweiter Eintrag: Beginn ist das Ende des vorigen Eintrags, das Ende bleibt leer", () => {
    seed([work({ id: "a", start: "08:00", end: "10:30" })]);
    open(null);
    expect(q<HTMLInputElement>("#von").value).toBe("10:30");
    expect(q<HTMLInputElement>("#bis").value).toBe("");
    expect(q('[data-testid="entry-continuation-hint"]').textContent).toContain("08:00");
    expect(q('[data-testid="entry-continuation-hint"]').textContent).toContain("10:30");
    // Ohne Ende gibt es keine erfundene Dauer.
    expect(q('[data-testid="entry-duration"]').textContent).toBe("–");

    setValue(q<HTMLInputElement>("#bis"), "13:15");
    save();
    const added = getData().shifts.find((s) => s.id !== "a")!;
    expect(added).toMatchObject({ start: "10:30", end: "13:15", jobId: "j1", date: DAY });
    // Der bestehende Eintrag bleibt unverändert.
    expect(getData().shifts.find((s) => s.id === "a")).toMatchObject({
      start: "08:00",
      end: "10:30",
    });
  });

  it("(3) dritter Eintrag in Folge: Beginn ist das chronologisch letzte Ende", () => {
    seed([
      work({ id: "a", start: "08:00", end: "10:30" }),
      work({ id: "b", start: "10:30", end: "13:15" }),
    ]);
    open(null);
    expect(q<HTMLInputElement>("#von").value).toBe("13:15");
    setValue(q<HTMLInputElement>("#bis"), "15:00");
    save();
    expect(getData().shifts).toHaveLength(3);
    expect(getData().shifts.find((s) => s.id !== "a" && s.id !== "b")).toMatchObject({
      start: "13:15",
      end: "15:00",
    });
  });

  it("(4) ein selbst gesetzter Beginn wird nie von einem Vorschlag überschrieben", () => {
    seed([work({ id: "a", start: "08:00", end: "10:30" })]);
    open(null);
    setValue(q<HTMLInputElement>("#von"), "11:00");
    // Jobwechsel und zurück: der eigene Wert bleibt stehen.
    click(byText("Lager Süd")!);
    expect(q<HTMLInputElement>("#von").value).toBe("11:00");
    click(byText("Reinigung Nord")!);
    expect(q<HTMLInputElement>("#von").value).toBe("11:00");
    // Der Vorschlag bleibt als antippbare Aktion erreichbar.
    expect(q('[data-testid="entry-continuation-apply"]').textContent).toContain("10:30");
  });

  it("(5) Pause zwischen zwei Einträgen: späterer Beginn, keine Rückfrage, keine Überschneidung", () => {
    seed([work({ id: "a", start: "08:00", end: "10:30" })]);
    open(null);
    setValue(q<HTMLInputElement>("#von"), "11:00");
    setValue(q<HTMLInputElement>("#bis"), "14:00");
    save();
    expect(maybe('[data-testid="entry-confirm-dialog"]')).toBeNull();
    expect(getData().shifts.find((s) => s.id !== "a")).toMatchObject({
      start: "11:00",
      end: "14:00",
    });
  });

  it("der Anschluss-Vorschlag lässt sich ausdrücklich übernehmen", () => {
    seed([work({ id: "a", start: "08:00", end: "10:30" })]);
    open(null);
    setValue(q<HTMLInputElement>("#von"), "12:00");
    click(q('[data-testid="entry-continuation-apply"]'));
    expect(q<HTMLInputElement>("#von").value).toBe("10:30");
  });

  it("(6) mehrere Jobs am selben Tag: der Anschluss folgt dem gewählten Job", () => {
    seed([
      work({ id: "a", jobId: "j1", start: "08:00", end: "10:30" }),
      work({ id: "b", jobId: "j2", start: "11:00", end: "19:00" }),
    ]);
    open(null);
    expect(q<HTMLInputElement>("#von").value).toBe("10:30");
    click(byText("Lager Süd")!);
    expect(q<HTMLInputElement>("#von").value).toBe("19:00");
  });

  it("(13) Nachtschicht des Vortags: Anschluss am Morgen, Hinweis auf den Folgetag beim Speichern", () => {
    seed([work({ id: "a", date: PREV, start: "22:00", end: "02:00" })]);
    open(null);
    expect(q<HTMLInputElement>("#von").value).toBe("02:00");
    setValue(q<HTMLInputElement>("#bis"), "06:00");
    save();
    expect(maybe('[data-testid="entry-confirm-dialog"]')).toBeNull();
    expect(getData().shifts.find((s) => s.id !== "a")).toMatchObject({
      date: DAY,
      start: "02:00",
      end: "06:00",
    });
  });

  it("(13) eine neue Nachtschicht wird als 'Ende am Folgetag' gemeldet und ohne Rückfrage gespeichert", () => {
    seed([]);
    open(null);
    setValue(q<HTMLInputElement>("#von"), "22:00");
    setValue(q<HTMLInputElement>("#bis"), "02:00");
    expect(q('[data-testid="entry-time-info"]').textContent).toContain("Folgetag");
    save();
    expect(maybe('[data-testid="entry-confirm-dialog"]')).toBeNull();
    expect(getData().shifts[0]).toMatchObject({ start: "22:00", end: "02:00" });
  });

  it("beim Bearbeiten wird nie ein Anschluss vorgeschlagen", () => {
    seed([
      work({ id: "a", start: "08:00", end: "10:30" }),
      work({ id: "b", start: "12:00", end: "14:00" }),
    ]);
    open("b");
    expect(q<HTMLInputElement>("#von").value).toBe("12:00");
    expect(q<HTMLInputElement>("#bis").value).toBe("14:00");
    expect(maybe('[data-testid="entry-continuation-hint"]')).toBeNull();
    expect(maybe('[data-testid="entry-continuation-apply"]')).toBeNull();
  });

  it("Abwesenheiten bekommen keinen Anschluss und behalten ihre Zeiten", () => {
    seed([work({ id: "a", start: "08:00", end: "10:30" })]);
    open(null);
    click(q('[data-kind="urlaub"]'));
    expect(maybe('[data-testid="entry-continuation-hint"]')).toBeNull();
    save();
    const added = getData().shifts.find((s) => s.id !== "a")!;
    expect(added.kind).toBe("urlaub");
    expect(added.start).toBe("09:00");
    expect(added.end).toBe("17:00");
  });
});

describe("A2 manuelle Tätigkeit (ohne KI)", () => {
  it("(8) das Eingabefeld ist ohne Zwischenschritt sichtbar und speichert den Text", () => {
    seed([]);
    open(null);
    const input = q<HTMLInputElement>('[data-testid="custom-task-input"]');
    expect(input.closest(".hidden")).toBeNull();
    expect(byText("Neue Tätigkeit")).toBeUndefined();
    setValue(input, "Treppenhaus wischen");
    save();
    expect(getData().shifts[0]!.tasks).toEqual(["Treppenhaus wischen"]);
  });

  it("(8) es gibt keine KI-Umschaltung und keinen KI-Knopf im Editor", () => {
    seed([]);
    open(null);
    const text = q('[data-testid="shift-dialog"]').textContent ?? "";
    expect(text).not.toMatch(/KI|AI/);
  });
});

describe("A3 Tätigkeits-Vorschläge je Job", () => {
  const history = [
    work({ id: "h1", date: "2026-09-10", tasks: ["Fenster", "Treppenhaus"] }),
    work({ id: "h2", date: "2026-09-17", tasks: ["Fenster"] }),
    work({ id: "h3", date: "2026-09-20", tasks: ["Küche"] }),
    work({ id: "h4", date: "2026-09-21", jobId: "j2", tasks: ["Palette"] }),
  ];

  it("(7) 'Zuletzt' und 'Häufig' stammen aus der Historie des gewählten Jobs", () => {
    seed(history);
    open(null);
    expect(q('[data-testid="task-group-last"]').textContent).toContain("Küche");
    expect(q('[data-testid="task-group-frequent"]').textContent).toContain("Fenster");
    expect(q('[data-testid="task-group-last"]').textContent).not.toContain("Palette");
  });

  it("(7) ein Vorschlag wird durch Tippen übernommen und ist danach kein Vorschlag mehr", () => {
    seed(history);
    open(null);
    click(byText("Küche")!);
    expect(q('[data-testid="entry-tasks"]').getAttribute("data-task-count")).toBe("1");
    expect(maybe('[data-testid="task-group-last"]')?.textContent ?? "").not.toContain("Küche");
    setValue(q<HTMLInputElement>("#bis"), "17:00");
    save();
    expect(getData().shifts.find((s) => !s.id.startsWith("h"))!.tasks).toEqual(["Küche"]);
  });

  it("der Jobwechsel wechselt die Vorschläge", () => {
    seed(history);
    open(null);
    click(byText("Lager Süd")!);
    expect(q('[data-testid="task-group-last"]').textContent).toContain("Palette");
    expect(q('[data-testid="task-group-last"]').textContent).not.toContain("Küche");
  });

  it("Vorschläge sind kein Zwang: ohne Tippen wird nichts gespeichert", () => {
    seed(history);
    open(null);
    setValue(q<HTMLInputElement>("#bis"), "17:00");
    save();
    expect(getData().shifts.find((s) => !s.id.startsWith("h"))!.tasks).toBeUndefined();
  });

  it("das Entfernen einer Tätigkeit aus dem Katalog ändert gespeicherte Einträge nicht", () => {
    seed(history, {
      settings: {
        ...DEFAULT_SETTINGS,
        onboarded: true,
        localDemoMode: true,
        activeJobId: "j1",
        customTasks: [],
      },
    } as never);
    // Die Historie trägt ihre Tätigkeiten weiter, unabhängig vom Katalog.
    expect(getData().shifts.find((s) => s.id === "h1")!.tasks).toEqual(["Fenster", "Treppenhaus"]);
    open(null);
    expect(q('[data-testid="task-group-frequent"]').textContent).toContain("Fenster");
  });
});

describe("A4 Letzten Eintrag übernehmen", () => {
  const last = work({
    id: "last",
    date: "2026-09-20",
    start: "06:00",
    end: "12:00",
    breakMinutes: 45,
    rate: 29,
    note: "Alte Notiz",
    overtime: true,
    objectId: "obj-1",
    workplace: "Bürohaus Mitte",
    street: "Hauptstraße",
    houseNo: "5",
    zip: "10115",
    city: "Berlin",
    workCode: "UR",
    workCodeLabel: "Unterhaltsreinigung",
    tasks: ["Fenster", "Küche"],
  });

  it("(10) übernimmt Objekt, Leistungsart und Tätigkeiten – aber kein Datum, keine Zeiten, keinen Lohn", () => {
    seed([last]);
    open(null);
    const rateBefore = q<HTMLInputElement>("#lohn").value;
    click(q('[data-testid="entry-repeat-last"]'));
    expect(q<HTMLSelectElement>('[data-testid="object-select"]').value).toBe("obj-1");
    expect(q('[data-testid="entry-work-code"]').textContent).toContain("Unterhaltsreinigung");
    expect(q('[data-testid="entry-tasks"]').getAttribute("data-task-count")).toBe("2");
    // Zeiten und Lohn gehören dem neuen Eintrag.
    expect(q<HTMLInputElement>("#von").value).toBe("09:00");
    expect(q<HTMLInputElement>("#bis").value).toBe("17:00");
    expect(q<HTMLInputElement>("#lohn").value).toBe(rateBefore);

    save();
    const added = getData().shifts.find((s) => s.id !== "last")!;
    expect(added.id).not.toBe("last");
    expect(added.date).toBe(DAY);
    expect(added.objectId).toBe("obj-1");
    expect(added.workCode).toBe("UR");
    expect(added.workCodeLabel).toBe("Unterhaltsreinigung");
    expect(added.tasks).toEqual(["Fenster", "Küche"]);
    expect(added.breakMinutes).toBe(45);
    // Keine Finanz- oder Zustandsdaten des alten Eintrags.
    expect(added.rate).not.toBe(29);
    expect(added.note).toBeUndefined();
    expect(added.overtime).toBeUndefined();
    expect(added.start).toBe("09:00");
    expect(added.end).toBe("17:00");
    // Der alte Eintrag ist unverändert.
    expect(getData().shifts.find((s) => s.id === "last")).toMatchObject({
      rate: 29,
      note: "Alte Notiz",
      start: "06:00",
    });
  });

  it("(10) die Aktion erscheint nur für neue Einträge und nur mit Vorgänger", () => {
    seed([]);
    open(null);
    expect(maybe('[data-testid="entry-repeat-last"]')).toBeNull();
    unmount();

    seed([last]);
    open(null);
    expect(maybe('[data-testid="entry-repeat-last"]')).not.toBeNull();
    unmount();
    open("last");
    expect(maybe('[data-testid="entry-repeat-last"]')).toBeNull();
  });

  it("übernimmt die AKTUELLE Adresse des Objekts, nicht die des alten Eintrags", () => {
    seed([last], {
      objects: [
        {
          id: "obj-1",
          name: "Bürohaus Mitte",
          street: "Neue Allee",
          houseNo: "12",
          zip: "10115",
          city: "Berlin",
        },
      ],
    } as never);
    open(null);
    click(q('[data-testid="entry-repeat-last"]'));
    setValue(q<HTMLInputElement>("#bis"), "16:00");
    save();
    const added = getData().shifts.find((s) => s.id !== "last")!;
    expect(added.street).toBe("Neue Allee");
    // Der historische Eintrag behält seinen eigenen Adress-Schnappschuss.
    expect(getData().shifts.find((s) => s.id === "last")!.street).toBe("Hauptstraße");
  });
});

describe("Prüfungen vor dem Speichern", () => {
  it("(15) Dauer 0 wird blockiert und nichts gespeichert", () => {
    seed([]);
    open(null);
    setValue(q<HTMLInputElement>("#bis"), "09:00");
    save();
    expect(getData().shifts).toHaveLength(0);
    expect(closed).toBe(0);
    expect(q('[data-testid="entry-field-error"]').textContent).toContain("keine Arbeitszeit");
  });

  it("(17) Pause länger als die Arbeitszeit wird blockiert", () => {
    seed([]);
    open(null);
    setValue(q<HTMLInputElement>("#von"), "09:00");
    setValue(q<HTMLInputElement>("#bis"), "11:00");
    setValue(q<HTMLInputElement>("#pause"), "180");
    save();
    expect(getData().shifts).toHaveLength(0);
    expect(q('[data-testid="entry-field-error"]').textContent).toContain("Pause");
  });

  it("(14) eine Überschneidung wird erst nach ausdrücklicher Bestätigung gespeichert", () => {
    seed([work({ id: "a", start: "08:00", end: "12:00" })]);
    open(null);
    setValue(q<HTMLInputElement>("#von"), "11:00");
    setValue(q<HTMLInputElement>("#bis"), "15:00");
    save();
    // Erst keine Speicherung, sondern eine Rückfrage.
    expect(getData().shifts).toHaveLength(1);
    const dialog = q('[data-testid="entry-confirm-dialog"]');
    expect(dialog.textContent).toContain("08:00");
    click(q('[data-testid="entry-confirm-save"]'));
    expect(getData().shifts).toHaveLength(2);
    expect(getData().shifts.find((s) => s.id !== "a")).toMatchObject({
      start: "11:00",
      end: "15:00",
    });
  });

  it("(14) die Rückfrage lässt sich abbrechen, ohne zu speichern", () => {
    seed([work({ id: "a", start: "08:00", end: "12:00" })]);
    open(null);
    setValue(q<HTMLInputElement>("#von"), "11:00");
    setValue(q<HTMLInputElement>("#bis"), "15:00");
    save();
    click(byText("Zurück zum Eintrag")!);
    expect(getData().shifts).toHaveLength(1);
    expect(closed).toBe(0);
  });

  it("(16) eine Dublette wird gemeldet und erst nach Bestätigung gespeichert", () => {
    seed([work({ id: "a", start: "09:00", end: "17:00", breakMinutes: 30, rate: 14 })]);
    open(null);
    setValue(q<HTMLInputElement>("#von"), "09:00");
    setValue(q<HTMLInputElement>("#bis"), "17:00");
    setValue(q<HTMLInputElement>("#pause"), "30");
    save();
    expect(getData().shifts).toHaveLength(1);
    expect(q('[data-testid="entry-confirm-dialog"]').textContent).toMatch(/schon gespeichert/);
    click(q('[data-testid="entry-confirm-save"]'));
    expect(getData().shifts).toHaveLength(2);
  });

  it("(18) ein gespeicherter Eintrag liegt im Speicher des aktiven Scopes und übersteht einen Neustart", () => {
    seed([work({ id: "a", start: "08:00", end: "10:30" })]);
    open(null);
    setValue(q<HTMLInputElement>("#bis"), "13:45");
    save();
    const raw = window.localStorage.getItem("minijob-tracker-v1:demo") ?? "";
    expect(raw).toContain("13:45");
    expect(window.localStorage.getItem("minijob-tracker-v1:guest") ?? "").not.toContain("13:45");
    // Neustart: derselbe Bestand wird wieder geladen.
    unmount();
    act(() => {
      activateScope(DEMO_SCOPE);
    });
    expect(getData().shifts.filter((s) => s.date === DAY)).toHaveLength(2);
  });

  it("ein unveränderter bestehender Eintrag lässt sich ohne Rückfrage erneut speichern", () => {
    seed([work({ id: "a", start: "08:00", end: "10:30" })]);
    open("a");
    save();
    expect(maybe('[data-testid="entry-confirm-dialog"]')).toBeNull();
    expect(getData().shifts).toHaveLength(1);
    expect(getData().shifts[0]).toMatchObject({ id: "a", start: "08:00", end: "10:30" });
  });
});

describe("F1 Altbestand im Editor: schon so gespeicherte Pause/Dauer", () => {
  // Historischer Eintrag mit Pause >= Arbeitszeit, so wie er im Bestand liegen kann.
  const legacy = work({
    id: "legacy",
    start: "09:00",
    end: "10:00",
    breakMinutes: 120,
    rate: 13.5,
    createdAt: "2026-01-02",
  });

  function openNote() {
    click(q('[data-testid="entry-more-toggle"]'));
    return q<HTMLTextAreaElement>("#notiz");
  }

  it("nur die Notiz ändern: speicherbar, Zeiten/Pause/Lohn bleiben exakt wie gespeichert", () => {
    seed([legacy]);
    open("legacy");
    // Hinweis statt Sperre.
    expect(q('[data-testid="entry-time-info"]').textContent).toContain("Gespeicherter Eintrag");
    setValue(openNote(), "Schlüssel abgegeben");
    save();
    expect(closed).toBe(1);
    const saved = getData().shifts.find((s) => s.id === "legacy")!;
    expect(saved).toMatchObject({
      start: "09:00",
      end: "10:00",
      breakMinutes: 120,
      rate: 13.5,
      createdAt: "2026-01-02",
      note: "Schlüssel abgegeben",
    });
    expect(getData().shifts).toHaveLength(1);
  });

  it("unverändert erneut speichern: kein Dialog, kein Fehler, nichts verändert", () => {
    seed([legacy]);
    const before = structuredClone(getData().shifts[0]);
    open("legacy");
    save();
    expect(closed).toBe(1);
    expect(maybe('[data-testid="entry-confirm-dialog"]')).toBeNull();
    // Werte-Gleichheit (der Editor baut das Objekt beim Speichern neu auf – seit jeher; nur die
    // Reihenfolge der Schlüssel kann sich dabei ändern, kein einziger Wert).
    expect(getData().shifts[0]).toEqual(before);
  });

  it("Beginn geändert, weiter ungültig: blockiert, gespeicherter Eintrag unverändert", () => {
    seed([legacy]);
    const before = structuredClone(getData().shifts[0]);
    open("legacy");
    setValue(q<HTMLInputElement>("#von"), "09:30");
    save();
    expect(closed).toBe(0);
    expect(q('[data-testid="entry-field-error"]').textContent).toContain("Pause");
    expect(getData().shifts[0]).toEqual(before);
  });

  it("Ende geändert, weiter ungültig: blockiert", () => {
    seed([legacy]);
    open("legacy");
    setValue(q<HTMLInputElement>("#bis"), "10:30");
    save();
    expect(closed).toBe(0);
    expect(getData().shifts[0]!.end).toBe("10:00");
  });

  it("Pause geändert, weiter ungültig: blockiert", () => {
    seed([legacy]);
    open("legacy");
    setValue(q<HTMLInputElement>("#pause"), "90");
    save();
    expect(closed).toBe(0);
    expect(getData().shifts[0]!.breakMinutes).toBe(120);
  });

  it("Pause korrigiert: gespeichert mit dem neuen, gültigen Wert", () => {
    seed([legacy]);
    open("legacy");
    setValue(q<HTMLInputElement>("#pause"), "15");
    save();
    expect(closed).toBe(1);
    expect(getData().shifts[0]).toMatchObject({ start: "09:00", end: "10:00", breakMinutes: 15 });
  });

  it("zurück auf die gespeicherten Werte: wieder speicherbar (es zählt der Vergleich, nicht der Weg)", () => {
    seed([legacy]);
    open("legacy");
    setValue(q<HTMLInputElement>("#von"), "09:30");
    setValue(q<HTMLInputElement>("#von"), "09:00");
    save();
    expect(closed).toBe(1);
    expect(getData().shifts[0]).toMatchObject({ start: "09:00", breakMinutes: 120 });
  });

  it("Altbestand mit Dauer 0: Notiz änderbar, Werte bleiben", () => {
    seed([work({ id: "zero", start: "09:00", end: "09:00", breakMinutes: 0 })]);
    open("zero");
    setValue(openNote(), "Termin abgesagt");
    save();
    expect(closed).toBe(1);
    expect(getData().shifts[0]).toMatchObject({
      start: "09:00",
      end: "09:00",
      breakMinutes: 0,
      note: "Termin abgesagt",
    });
  });

  it("ein NEUER Eintrag mit denselben ungültigen Werten bleibt blockiert", () => {
    seed([]);
    open(null);
    setValue(q<HTMLInputElement>("#von"), "09:00");
    setValue(q<HTMLInputElement>("#bis"), "10:00");
    setValue(q<HTMLInputElement>("#pause"), "120");
    save();
    expect(closed).toBe(0);
    expect(getData().shifts).toHaveLength(0);
  });

  it("(F2) Überschneidung beim Altbestand: Rückfrage bleibt bestehen", () => {
    seed([legacy, work({ id: "n", start: "08:00", end: "12:00" })]);
    open("legacy");
    save();
    expect(closed).toBe(0);
    expect(maybe('[data-testid="entry-confirm-dialog"]')).not.toBeNull();
    click(q('[data-testid="entry-confirm-save"]'));
    expect(closed).toBe(1);
    expect(getData().shifts.find((s) => s.id === "legacy")).toMatchObject({
      start: "09:00",
      end: "10:00",
      breakMinutes: 120,
    });
  });
});

describe("F3/F4 Anschluss am Folgetag im Editor", () => {
  const night = work({ id: "night", start: "22:00", end: "02:00" });
  const NEXT = "2026-09-25";

  it("(F4) Datum = Folgetag, Beginn = 02:00, Ende LEER, keine berechnete Dauer", () => {
    seed([night]);
    open(null);
    click(q('[data-testid="entry-continuation-apply"]'));
    expect(q<HTMLInputElement>('[data-testid="entry-date"]').value).toBe(NEXT);
    expect(q<HTMLInputElement>("#von").value).toBe("02:00");
    expect(q<HTMLInputElement>("#bis").value).toBe("");
    expect(q('[data-testid="entry-duration"]').textContent).toBe("–");
  });

  it("(F4) ohne Ende wird nicht gespeichert – nie ein stilles 17:00", () => {
    seed([night]);
    open(null);
    click(q('[data-testid="entry-continuation-apply"]'));
    save();
    expect(closed).toBe(0);
    expect(getData().shifts).toHaveLength(1);
    setValue(q<HTMLInputElement>("#bis"), "06:00");
    save();
    const added = getData().shifts.find((s) => s.id !== "night")!;
    expect(added).toMatchObject({ date: NEXT, start: "02:00", end: "06:00" });
    // Die Nachtschicht selbst bleibt unverändert.
    expect(getData().shifts.find((s) => s.id === "night")).toMatchObject({
      date: DAY,
      start: "22:00",
      end: "02:00",
    });
  });

  it("(F3) der alte Folgetag-Vorschlag verschwindet; für den neuen Tag erscheint der passende Hinweis", () => {
    seed([night]);
    open(null);
    click(q('[data-testid="entry-continuation-apply"]'));
    expect(maybe('[data-testid="entry-continuation-apply"]')).toBeNull();
    expect(q('[data-testid="entry-continuation-hint"]').textContent).toContain("22:00");
  });

  it("(F3) liegt am Folgetag ein späterer Eintrag, wird DESSEN Ende neu vorgeschlagen", () => {
    seed([night, work({ id: "later", date: NEXT, start: "08:00", end: "12:00" })]);
    open(null);
    click(q('[data-testid="entry-continuation-apply"]'));
    expect(q<HTMLInputElement>("#von").value).toBe("02:00");
    const chip = q('[data-testid="entry-continuation-apply"]');
    expect(chip.textContent).toContain("12:00");
    expect(chip.textContent).not.toContain("Folgetag");
    // Antippen übernimmt den neuen Vorschlag, danach ist er erledigt (kein Knopf mehr).
    click(chip);
    expect(q<HTMLInputElement>("#von").value).toBe("12:00");
    expect(maybe('[data-testid="entry-continuation-apply"]')).toBeNull();
    expect(q<HTMLInputElement>('[data-testid="entry-date"]').value).toBe(NEXT);
  });

  it("(F3) idempotent: nach dem Übernehmen gibt es nichts mehr anzutippen, der Zustand bleibt", () => {
    seed([night]);
    open(null);
    click(q('[data-testid="entry-continuation-apply"]'));
    const state = () => [
      q<HTMLInputElement>('[data-testid="entry-date"]').value,
      q<HTMLInputElement>("#von").value,
      q<HTMLInputElement>("#bis").value,
    ];
    const first = state();
    expect(maybe('[data-testid="entry-continuation-apply"]')).toBeNull();
    // Ein Jobwechsel hin und zurück (gleiche Vorschläge) ändert nichts mehr.
    click(byText("Lager Süd")!);
    click(byText("Reinigung Nord")!);
    expect(state()).toEqual(first);
  });

  it("(F4) auch ein späterer Job- oder Datumswechsel setzt kein stilles 17:00-Ende", () => {
    seed([night]);
    open(null);
    click(q('[data-testid="entry-continuation-apply"]'));
    click(byText("Lager Süd")!); // dieser Job hat keinen Anschluss
    expect(q<HTMLInputElement>("#von").value).toBe("02:00");
    expect(q<HTMLInputElement>("#bis").value).toBe("");
    setValue(q<HTMLInputElement>('[data-testid="entry-date"]'), "2026-09-28");
    expect(q<HTMLInputElement>("#bis").value).toBe("");
    expect(q('[data-testid="entry-duration"]').textContent).toBe("–");
  });

  it("(F3) am selben Tag verschwindet der Knopf ebenfalls, sobald sein Wert übernommen ist", () => {
    seed([work({ id: "a", start: "08:00", end: "10:30" })]);
    open(null);
    setValue(q<HTMLInputElement>("#von"), "11:00");
    click(q('[data-testid="entry-continuation-apply"]'));
    expect(q<HTMLInputElement>("#von").value).toBe("10:30");
    expect(maybe('[data-testid="entry-continuation-apply"]')).toBeNull();
    expect(maybe('[data-testid="entry-continuation-hint"]')).not.toBeNull();
  });
});
