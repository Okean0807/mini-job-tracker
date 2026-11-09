/**
 * K2-Nachtrag: Pause korrigieren, wenn der Stopp wegen "Pause >= erfasste Zeit" abgelehnt wird.
 *
 * Geprüft wird der GESPEICHERTE Zustand (Schichten, Timer, localStorage), nicht nur, dass ein Knopf
 * geklickt wurde. Die Schreibgrenze (`ShiftValidationError`) bleibt unverändert die einzige Instanz.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LANGUAGES } from "@/lib/i18n/core";
import { dashboard } from "@/lib/i18n/dict/dashboard";
import { settingsDict } from "@/lib/i18n/dict/settings";
import { tl } from "@/lib/i18n";
import { shiftHours } from "@/lib/minijob/calc";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
  startTimer,
  updateTimerBreak,
} from "@/lib/minijob/store";
import { DEFAULT_SETTINGS } from "@/lib/minijob/types";
import { WorkTimer } from "./WorkTimer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const at = (h: number, m: number, s = 0) => new Date(2026, 8, 24, h, m, s);
const q = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const need = (testId: string) => {
  const el = q(testId);
  if (!el) throw new Error(`missing ${testId}`);
  return el;
};
const dialogOpen = () => q("timer-break-fix") !== null;

function mount() {
  act(() =>
    root.render(
      createElement(WorkTimer, {
        timer: getData().timer,
        jobs: getData().jobs,
        settings: getData().settings,
      }),
    ),
  );
}
const stopButton = () =>
  [...container.querySelectorAll("button")].find((b) => b.className.includes("destructive"))!;
const click = (el: Element) =>
  act(() => {
    (el as HTMLElement).click();
  });
function setBreakInput(value: string) {
  const el = need("timer-break-fix-input") as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** Timer, der um 10:00:00 gestartet wurde und `breakMinutes` Pause hat; "jetzt" = 10:00 + elapsed. */
function runningTimer(breakMinutes: number, elapsedMinutes: number, seconds = 0) {
  vi.setSystemTime(at(10, 0, 0));
  act(() => startTimer("j1"));
  if (breakMinutes) act(() => updateTimerBreak(breakMinutes));
  vi.setSystemTime(at(10, elapsedMinutes, seconds));
  mount();
}

beforeEach(() => {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
  loadFromStorage();
  vi.useFakeTimers();
  act(() => {
    activateScope(DEMO_SCOPE);
    replaceAll({
      ...EMPTY_DATA,
      jobs: [{ id: "j1", name: "A", color: "#000", mode: "flex", rate: 14 }],
      settings: { ...DEFAULT_SETTINGS, onboarded: true, localDemoMode: true, activeJobId: "j1" },
    } as never);
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("(1) abgelehnter Stopp wegen Pause >= erfasster Zeit", () => {
  it("10 Min. erfasst, 15 Min. Pause: nichts gespeichert, Timer läuft unverändert weiter, Korrektur wird angeboten", () => {
    runningTimer(15, 10);
    const startedAt = getData().timer!.startedAt;
    click(stopButton());
    expect(getData().shifts).toEqual([]);
    expect(getData().timer).toMatchObject({ startedAt, breakMinutes: 15, jobId: "j1" });
    expect(dialogOpen()).toBe(true);
    // Zeigt die aktuelle Pause und die erfasste Zeit (Kontext) und erklärt den Grund.
    const text = need("timer-break-fix").textContent ?? "";
    expect(text).toContain("15");
    expect(text).toContain("10");
    expect((need("timer-break-fix-input") as HTMLInputElement).value).toBe("15");
  });
});

describe("(2)(3) Pause korrigieren und speichern", () => {
  it("(2) Pause auf 5: gespeichert wird exakt das erfasste Intervall 10:00–10:10 mit 5 Min. Pause", () => {
    runningTimer(15, 10);
    click(stopButton());
    setBreakInput("5");
    click(need("timer-break-fix-save"));
    expect(getData().shifts).toHaveLength(1);
    expect(getData().shifts[0]).toMatchObject({
      kind: "arbeit",
      date: "2026-09-24",
      start: "10:00",
      end: "10:10",
      breakMinutes: 5,
      jobId: "j1",
    });
    expect(shiftHours(getData().shifts[0]!)).toBeCloseTo(5 / 60, 10);
    expect(getData().timer).toBeNull();
    expect(dialogOpen()).toBe(false);
    // Im Speicher des aktiven Scopes angekommen.
    const raw = window.localStorage.getItem("minijob-tracker-v1:demo") ?? "";
    expect(raw).toContain('"breakMinutes":5');
    expect(raw).toContain('"end":"10:10"');
  });

  it("(3) Pause auf 0 (Knopf 'Keine Pause'): gespeichert wird das tatsächliche Intervall mit 0 Min. Pause", () => {
    runningTimer(15, 10);
    click(stopButton());
    click(need("timer-break-fix-zero"));
    expect((need("timer-break-fix-input") as HTMLInputElement).value).toBe("0");
    click(need("timer-break-fix-save"));
    expect(getData().shifts[0]).toMatchObject({ start: "10:00", end: "10:10", breakMinutes: 0 });
    expect(shiftHours(getData().shifts[0]!)).toBeCloseTo(10 / 60, 10);
    expect(getData().timer).toBeNull();
  });

  it("(3) Pause auf 0 durch Tippen der Zahl 0", () => {
    runningTimer(15, 10);
    click(stopButton());
    setBreakInput("0");
    click(need("timer-break-fix-save"));
    expect(getData().shifts[0]).toMatchObject({ breakMinutes: 0, start: "10:00", end: "10:10" });
  });

  it("die Minus-Taste verringert die Pause, nie unter 0", () => {
    runningTimer(15, 10);
    click(stopButton());
    const minus = [...document.querySelectorAll("button")].find((b) =>
      (b.getAttribute("aria-label") ?? "").includes("−15"),
    )!;
    click(minus);
    expect((need("timer-break-fix-input") as HTMLInputElement).value).toBe("0");
    click(minus);
    expect((need("timer-break-fix-input") as HTMLInputElement).value).toBe("0");
    click(need("timer-break-fix-save"));
    expect(getData().shifts[0]).toMatchObject({ breakMinutes: 0 });
  });

  it("eine weiterhin zu lange Pause wird erneut abgelehnt: nichts gespeichert, Dialog bleibt, Timer unverändert", () => {
    runningTimer(15, 10);
    const before = structuredClone(getData().timer);
    click(stopButton());
    setBreakInput("12");
    click(need("timer-break-fix-save"));
    expect(getData().shifts).toEqual([]);
    expect(getData().timer).toEqual(before);
    expect(dialogOpen()).toBe(true);
    expect(need("timer-break-fix-error")).toBeTruthy();
    // Danach mit gültigem Wert speichern.
    setBreakInput("9");
    click(need("timer-break-fix-save"));
    expect(getData().shifts[0]).toMatchObject({ breakMinutes: 9, end: "10:10" });
  });

  it("ungültige Eingabe (leer, negativ) lässt sich nicht speichern", () => {
    runningTimer(15, 10);
    click(stopButton());
    setBreakInput("");
    expect((need("timer-break-fix-save") as HTMLButtonElement).disabled).toBe(true);
    setBreakInput("-5");
    expect((need("timer-break-fix-save") as HTMLButtonElement).disabled).toBe(true);
    click(need("timer-break-fix-save"));
    expect(getData().shifts).toEqual([]);
    expect(getData().timer?.breakMinutes).toBe(15);
  });

  it("nichts wird automatisch geändert: weder die Pause noch die Endzeit, bevor die Nutzerin bestätigt", () => {
    runningTimer(15, 10);
    click(stopButton());
    expect(getData().timer?.breakMinutes).toBe(15);
    expect(getData().shifts).toEqual([]);
  });
});

describe("(4) Abbrechen", () => {
  it("Abbrechen: nichts gespeichert, Timer und ursprüngliche Pause unverändert, Dialog zu", () => {
    runningTimer(15, 10);
    const before = structuredClone(getData().timer);
    click(stopButton());
    setBreakInput("0"); // Entwurf wird verworfen
    click(need("timer-break-fix-cancel"));
    expect(dialogOpen()).toBe(false);
    expect(getData().shifts).toEqual([]);
    expect(getData().timer).toEqual(before);
    expect(getData().timer?.breakMinutes).toBe(15);
    // Der verworfene Entwurf taucht beim nächsten Öffnen nicht auf.
    click(stopButton());
    expect((need("timer-break-fix-input") as HTMLInputElement).value).toBe("15");
  });

  it("Schließen mit Escape wirkt wie Abbrechen", () => {
    runningTimer(15, 10);
    const before = structuredClone(getData().timer);
    click(stopButton());
    // Vorbedingung: der Dialog ist offen – sonst würde der Test unten trivial bestehen.
    expect(dialogOpen()).toBe(true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    // Escape schließt den Dialog tatsächlich (nicht nur: es ändert sich nichts) …
    expect(dialogOpen()).toBe(false);
    expect(q("timer-break-fix-input")).toBeNull();
    // … und wirkt wie Abbrechen: nichts gespeichert, Timer samt Pause unverändert.
    expect(getData().shifts).toEqual([]);
    expect(getData().timer).toEqual(before);
  });
});

describe("(5)(6) bestehendes Verhalten bleibt", () => {
  it("(5) gleiche Minute: Dauer 0 bleibt abgelehnt, Timer läuft weiter, KEINE Pausen-Korrektur", () => {
    runningTimer(0, 0, 30);
    click(stopButton());
    expect(getData().shifts).toEqual([]);
    expect(getData().timer).not.toBeNull();
    expect(dialogOpen()).toBe(false);
  });

  it("(5) gleiche Minute mit Pause: Dauer 0 wird zuerst gemeldet, es wird nichts korrigiert", () => {
    runningTimer(15, 0, 30);
    click(stopButton());
    expect(getData().shifts).toEqual([]);
    expect(getData().timer?.breakMinutes).toBe(15);
    expect(dialogOpen()).toBe(false);
  });

  it("(6) gültiger Stopp ohne Korrektur: wie bisher gespeichert, Timer beendet, kein Dialog", () => {
    runningTimer(15, 45);
    click(stopButton());
    expect(dialogOpen()).toBe(false);
    expect(getData().shifts[0]).toMatchObject({ start: "10:00", end: "10:45", breakMinutes: 15 });
    expect(shiftHours(getData().shifts[0]!)).toBeCloseTo(0.5, 10);
    expect(getData().timer).toBeNull();
  });

  it("(6) Pause knapp kürzer als die erfasste Zeit wird ohne Rückfrage gespeichert", () => {
    runningTimer(9, 10);
    click(stopButton());
    expect(dialogOpen()).toBe(false);
    expect(getData().shifts[0]).toMatchObject({ breakMinutes: 9, end: "10:10" });
  });
});

describe("(7) Texte in allen fünf Sprachen", () => {
  const KEYS = [
    "timer.fixTitle",
    "timer.fixBody",
    "timer.fixBreakLabel",
    "timer.fixNoBreak",
    "timer.fixSave",
    "timer.fixCancel",
    "timer.fixStillInvalid",
  ] as const;
  const langs = LANGUAGES.map((l) => l.code);

  it("es sind genau die fünf unterstützten Sprachen", () => {
    expect(langs).toEqual(["de", "en", "ru", "tr", "pl"]);
  });

  it("jeder neue Text existiert in jeder Sprache und ist nicht leer", () => {
    for (const lang of langs) {
      const bundle = dashboard[lang] as Record<string, string>;
      for (const key of KEYS) {
        expect(typeof bundle[key], `${lang}/${key}`).toBe("string");
        expect(bundle[key]?.trim().length, `${lang}/${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("die Platzhalter {pause} und {elapsed} werden in jeder Sprache ersetzt", () => {
    for (const lang of langs) {
      const text = tl(lang, "timer.fixBody", { pause: 15, elapsed: 10 });
      expect(text, lang).toContain("15");
      expect(text, lang).toContain("10");
      expect(text, lang).not.toMatch(/\{[a-z]+\}/i);
    }
  });

  it("imp.skippedInvalid (Import-Hinweis der Schreibgrenze) existiert in allen fünf Sprachen und ist übersetzt", () => {
    const de = (settingsDict.de as Record<string, string>)["imp.skippedInvalid"];
    for (const lang of langs) {
      const own = (settingsDict[lang] as Record<string, string>)["imp.skippedInvalid"];
      // Eigener Eintrag je Sprache – nicht still über den deutschen Fallback von tl() abgedeckt.
      expect(typeof own, lang).toBe("string");
      expect(own?.trim().length, lang).toBeGreaterThan(0);
      expect(own, lang).toContain("{count}");
      const text = tl(lang, "imp.skippedInvalid", { count: 3 });
      expect(text, lang).toContain("3");
      expect(text, lang).not.toMatch(/\{[a-z]+\}/i);
      if (lang !== "de") expect(own, lang).not.toBe(de);
    }
  });

  it("die Texte sind übersetzt (keine Kopie des deutschen Satzes)", () => {
    const de = dashboard.de as Record<string, string>;
    for (const lang of langs.filter((l) => l !== "de")) {
      const bundle = dashboard[lang] as Record<string, string>;
      const copies = KEYS.filter((k) => (de[k] ?? "").length > 20 && bundle[k] === de[k]);
      expect(copies, lang).toEqual([]);
    }
  });
});
