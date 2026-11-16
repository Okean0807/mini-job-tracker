/**
 * B6 – Entwurf im echten Editor: schließen/öffnen, Speichern und "Speichern & Neuer Eintrag"
 * räumen auf, Fehler und Schließen nicht, ausdrückliches Verwerfen, Konto-/Job-Isolation,
 * B2/B3/B4/B5 bleiben im Entwurf erhalten.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  entryDraftStorageKey,
  loadEntryDraft,
  saveEntryDraft,
  type EntryDraftFields,
} from "@/lib/minijob/entry-draft";
import { DEMO_SCOPE, userScope } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  getData,
  isPersistFailed,
  replaceAll,
  EMPTY_DATA,
} from "@/lib/minijob/store";
import { DEFAULT_SETTINGS, type WorkObject } from "@/lib/minijob/types";
import { act } from "react";
import {
  click,
  closed,
  has,
  open,
  q,
  save,
  setValue,
  setup,
  teardown,
  unmount,
} from "./entry-test-harness";

const JOBS = [
  { id: "j1", name: "Reinigung Nord", color: "#0d9488", mode: "flex" as const },
  { id: "j2", name: "Lager Süd", color: "#2563eb", mode: "flex" as const },
];
const OBJECTS: WorkObject[] = [
  {
    id: "o1",
    name: "Bürohaus Mitte",
    street: "Hauptstraße",
    houseNo: "5",
    zip: "10115",
    city: "Berlin",
  },
];

beforeEach(() => setup({ jobs: JOBS, objects: OBJECTS }));
afterEach(() => {
  vi.restoreAllMocks();
  teardown();
});

const start = () => q<HTMLInputElement>("#von");
const end = () => q<HTMLInputElement>("#bis");
const pause = () => q<HTMLInputElement>("#pause");
const note = () => q<HTMLTextAreaElement>("#notiz");
const draft = (jobId = "j1") => loadEntryDraft(jobId);
const jobChip = (name: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(name))!;
const openMore = () => {
  if (!has("#notiz")) click(q('[data-testid="entry-more-toggle"]'));
};
const reopen = () => {
  unmount();
  open(null);
};

describe("B6 Entwurf anlegen und wiederherstellen", () => {
  it("bloßes Öffnen und Schließen legt keinen Entwurf an", () => {
    open(null);
    unmount();
    expect(window.localStorage.getItem(entryDraftStorageKey())).toBeNull();
  });

  it("Eingaben werden als Entwurf gesichert – nie als gespeicherter Eintrag", () => {
    open(null);
    setValue(start(), "08:00");
    openMore();
    setValue(note(), "Schlüssel beim Hausmeister");
    expect(draft()).toMatchObject({ start: "08:00", note: "Schlüssel beim Hausmeister" });
    expect(getData().shifts).toHaveLength(0);
    expect(q('[data-testid="entry-draft-banner"]')).toBeTruthy();
  });

  it("Schließen und erneutes Öffnen stellt den Entwurf wieder her (Schließen verwirft nie)", () => {
    open(null);
    setValue(start(), "08:00");
    openMore();
    setValue(note(), "Notiz 1");
    click(q('[data-testid="pause-chip-45"]'));
    click(q('[data-testid="object-picker-trigger"]'));
    click(q('[data-testid="object-option-o1"]'));
    unmount();
    expect(draft()).not.toBeNull(); // Schließen hat nichts gelöscht
    open(null);
    expect(start().value).toBe("08:00");
    expect(pause().value).toBe("45");
    expect(q('[data-testid="pause-chip-45"]').getAttribute("aria-pressed")).toBe("true");
    expect(q('[data-testid="object-picker-trigger"]').textContent).toContain("Bürohaus Mitte");
    expect(q('[data-testid="object-picker-trigger"]').textContent).toContain("Hauptstraße 5");
    expect(note().value).toBe("Notiz 1");
    expect(q('[data-testid="entry-draft-banner"]')).toBeTruthy();
    expect(getData().shifts).toHaveLength(0);
  });

  it("B4 Dauer überlebt: Chip-Ende wird wiederhergestellt und bleibt als Dauer erkennbar", () => {
    open(null);
    setValue(start(), "09:00");
    click(q('[data-testid="duration-chip-6"]'));
    reopen();
    expect(end().value).toBe("15:00");
    expect(q('[data-testid="duration-chip-6"]').getAttribute("aria-pressed")).toBe("true");
    expect(q<HTMLButtonElement>('[data-testid="duration-chip-4"]').disabled).toBe(false); // nicht von Hand
  });

  it("ein von Hand getipptes Ende bleibt gesperrt (endTouched überlebt)", () => {
    open(null);
    setValue(start(), "09:00");
    setValue(end(), "15:20");
    reopen();
    expect(end().value).toBe("15:20");
    expect(q<HTMLButtonElement>('[data-testid="duration-chip-4"]').disabled).toBe(true);
  });

  it("B2: ausdrückliche Pause 0 bleibt 0", () => {
    open(null);
    click(q('[data-testid="pause-chip-0"]'));
    reopen();
    expect(pause().value).toBe("0");
  });

  it("nach der Wiederherstellung gehen eigene Eingaben nicht verloren und aktualisieren den Entwurf", () => {
    open(null);
    openMore();
    setValue(note(), "alt");
    reopen();
    openMore();
    setValue(note(), "neu getippt");
    open(null); // gleiche Props: kein erneutes Befüllen
    expect(note().value).toBe("neu getippt");
    expect(draft()!.note).toBe("neu getippt");
  });

  it("Entwurf für Beginn bleibt Beginn: B5-Anschluss und leeres Ende nach Speichern & Neu", () => {
    open(null);
    setValue(start(), "08:00");
    setValue(end(), "12:00");
    reopen();
    expect(start().value).toBe("08:00");
    click(q('[data-testid="entry-save-new"]'));
    expect(getData().shifts).toHaveLength(1);
    expect(start().value).toBe("12:00");
    expect(end().value).toBe("");
  });
});

describe("B6 Aufräumen", () => {
  it("Speichern löscht den Entwurf", () => {
    open(null);
    setValue(start(), "08:00");
    setValue(end(), "12:00");
    expect(draft()).not.toBeNull();
    save();
    expect(getData().shifts).toHaveLength(1);
    expect(draft()).toBeNull();
    expect(closed.count).toBe(1);
  });

  it("Speichern & Neuer Eintrag löscht den alten Entwurf und übernimmt nichts in den neuen", () => {
    open(null);
    setValue(start(), "08:00");
    setValue(end(), "12:00");
    openMore();
    setValue(note(), "alter Eintrag");
    click(q('[data-testid="object-picker-trigger"]'));
    click(q('[data-testid="object-option-o1"]'));
    click(q('[data-testid="entry-save-new"]'));
    expect(draft()).toBeNull();
    expect(has('[data-testid="entry-draft-banner"]')).toBe(false);
    // neuer Eintrag: erst bei einer Eingabe entsteht ein neuer Entwurf – ohne Altes
    setValue(end(), "14:00");
    const next = draft()!;
    expect(next).toMatchObject({ start: "12:00", end: "14:00" });
    expect(next.note).toBeUndefined();
    expect(next.objectId).toBeUndefined();
    expect(next.street).toBeUndefined();
    expect(getData().shifts).toHaveLength(1);
  });

  it("Speichern eines BESTEHENDEN Eintrags berührt den Entwurf eines neuen Eintrags nicht", () => {
    saveEntryDraft("j1", draftFields({ note: "bleibt" }));
    teardown();
    setup({
      jobs: JOBS,
      shifts: [
        {
          id: "old",
          kind: "arbeit",
          date: "2026-09-20",
          start: "08:00",
          end: "12:00",
          breakMinutes: 0,
          jobId: "j1",
        },
      ],
    });
    saveEntryDraft("j1", draftFields({ note: "bleibt" }));
    open("old");
    expect(has('[data-testid="entry-draft-banner"]')).toBe(false);
    setValue(end(), "13:00");
    save();
    expect(getData().shifts.find((s) => s.id === "old")!.end).toBe("13:00");
    expect(draft()!.note).toBe("bleibt");
  });

  it("Validierungsfehler behalten den Entwurf", () => {
    open(null);
    setValue(start(), "09:00");
    setValue(end(), "09:00"); // Dauer 0 → blockiert
    openMore();
    setValue(note(), "bleibt");
    save();
    expect(getData().shifts).toHaveLength(0);
    expect(draft()).toMatchObject({ note: "bleibt", start: "09:00" });
  });

  it("abgelehnter Gerätespeicher behält den Entwurf (Speichern und Speichern & Neu)", () => {
    open(null);
    setValue(start(), "08:00");
    setValue(end(), "12:00");
    openMore();
    setValue(note(), "sicher");
    const original = window.localStorage.setItem.bind(window.localStorage);
    const spy = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation((k: string, v: string) => {
        if (k.startsWith("minijob-entry-draft")) return original(k, v);
        throw new Error("quota");
      });
    click(q('[data-testid="entry-save-new"]'));
    expect(isPersistFailed()).toBe(true);
    expect(draft()).toMatchObject({ note: "sicher" });
    expect(has('[data-testid="entry-save"]')).toBe(true); // Formular bleibt (B5)
    save(); // schließendes Speichern bei weiter abgelehntem Speicher
    expect(isPersistFailed()).toBe(true);
    expect(draft()).toMatchObject({ note: "sicher" });
    expect(getData().shifts).toHaveLength(1); // B5: kein Duplikat
    spy.mockRestore(); // der Spy darf nicht in spätere Tests hineinwirken
  });
});

describe("B6 ausdrückliches Verwerfen", () => {
  it("Abbrechen schließt nur; der Entwurf bleibt", () => {
    open(null);
    setValue(start(), "08:00");
    const cancel = [...document.querySelectorAll('[data-testid="shift-dialog"] button')].find(
      (b) => b.textContent === "Abbrechen",
    )!;
    click(cancel);
    expect(closed.count).toBe(1);
    expect(draft()).not.toBeNull();
  });

  it("Verwerfen verlangt Bestätigung; Zurück behält den Entwurf", () => {
    open(null);
    setValue(start(), "08:00");
    click(q('[data-testid="entry-draft-discard"]'));
    expect(draft()).not.toBeNull();
    expect(q('[data-testid="entry-draft-discard-dialog"]')).toBeTruthy();
    const back = [
      ...document.querySelectorAll('[data-testid="entry-draft-discard-dialog"] button'),
    ].find((b) => b.textContent !== "Verwerfen")!;
    click(back);
    expect(draft()).not.toBeNull();
  });

  it("bestätigtes Verwerfen löscht nur den Entwurf dieses Jobs und leert das Formular", () => {
    saveEntryDraft("j2", draftFields({ note: "anderer Job" }));
    open(null);
    setValue(start(), "08:00");
    openMore();
    setValue(note(), "weg damit");
    click(q('[data-testid="entry-draft-discard"]'));
    click(q('[data-testid="entry-draft-discard-confirm"]'));
    expect(draft("j1")).toBeNull();
    expect(draft("j2")!.note).toBe("anderer Job");
    expect(getData().shifts).toHaveLength(0);
    expect(has('[data-testid="entry-draft-banner"]')).toBe(false);
    expect(closed.count).toBe(0);
    expect(start().value).toBe("09:00");
    expect(end().value).toBe("17:00");
    reopen();
    expect(has('[data-testid="entry-draft-banner"]')).toBe(false);
  });
});

describe("B6 Isolation", () => {
  it("Entwurf eines anderen Jobs wird nicht wiederhergestellt", () => {
    saveEntryDraft("j2", draftFields({ note: "nur j2", start: "10:00" }));
    open(null);
    expect(start().value).toBe("09:00");
    expect(has('[data-testid="entry-draft-banner"]')).toBe(false);
    click(jobChip("Lager Süd")); // Jobwechsel im offenen Dialog tauscht keinen Entwurf ein
    expect(start().value).toBe("09:00");
    expect(has('[data-testid="entry-draft-banner"]')).toBe(false);
    expect(draft("j2")).toMatchObject({ note: "nur j2", start: "10:00" }); // unverändert
  });

  it("Entwurf eines anderen Kontos wird nicht wiederhergestellt – im eigenen Konto schon", () => {
    open(null);
    setValue(start(), "08:00");
    unmount();
    expect(draft()).not.toBeNull();

    act(() => {
      activateScope(userScope("other-account"));
      replaceAll({
        ...EMPTY_DATA,
        jobs: JOBS,
        settings: { ...DEFAULT_SETTINGS, onboarded: true },
      } as never);
    });
    open(null);
    expect(start().value).toBe("09:00");
    expect(has('[data-testid="entry-draft-banner"]')).toBe(false);
    expect(loadEntryDraft("j1")).toBeNull();
    unmount();

    act(() => {
      activateScope(DEMO_SCOPE);
    });
    open(null);
    expect(start().value).toBe("08:00");
  });

  it("Jobwechsel im offenen Dialog: der Entwurf bleibt unter dem Job, bei dem er begann; fremde Entwürfe bleiben unberührt", () => {
    saveEntryDraft("j2", draftFields({ note: "alt j2" }));
    open(null);
    setValue(start(), "08:00");
    expect(draft("j1")).not.toBeNull();
    click(jobChip("Lager Süd"));
    setValue(end(), "12:00");
    expect(draft("j1")).toMatchObject({ start: "08:00", end: "12:00" });
    expect(draft("j2")!.note).toBe("alt j2");
  });
});

describe("B6 Robustheit", () => {
  it("beschädigter Entwurf: Editor öffnet normal mit den Standardwerten", () => {
    window.localStorage.setItem(entryDraftStorageKey(), "{kaputt");
    expect(() => open(null)).not.toThrow();
    expect(start().value).toBe("09:00");
    expect(has('[data-testid="entry-draft-banner"]')).toBe(false);
  });

  it("Abwesenheiten erzeugen keinen Entwurf", () => {
    open(null);
    const urlaub = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Urlaub",
    );
    expect(urlaub).toBeTruthy();
    click(urlaub!);
    expect(draft()).toBeNull();
  });
});

function draftFields(over: Partial<EntryDraftFields> = {}): EntryDraftFields {
  return {
    date: "2026-09-24",
    start: "08:00",
    end: "",
    startTouched: true,
    endTouched: false,
    breakMinutes: "30",
    tasks: [],
    ...over,
  };
}
