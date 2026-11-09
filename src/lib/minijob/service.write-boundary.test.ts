/**
 * K2: Schreibgrenze für Schichten.
 *
 * Reproduziert aus der Produktions-QA: Timer Start/Stopp in derselben Minute speicherte eine
 * Schicht mit Beginn = Ende (0,00 h). Geprüft werden ALLE Wege, auf denen eine Schicht entstehen
 * oder sich ändern kann – nicht nur der Timer –, jeweils am gespeicherten Bestand.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkTimer } from "@/components/minijob/WorkTimer";
import { shiftHours } from "./calc";
import { parseCsv } from "./csv";
import {
  addShift,
  applyFixedMonth,
  persistDialogShift,
  saveManyShifts,
  ShiftValidationError,
  shiftWriteErrors,
  updateShift,
  upsertShift,
} from "./service";
import { DEMO_SCOPE } from "./storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
  startTimer,
} from "./store";
import { DEFAULT_SETTINGS, EMPTY_WEEK, type Job, type Shift } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = "2026-09-24";
const base = { kind: "arbeit" as const, date: DAY, rate: 14, jobId: "j1" };

function seed(
  shifts: Shift[] = [],
  jobs: Job[] = [{ id: "j1", name: "A", color: "#000", mode: "flex", rate: 14 }],
) {
  act(() => {
    activateScope(DEMO_SCOPE);
    replaceAll({
      ...EMPTY_DATA,
      jobs,
      shifts,
      settings: { ...DEFAULT_SETTINGS, onboarded: true, localDemoMode: true, activeJobId: "j1" },
    } as never);
  });
}

const stored = (): Shift[] => structuredClone(getData().shifts);
const legacy = (p: Partial<Shift> & { id: string }): Shift =>
  ({
    kind: "arbeit",
    date: DAY,
    jobId: "j1",
    start: "09:00",
    end: "09:00",
    breakMinutes: 0,
    ...p,
  }) as Shift;

beforeEach(() => {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
  loadFromStorage();
});

/* ------------------------------------------------------------------ WorkTimer (der gemeldete Fehler) */

describe("WorkTimer – Start/Stopp", () => {
  let container: HTMLDivElement;
  let root: Root;

  function mountTimer() {
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

  beforeEach(() => {
    vi.useFakeTimers();
    seed();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("(1) identische Zeitstempel (gleiche Minute): kein 0-Stunden-Eintrag, der Timer läuft weiter", () => {
    vi.setSystemTime(new Date(2026, 8, 24, 10, 0, 5));
    act(() => startTimer("j1"));
    vi.setSystemTime(new Date(2026, 8, 24, 10, 0, 40));
    mountTimer();
    act(() => stopButton().click());
    expect(getData().shifts).toEqual([]);
    // Keine Zeit geht verloren: der Timer ist noch da.
    expect(getData().timer).not.toBeNull();
    expect(getData().timer?.jobId).toBe("j1");
  });

  it("(1) exakt gleiche Sekunde: ebenfalls nichts gespeichert", () => {
    vi.setSystemTime(new Date(2026, 8, 24, 10, 0, 0));
    act(() => startTimer("j1"));
    mountTimer();
    act(() => stopButton().click());
    expect(getData().shifts).toEqual([]);
    expect(getData().timer).not.toBeNull();
  });

  it("(1) nach dem Ablauf der Minute lässt sich der Timer regulär beenden", () => {
    vi.setSystemTime(new Date(2026, 8, 24, 10, 0, 5));
    act(() => startTimer("j1"));
    mountTimer();
    act(() => stopButton().click()); // abgelehnt
    expect(getData().shifts).toEqual([]);
    vi.setSystemTime(new Date(2026, 8, 24, 10, 1, 10));
    mountTimer();
    act(() => stopButton().click());
    expect(getData().shifts).toHaveLength(1);
    expect(getData().shifts[0]).toMatchObject({ start: "10:00", end: "10:01", date: DAY });
    expect(getData().timer).toBeNull();
  });

  it("(2) gültige positive Dauer: gespeichert, Timer beendet, Stunden > 0", () => {
    vi.setSystemTime(new Date(2026, 8, 24, 8, 0, 0));
    act(() => startTimer("j1"));
    vi.setSystemTime(new Date(2026, 8, 24, 10, 30, 0));
    mountTimer();
    act(() => stopButton().click());
    const [shift] = getData().shifts;
    expect(shift).toMatchObject({
      kind: "arbeit",
      date: DAY,
      start: "08:00",
      end: "10:30",
      breakMinutes: 0,
    });
    expect(shiftHours(shift!)).toBe(2.5);
    expect(getData().timer).toBeNull();
  });

  it("(5) über Mitternacht: gültige Nachtschicht wird gespeichert", () => {
    vi.setSystemTime(new Date(2026, 8, 24, 22, 0, 0));
    act(() => startTimer("j1"));
    vi.setSystemTime(new Date(2026, 8, 25, 2, 0, 0));
    mountTimer();
    act(() => stopButton().click());
    expect(getData().shifts[0]).toMatchObject({ date: DAY, start: "22:00", end: "02:00" });
    expect(shiftHours(getData().shifts[0]!)).toBe(4);
  });

  it("(4) Pause >= Dauer: abgelehnt, Timer läuft weiter, nichts gespeichert", () => {
    vi.setSystemTime(new Date(2026, 8, 24, 10, 0, 0));
    act(() => startTimer("j1"));
    mountTimer();
    // 15-Minuten-Pause hinzufügen (der zweite Knopf des Timers)
    const breakBtn = [...container.querySelectorAll("button")].find(
      (b) => !b.className.includes("destructive") && b.textContent !== "",
    )!;
    act(() => breakBtn.click()); // +15 Min. Pause
    vi.setSystemTime(new Date(2026, 8, 24, 10, 10, 0)); // nur 10 Min. Arbeitszeit
    mountTimer();
    act(() => stopButton().click());
    expect(getData().shifts).toEqual([]);
    expect(getData().timer?.breakMinutes).toBe(15);
  });
});

/* ------------------------------------------------------------------ Service: alle Schreibfunktionen */

describe("Service – Schreibgrenze für neue Schichten", () => {
  beforeEach(() => seed());

  it("(3) Beginn = Ende: addShift, upsertShift und persistDialogShift lehnen ab und speichern nichts", () => {
    const zero = { ...base, start: "09:00", end: "09:00", breakMinutes: 0 };
    expect(() => addShift(zero)).toThrow(ShiftValidationError);
    expect(() => upsertShift(zero)).toThrow(ShiftValidationError);
    expect(() => persistDialogShift({ ...zero, id: "x" })).toThrow(ShiftValidationError);
    expect(getData().shifts).toEqual([]);
  });

  it("(4) Pause >= Arbeitszeit wird abgelehnt – auch genau gleich", () => {
    expect(() => addShift({ ...base, start: "09:00", end: "10:00", breakMinutes: 60 })).toThrow(
      ShiftValidationError,
    );
    expect(() => addShift({ ...base, start: "09:00", end: "10:00", breakMinutes: 120 })).toThrow(
      ShiftValidationError,
    );
    expect(getData().shifts).toEqual([]);
    expect(addShift({ ...base, start: "09:00", end: "10:00", breakMinutes: 59 }).id).toBeTruthy();
  });

  it("fehlende oder ungültige Zeiten werden abgelehnt", () => {
    expect(() => addShift({ ...base, start: "", end: "10:00", breakMinutes: 0 })).toThrow(
      ShiftValidationError,
    );
    expect(() => addShift({ ...base, start: "09:00", end: "25:00", breakMinutes: 0 })).toThrow(
      ShiftValidationError,
    );
    expect(getData().shifts).toEqual([]);
  });

  it("(5) eine legitime Nachtschicht wird gespeichert", () => {
    const night = addShift({ ...base, start: "22:00", end: "06:00", breakMinutes: 30 });
    expect(getData().shifts).toHaveLength(1);
    expect(shiftHours(night)).toBe(7.5);
  });

  it("Überschneidung und Dublette sind bestätigbare Warnungen der Oberfläche – der Service blockiert sie nicht", () => {
    addShift({ ...base, start: "09:00", end: "12:00", breakMinutes: 0 });
    expect(() =>
      addShift({ ...base, start: "10:00", end: "13:00", breakMinutes: 0 }),
    ).not.toThrow();
    expect(() =>
      addShift({ ...base, start: "09:00", end: "12:00", breakMinutes: 0 }),
    ).not.toThrow();
    expect(getData().shifts).toHaveLength(3);
  });

  it("Abwesenheiten werden nicht geprüft (Zeiten stammen aus dem Wochenplan)", () => {
    expect(() =>
      addShift({ ...base, kind: "urlaub", start: "09:00", end: "09:00", breakMinutes: 0 }),
    ).not.toThrow();
  });

  it("ein abgelehnter Schreibversuch ändert den Bestand nicht (byte-genau)", () => {
    addShift({ ...base, start: "08:00", end: "12:00", breakMinutes: 0 });
    const before = JSON.stringify(getData().shifts);
    expect(() => addShift({ ...base, start: "13:00", end: "13:00", breakMinutes: 0 })).toThrow();
    expect(JSON.stringify(getData().shifts)).toBe(before);
  });

  it("der Fehler nennt die Gründe (für die Oberfläche)", () => {
    try {
      addShift({ ...base, start: "09:00", end: "09:00", breakMinutes: 0 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ShiftValidationError);
      expect((error as ShiftValidationError).issues.map((i) => i.code)).toEqual(["zero-duration"]);
    }
  });
});

describe("Service – Änderungen und Altbestand (Paket-A-Regel)", () => {
  const stored0 = legacy({ id: "zero", start: "09:00", end: "09:00", breakMinutes: 0 });
  const storedBreak = legacy({ id: "brk", start: "09:00", end: "10:00", breakMinutes: 120 });
  beforeEach(() => seed([stored0, storedBreak]));

  it("(6) Altbestand mit unveränderten Zeiten und Pause bleibt über updateShift änderbar (Notiz)", () => {
    expect(updateShift("zero", { note: "abgesagt" })?.note).toBe("abgesagt");
    expect(updateShift("brk", { note: "Schlüssel" })?.note).toBe("Schlüssel");
    expect(getData().shifts.find((s) => s.id === "zero")).toMatchObject({
      start: "09:00",
      end: "09:00",
      breakMinutes: 0,
      note: "abgesagt",
    });
    expect(getData().shifts.find((s) => s.id === "brk")).toMatchObject({
      start: "09:00",
      end: "10:00",
      breakMinutes: 120,
      note: "Schlüssel",
    });
  });

  it("(6) Altbestand bleibt über upsertShift/persistDialogShift mit gleicher Id speicherbar", () => {
    expect(() => upsertShift({ ...stored0, note: "x" })).not.toThrow();
    expect(() => persistDialogShift({ ...storedBreak, note: "y" }, "brk")).not.toThrow();
  });

  it("(7) Altbestand: geänderter Beginn/Ende/Pause, weiter ungültig → abgelehnt, Bestand unverändert", () => {
    const before = JSON.stringify(getData().shifts);
    expect(() =>
      updateShift("zero", { start: "09:00", end: "09:00", breakMinutes: 0 }),
    ).not.toThrow(); // nichts geändert
    expect(() => updateShift("brk", { start: "09:15" })).toThrow(ShiftValidationError);
    expect(() => updateShift("brk", { end: "10:30" })).toThrow(ShiftValidationError);
    expect(() => updateShift("brk", { breakMinutes: 90 })).toThrow(ShiftValidationError);
    expect(JSON.stringify(getData().shifts.find((s) => s.id === "brk"))).toBe(
      JSON.stringify(JSON.parse(before).find((s: Shift) => s.id === "brk")),
    );
  });

  it("(7) Altbestand, korrigiert auf gültige Werte: wird gespeichert", () => {
    expect(updateShift("brk", { breakMinutes: 15 })?.breakMinutes).toBe(15);
    expect(updateShift("zero", { end: "11:00" })?.end).toBe("11:00");
  });

  it("ein NEUER Eintrag mit denselben ungültigen Werten bleibt abgelehnt", () => {
    expect(() => addShift({ ...base, start: "09:00", end: "10:00", breakMinutes: 120 })).toThrow(
      ShiftValidationError,
    );
  });

  it("eine gespeicherte Abwesenheit, die zur Arbeit wird, gilt nicht als Altbestand", () => {
    seed([legacy({ id: "abs", kind: "urlaub", start: "09:00", end: "09:00" })]);
    expect(() => updateShift("abs", { kind: "arbeit" })).toThrow(ShiftValidationError);
  });

  it("shiftWriteErrors liest nur: es verändert nichts", () => {
    const before = JSON.stringify(getData().shifts);
    shiftWriteErrors(storedBreak);
    shiftWriteErrors({ ...storedBreak, start: "09:30" });
    expect(JSON.stringify(getData().shifts)).toBe(before);
  });
});

/* ------------------------------------------------------------------ Massen- und Importwege */

describe("(8)(9) Massen-, Import- und Plan-Wege", () => {
  beforeEach(() => seed());

  it("saveManyShifts speichert gültige, lehnt ungültige ab und nennt sie", () => {
    const ok = legacy({ id: "ok", start: "09:00", end: "12:00" });
    const bad = legacy({ id: "bad", start: "09:00", end: "09:00" });
    const badBreak = legacy({ id: "bb", start: "09:00", end: "10:00", breakMinutes: 90 });
    const { saved, rejected } = saveManyShifts([ok, bad, badBreak]);
    expect(saved.map((s) => s.id)).toEqual(["ok"]);
    expect(rejected.map((r) => r.shift.id)).toEqual(["bad", "bb"]);
    expect(rejected[0]!.issues[0]!.code).toBe("zero-duration");
    expect(getData().shifts.map((s) => s.id)).toEqual(["ok"]);
  });

  it("CSV-Import: eine Zeile mit Dauer 0 oder zu langer Pause ist schon in der Vorschau ungültig", () => {
    const csv = [
      "Datum;Von;Bis;Pause;Lohn;Job;Notiz",
      "2026-09-24;09:00;09:00;0;;;null",
      "2026-09-24;09:00;10:00;90;;;zu lange Pause",
      "2026-09-24;08:00;12:00;30;;;ok",
      "2026-09-24;22:00;02:00;0;;;Nacht",
    ].join("\n");
    const parsed = parseCsv(csv, { jobs: getData().jobs, defaultRate: 14 });
    expect(parsed.valid.map((r) => r.shift?.start)).toEqual(["08:00", "22:00"]);
    expect(parsed.invalid).toHaveLength(2);
  });

  it("CSV-Import: selbst eine am Parser vorbeigeschleuste ungültige Zeile wird beim Speichern abgelehnt", () => {
    const parsed = parseCsv("Datum;Von;Bis;Pause\n2026-09-24;08:00;12:00;0", {
      jobs: getData().jobs,
      defaultRate: 14,
    });
    const forged = { ...parsed.valid[0]!.shift!, end: "08:00" };
    const { saved, rejected } = saveManyShifts([forged]);
    expect(saved).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(getData().shifts).toEqual([]);
  });

  it("Wochenplan anwenden: ein Planungstag mit Beginn = Ende erzeugt keinen 0-Stunden-Eintrag", () => {
    const week = EMPTY_WEEK.map((d) => ({ ...d, active: true }));
    week[3] = { active: true, start: "08:00", end: "08:00", breakMinutes: 0 }; // Donnerstag kaputt
    const job: Job = { id: "j1", name: "Fest", color: "#000", mode: "fest", rate: 14, week };
    seed([], [job]);
    const created = applyFixedMonth(job, 2026, 8);
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((s) => s.start !== s.end)).toBe(true);
    expect(getData().shifts.every((s) => s.start !== s.end)).toBe(true);
  });
});

/* ------------------------------------------------------------------ Umgehungsversuche und Struktur */

describe("(8) Umgehung und Struktur", () => {
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) sourceFiles(full, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }
  const files = sourceFiles(join(process.cwd(), "src"));
  const rel = (f: string) => f.slice(process.cwd().length + 1).replace(/\\/g, "/");
  const storeImport =
    /import\s*\{([^}]*)\}\s*from\s*["'](?:@\/lib\/minijob\/|\.\/|\.\.\/(?:lib\/minijob\/)?)store["']/g;

  it("keine Oberfläche und kein Modul schreibt Schichten am Service vorbei in den Store", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(storeImport)) {
        if (/\bsaveShifts?\b/.test(match[1]!) && !rel(file).endsWith("lib/minijob/service.ts")) {
          offenders.push(rel(file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("replaceAll (Wiederherstellung, Cloud, Backup-Import) bleibt auf genau diese Wege beschränkt", () => {
    const users = files
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        for (const match of text.matchAll(storeImport))
          if (/\breplaceAll\b/.test(match[1]!)) return true;
        return false;
      })
      .map(rel)
      .sort();
    expect(users).toEqual([
      "src/lib/minijob/cloud.ts",
      "src/lib/minijob/json-backup-import.ts",
      "src/lib/minijob/local-backup-restore.ts",
      "src/lib/minijob/local-data-import.ts",
    ]);
  });

  it("der Store bleibt bewusst offen: Alt-, Cloud- und Backup-Daten werden unverändert geladen", () => {
    const old = legacy({ id: "old", start: "09:00", end: "09:00" });
    seed([old]);
    expect(getData().shifts).toEqual([
      expect.objectContaining({ id: "old", start: "09:00", end: "09:00" }),
    ]);
  });
});
