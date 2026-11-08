/**
 * Paket A: Zeit-Anschluss, letzter Eintrag je Job, Tätigkeits-Vorschläge.
 * Reine Logik – kein DOM, kein Store. Geprüft wird der VORSCHLAG, nicht die Oberfläche.
 */
import { describe, expect, it } from "vitest";

import {
  applyContinuationTo,
  continuationStart,
  dayIndex,
  DEFAULT_ENTRY_END,
  DEFAULT_ENTRY_START,
  isoFromDayIndex,
  lastJobEntry,
  lastJobValues,
  minutesToTime,
  repeatPayload,
  reseedTimeFields,
  shiftEndMinutes,
  taskSuggestionsFromHistory,
} from "./entry-suggest";
import type { Shift, WorkObject } from "./types";

const DAY = "2026-09-24";
const PREV_DAY = "2026-09-23";
const NEXT_DAY = "2026-09-25";

function work(partial: Partial<Shift> & { id: string; start: string; end: string }): Shift {
  return {
    kind: "arbeit",
    date: DAY,
    breakMinutes: 0,
    jobId: "j1",
    ...partial,
  } as Shift;
}

describe("Hilfsfunktionen", () => {
  it("Tagesindex und Umkehrung passen zusammen", () => {
    expect(isoFromDayIndex(dayIndex(DAY))).toBe(DAY);
    expect(dayIndex(NEXT_DAY) - dayIndex(DAY)).toBe(1);
    expect(dayIndex("2027-01-01") - dayIndex("2026-12-31")).toBe(1);
    expect(Number.isNaN(dayIndex("kaputt"))).toBe(true);
  });

  it("Ende vor Beginn heißt Folgetag, Beginn = Ende heißt Dauer 0 (wie shiftHours)", () => {
    expect(shiftEndMinutes({ start: "08:00", end: "12:00" })).toBe(720);
    expect(shiftEndMinutes({ start: "22:00", end: "02:00" })).toBe(1560);
    expect(shiftEndMinutes({ start: "09:00", end: "09:00" })).toBe(540);
  });

  it("minutesToTime formatiert zweistellig und rollt über 24 h", () => {
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(630)).toBe("10:30");
    expect(minutesToTime(1440)).toBe("00:00");
  });
});

describe("A1 Zeit-Anschluss", () => {
  it("(1) erster Eintrag des Tages: kein Vorschlag", () => {
    expect(continuationStart([], { jobId: "j1", date: DAY })).toBeNull();
  });

  it("(2) zweiter Eintrag: Ende des vorigen Eintrags wird vorgeschlagen", () => {
    const shifts = [work({ id: "a", start: "08:00", end: "10:30" })];
    const next = continuationStart(shifts, { jobId: "j1", date: DAY });
    expect(next).toMatchObject({ start: "10:30", sameDay: true, sourceId: "a", date: DAY });
    expect(next?.sourceStart).toBe("08:00");
    expect(next?.sourceEnd).toBe("10:30");
  });

  it("(3) dritter Eintrag: immer das chronologisch LETZTE Ende, nicht der letzte Datensatz", () => {
    const shifts = [
      work({ id: "a", start: "08:00", end: "10:30" }),
      work({ id: "b", start: "10:30", end: "13:15" }),
      // Später gespeichert, liegt aber zeitlich VOR b – darf den Vorschlag nicht bestimmen.
      work({ id: "c", start: "06:00", end: "07:00" }),
    ];
    expect(continuationStart(shifts, { jobId: "j1", date: DAY })?.start).toBe("13:15");
  });

  it("(5) Pause zwischen Einträgen: vorgeschlagen wird das Ende, die Lücke bleibt Sache der Nutzerin", () => {
    const shifts = [work({ id: "a", start: "08:00", end: "10:30" })];
    // Der Vorschlag ist 10:30; ein später eingetragener Beginn 11:00 bleibt möglich und
    // erzeugt keine Überschneidung (siehe entry-validate).
    expect(continuationStart(shifts, { jobId: "j1", date: DAY })?.start).toBe("10:30");
  });

  it("(6) mehrere Jobs am selben Tag: nur der eigene Job zählt", () => {
    const shifts = [
      work({ id: "a", jobId: "j1", start: "08:00", end: "10:30" }),
      work({ id: "b", jobId: "j2", start: "11:00", end: "19:00" }),
    ];
    expect(continuationStart(shifts, { jobId: "j1", date: DAY })?.start).toBe("10:30");
    expect(continuationStart(shifts, { jobId: "j2", date: DAY })?.start).toBe("19:00");
    expect(continuationStart(shifts, { jobId: "j3", date: DAY })).toBeNull();
  });

  it("Einträge ohne Job gehören zu 'kein Job' und nicht zu jedem Job", () => {
    const shifts = [
      {
        id: "a",
        kind: "arbeit",
        date: DAY,
        start: "08:00",
        end: "10:30",
        breakMinutes: 0,
      } as Shift,
    ];
    expect(continuationStart(shifts, { date: DAY })?.start).toBe("10:30");
    expect(continuationStart(shifts, { jobId: "j1", date: DAY })).toBeNull();
  });

  it("(13) über Mitternacht: Anschluss fällt auf den Folgetag und wird nicht automatisch gesetzt", () => {
    const shifts = [work({ id: "a", start: "22:00", end: "02:00" })];
    const next = continuationStart(shifts, { jobId: "j1", date: DAY });
    expect(next).toMatchObject({ start: "02:00", sameDay: false, date: NEXT_DAY });
  });

  it("(13) ein Eintrag des Vortags, der über Mitternacht reicht, endet am angefragten Tag", () => {
    const shifts = [work({ id: "a", date: PREV_DAY, start: "22:00", end: "02:00" })];
    const next = continuationStart(shifts, { jobId: "j1", date: DAY });
    expect(next).toMatchObject({ start: "02:00", sameDay: true, date: DAY, sourceId: "a" });
  });

  it("ein Eintrag des Vortags OHNE Mitternachtsüberschreitung zählt nicht", () => {
    const shifts = [work({ id: "a", date: PREV_DAY, start: "08:00", end: "16:00" })];
    expect(continuationStart(shifts, { jobId: "j1", date: DAY })).toBeNull();
  });

  it("Abwesenheiten liefern keinen Anschluss (ihre Zeiten stammen aus dem Wochenplan)", () => {
    const shifts = [
      work({ id: "u", kind: "urlaub", start: "09:00", end: "17:00" }),
      work({ id: "k", kind: "krank", start: "09:00", end: "17:00" }),
    ];
    expect(continuationStart(shifts, { jobId: "j1", date: DAY })).toBeNull();
  });

  it("der gerade bearbeitete Eintrag schließt sich selbst aus", () => {
    const shifts = [work({ id: "a", start: "08:00", end: "10:30" })];
    expect(continuationStart(shifts, { jobId: "j1", date: DAY, excludeId: "a" })).toBeNull();
  });

  it("kaputte oder leere Zeiten führen nie zu einem Vorschlag", () => {
    const shifts = [
      work({ id: "a", start: "", end: "" }),
      work({ id: "b", start: "08:00", end: "25:99" }),
    ];
    expect(continuationStart(shifts, { jobId: "j1", date: DAY })).toBeNull();
  });

  it("gleiches Ende: deterministische Auswahl, nie zufällig", () => {
    const shifts = [
      work({ id: "a", start: "08:00", end: "12:00" }),
      work({ id: "b", start: "10:00", end: "12:00" }),
    ];
    const first = continuationStart(shifts, { jobId: "j1", date: DAY });
    const second = continuationStart([...shifts].reverse(), { jobId: "j1", date: DAY });
    expect(first?.start).toBe("12:00");
    expect(second?.sourceId).toBe(first?.sourceId);
  });

  it("der Vorschlag liegt nie VOR einem bestehenden Ende – Überschneidung ist ausgeschlossen", () => {
    const shifts = [
      work({ id: "a", start: "08:00", end: "10:30" }),
      work({ id: "b", start: "12:00", end: "15:45" }),
      work({ id: "c", start: "10:30", end: "11:15" }),
    ];
    const suggestion = continuationStart(shifts, { jobId: "j1", date: DAY });
    const latestEnd = Math.max(...shifts.map((s) => shiftEndMinutes(s)));
    expect(suggestion?.start).toBe(minutesToTime(latestEnd));
  });
});

describe("A4/A3 letzter Eintrag je Job", () => {
  const objects: WorkObject[] = [
    {
      id: "obj-1",
      name: "Bürohaus Mitte",
      street: "Neue Straße",
      houseNo: "9",
      zip: "10115",
      city: "Berlin",
    },
  ];
  const history: Shift[] = [
    work({
      id: "old",
      date: "2026-09-01",
      start: "08:00",
      end: "12:00",
      tasks: ["Treppenhaus", "Fenster"],
      workCode: "UR",
    }),
    work({
      id: "recent",
      date: "2026-09-20",
      start: "14:00",
      end: "18:00",
      breakMinutes: 30,
      rate: 22,
      note: "Notiz bleibt dort",
      overtime: true,
      objectId: "obj-1",
      workplace: "Bürohaus Mitte",
      street: "Hauptstraße",
      houseNo: "5",
      zip: "10115",
      city: "Berlin",
      workCode: "GL",
      workCodeLabel: "Glasreinigung",
      workCodeNote: "3. OG",
      tasks: ["Fenster", "Rahmen"],
      photos: ["data:image/png;base64,AAA"],
      gps: { lat: 52.5, lng: 13.4 },
    }),
  ];

  it("findet den jüngsten Arbeitseintrag des Jobs", () => {
    expect(lastJobEntry(history, { jobId: "j1" })?.id).toBe("recent");
    expect(lastJobEntry(history, { jobId: "j1", excludeId: "recent" })?.id).toBe("old");
    expect(lastJobEntry(history, { jobId: "j9" })).toBeNull();
  });

  it("(10) übernimmt nur nicht-zeitliche Werte – kein Lohn, keine Notiz, keine Fotos, kein Standort", () => {
    const values = lastJobValues(history, { jobId: "j1" })!;
    expect(values).toMatchObject({
      sourceId: "recent",
      objectId: "obj-1",
      workCode: "GL",
      workCodeLabel: "Glasreinigung",
      workCodeNote: "3. OG",
      breakMinutes: 30,
      tasks: ["Fenster", "Rahmen"],
    });
    expect(Object.keys(values)).not.toContain("rate");
    expect(Object.keys(values)).not.toContain("note");
    expect(Object.keys(values)).not.toContain("photos");
    expect(Object.keys(values)).not.toContain("gps");
    expect(Object.keys(values)).not.toContain("overtime");
    expect(Object.keys(values)).not.toContain("id");
    expect(Object.keys(values)).not.toContain("date");
    expect(Object.keys(values)).not.toContain("start");
    expect(Object.keys(values)).not.toContain("end");
  });

  it("(10) Wiederholen nimmt die AKTUELLE Objektadresse, der historische Eintrag bleibt unberührt", () => {
    const payload = repeatPayload({ shifts: history, objects, jobId: "j1" })!;
    expect(payload.street).toBe("Neue Straße"); // Objekt ist umgezogen …
    expect(payload.houseNo).toBe("9");
    expect(history.find((s) => s.id === "recent")!.street).toBe("Hauptstraße"); // … Eintrag nicht.
  });

  it("Wiederholen behält den Adress-Schnappschuss, wenn das Objekt gelöscht wurde", () => {
    const payload = repeatPayload({ shifts: history, objects: [], jobId: "j1" })!;
    expect(payload.street).toBe("Hauptstraße");
    expect(payload.objectId).toBe("obj-1");
  });

  it("ohne vorherigen Eintrag gibt es nichts zu übernehmen", () => {
    expect(repeatPayload({ shifts: [], objects, jobId: "j1" })).toBeNull();
  });

  it("die Rückgabe ist eine Kopie: Ändern wirkt nicht auf den Bestand zurück", () => {
    const values = lastJobValues(history, { jobId: "j1" })!;
    values.tasks.push("Neu");
    expect(history.find((s) => s.id === "recent")!.tasks).toEqual(["Fenster", "Rahmen"]);
  });
});

describe("A3 Tätigkeits-Vorschläge", () => {
  const shifts: Shift[] = [
    work({
      id: "s1",
      date: "2026-09-01",
      tasks: ["Fenster", "Treppenhaus"],
      start: "08:00",
      end: "12:00",
    }),
    work({ id: "s2", date: "2026-09-08", tasks: ["Fenster"], start: "08:00", end: "12:00" }),
    work({
      id: "s3",
      date: "2026-09-15",
      tasks: ["Fenster", "Küche"],
      start: "08:00",
      end: "12:00",
    }),
    work({
      id: "s4",
      date: "2026-09-22",
      tasks: ["Küche", "#fenster"],
      start: "08:00",
      end: "12:00",
    }),
    work({
      id: "other",
      jobId: "j2",
      date: "2026-09-23",
      tasks: ["Fremd"],
      start: "08:00",
      end: "12:00",
    }),
  ];

  it("(7) 'Zuletzt' kommt aus dem letzten Eintrag, 'Häufig' aus der Historie des Jobs", () => {
    const groups = taskSuggestionsFromHistory({ shifts, jobId: "j1" });
    expect(groups.last).toEqual(["Küche", "#fenster"]);
    expect(groups.frequent).toContain("Fenster");
    expect(groups.frequent).toContain("Treppenhaus");
    // Keine Dubletten über die Gruppen hinweg.
    expect(groups.frequent).not.toContain("Küche");
  });

  it("Tätigkeiten anderer Jobs erscheinen nicht", () => {
    const groups = taskSuggestionsFromHistory({ shifts, jobId: "j1" });
    expect([...groups.last, ...groups.frequent]).not.toContain("Fremd");
  });

  it("bereits gewählte Tätigkeiten werden nicht erneut vorgeschlagen", () => {
    const groups = taskSuggestionsFromHistory({
      shifts,
      jobId: "j1",
      exclude: ["Küche", "Fenster"],
    });
    expect(groups.last).toEqual(["#fenster"]);
    expect(groups.frequent).not.toContain("Fenster");
  });

  it("Groß-/Kleinschreibung erzeugt keine Dublette", () => {
    const groups = taskSuggestionsFromHistory({
      shifts: [
        work({ id: "a", date: "2026-09-01", tasks: ["Fenster"], start: "08:00", end: "12:00" }),
        work({ id: "b", date: "2026-09-02", tasks: ["fenster"], start: "08:00", end: "12:00" }),
      ],
      jobId: "j1",
    });
    expect([...groups.last, ...groups.frequent]).toHaveLength(1);
  });

  it("die Anzahl der häufigen Vorschläge ist begrenzt", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      work({
        id: `m${i}`,
        date: `2026-08-${String(i + 1).padStart(2, "0")}`,
        tasks: [`T${i}`],
        start: "08:00",
        end: "12:00",
      }),
    );
    expect(
      taskSuggestionsFromHistory({ shifts: many, jobId: "j1", limit: 4 }).frequent,
    ).toHaveLength(4);
  });

  it("ohne Historie gibt es keine Vorschläge (und keinen Fehler)", () => {
    expect(taskSuggestionsFromHistory({ shifts: [], jobId: "j1" })).toEqual({
      last: [],
      frequent: [],
    });
  });
});

describe("F3/F4 Anschluss am Folgetag übernehmen", () => {
  const night = work({ id: "night", start: "22:00", end: "02:00" });

  it("(F4) setzt das Datum ausdrücklich auf den Folgetag, den Beginn, und LEERT das Ende", () => {
    const suggestion = continuationStart([night], { jobId: "j1", date: DAY })!;
    expect(suggestion.sameDay).toBe(false);
    const applied = applyContinuationTo([night], { jobId: "j1", suggestion });
    expect(applied.date).toBe(NEXT_DAY);
    expect(applied.start).toBe("02:00");
    expect(applied.end).toBe("");
    expect(applied.end).not.toBe(DEFAULT_ENTRY_END);
  });

  it("(F3) berechnet den Vorschlag für den NEUEN Tag neu – der Folgetag-Vorschlag verschwindet", () => {
    const suggestion = continuationStart([night], { jobId: "j1", date: DAY })!;
    const applied = applyContinuationTo([night], { jobId: "j1", suggestion });
    // Am Folgetag endet die Nachtschicht um 02:00 – das ist jetzt ein Anschluss am SELBEN Tag.
    expect(applied.continuation).toMatchObject({
      sameDay: true,
      date: NEXT_DAY,
      start: "02:00",
      sourceId: "night",
    });
  });

  it("(F3) liegt am Folgetag schon ein späterer Eintrag, wird DESSEN Ende der neue Vorschlag", () => {
    const later = work({ id: "later", date: NEXT_DAY, start: "08:00", end: "12:00" });
    const suggestion = continuationStart([night, later], { jobId: "j1", date: DAY })!;
    const applied = applyContinuationTo([night, later], { jobId: "j1", suggestion });
    // Der angetippte Beginn wird übernommen …
    expect(applied.start).toBe("02:00");
    // … und der neu berechnete Vorschlag zeigt das tatsächliche letzte Ende des neuen Tages.
    expect(applied.continuation).toMatchObject({
      sameDay: true,
      start: "12:00",
      sourceId: "later",
    });
  });

  it("(F3) idempotent: zweimal angewendet ergibt dasselbe", () => {
    const suggestion = continuationStart([night], { jobId: "j1", date: DAY })!;
    const first = applyContinuationTo([night], { jobId: "j1", suggestion });
    const second = applyContinuationTo([night], { jobId: "j1", suggestion });
    expect(second).toEqual(first);
  });

  it("(F3) idempotent: den neu berechneten Vorschlag anzuwenden ändert nichts mehr", () => {
    const suggestion = continuationStart([night], { jobId: "j1", date: DAY })!;
    const first = applyContinuationTo([night], { jobId: "j1", suggestion });
    const again = applyContinuationTo([night], { jobId: "j1", suggestion: first.continuation! });
    expect(again.date).toBe(first.date);
    expect(again.start).toBe(first.start);
    // Selber Tag: das Ende bleibt unangetastet (null = nicht ändern).
    expect(again.end).toBeNull();
    expect(again.continuation).toEqual(first.continuation);
  });

  it("am SELBEN Tag ändert das Übernehmen nur den Beginn, nie Datum oder Ende", () => {
    const shifts = [work({ id: "a", start: "08:00", end: "10:30" })];
    const suggestion = continuationStart(shifts, { jobId: "j1", date: DAY })!;
    const applied = applyContinuationTo(shifts, { jobId: "j1", suggestion });
    expect(applied).toEqual({ date: DAY, start: "10:30", end: null, continuation: suggestion });
  });

  it("verändert den Bestand nicht", () => {
    const shifts = [night];
    const snapshot = JSON.stringify(shifts);
    const suggestion = continuationStart(shifts, { jobId: "j1", date: DAY })!;
    applyContinuationTo(shifts, { jobId: "j1", suggestion });
    expect(JSON.stringify(shifts)).toBe(snapshot);
  });
});

describe("F4 Zeitfelder nach Job-, Datums- oder Artwechsel", () => {
  const sameDay = {
    start: "10:30",
    date: DAY,
    sameDay: true,
    sourceId: "a",
    sourceStart: "08:00",
    sourceEnd: "10:30",
  };
  const nextDay = { ...sameDay, start: "02:00", date: NEXT_DAY, sameDay: false };

  it("unberührte Felder + Anschluss: Beginn = Anschluss, Ende leer", () => {
    expect(
      reseedTimeFields({ continuation: sameDay, startTouched: false, endTouched: false }),
    ).toEqual({ start: "10:30", end: "" });
  });

  it("unberührte Felder ohne Anschluss: das bisherige Vorgabe-Paar 09:00–17:00", () => {
    expect(
      reseedTimeFields({ continuation: null, startTouched: false, endTouched: false }),
    ).toEqual({ start: DEFAULT_ENTRY_START, end: DEFAULT_ENTRY_END });
    expect(
      reseedTimeFields({ continuation: nextDay, startTouched: false, endTouched: false }),
    ).toEqual({ start: DEFAULT_ENTRY_START, end: DEFAULT_ENTRY_END });
  });

  it("(F4) selbst gewählter Beginn ohne Anschluss: KEIN stilles 17:00-Ende", () => {
    const patch = reseedTimeFields({ continuation: null, startTouched: true, endTouched: false });
    expect(patch).toEqual({});
    expect(patch.end).toBeUndefined();
  });

  it("(F4) selbst gewählter Beginn mit Folgetag-Vorschlag: ebenfalls kein 17:00-Ende", () => {
    expect(
      reseedTimeFields({ continuation: nextDay, startTouched: true, endTouched: false }),
    ).toEqual({});
  });

  it("selbst gesetzte Felder werden nie überschrieben", () => {
    expect(
      reseedTimeFields({ continuation: sameDay, startTouched: true, endTouched: true }),
    ).toEqual({});
    expect(
      reseedTimeFields({ continuation: sameDay, startTouched: false, endTouched: true }),
    ).toEqual({ start: "10:30" });
  });
});
