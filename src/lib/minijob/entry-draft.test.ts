/** B6 – Speicherung der Entwürfe: Namensraum, Job, beschädigte/veraltete Daten, Inhalt. */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearEntryDraft,
  ENTRY_DRAFT_KEY,
  ENTRY_DRAFT_MAX_AGE_MS,
  entryDraftStorageKey,
  hasEntryDraft,
  loadEntryDraft,
  normalizeEntryDraftFields,
  saveEntryDraft,
  type EntryDraftFields,
} from "./entry-draft";
import { clearUserScopeLocalData, DEMO_SCOPE, userScope } from "./storage-scope";

const A = userScope("user-a");
const B = userScope("user-b");

const fields = (over: Partial<EntryDraftFields> = {}): EntryDraftFields => ({
  date: "2026-09-24",
  start: "08:00",
  end: "",
  startTouched: true,
  endTouched: false,
  breakMinutes: "45",
  tasks: ["Fenster"],
  note: "Schlüssel",
  objectId: "o1",
  street: "Hauptstraße",
  ...over,
});

beforeEach(() => window.localStorage.clear());

describe("Schlüssel", () => {
  it("Scope-Suffix steht am Ende (Kontolöschung räumt per Suffix auf)", () => {
    expect(entryDraftStorageKey(A)).toBe(`${ENTRY_DRAFT_KEY}:u:user-a`);
    expect(entryDraftStorageKey(DEMO_SCOPE)).toBe(`${ENTRY_DRAFT_KEY}:demo`);
    saveEntryDraft("j1", fields(), { scope: A });
    expect(window.localStorage.getItem(entryDraftStorageKey(A))).toBeTruthy();
    clearUserScopeLocalData("user-a");
    expect(window.localStorage.getItem(entryDraftStorageKey(A))).toBeNull();
  });
});

describe("Anlegen und Lesen", () => {
  it("Roundtrip je Konto und Job", () => {
    expect(saveEntryDraft("j1", fields(), { scope: A })).toBe(true);
    expect(loadEntryDraft("j1", { scope: A })).toEqual(fields());
    expect(hasEntryDraft("j1", { scope: A })).toBe(true);
  });

  it("Konto-Isolation: Entwurf von A erscheint nie in B", () => {
    saveEntryDraft("j1", fields(), { scope: A });
    expect(loadEntryDraft("j1", { scope: B })).toBeNull();
    expect(loadEntryDraft("j1", { scope: DEMO_SCOPE })).toBeNull();
    clearEntryDraft("j1", { scope: B }); // fremdes Löschen verändert A nicht
    expect(loadEntryDraft("j1", { scope: A })).not.toBeNull();
  });

  it("Job-Isolation: Entwurf von j1 erscheint nie bei j2; Löschen trifft nur den eigenen Job", () => {
    saveEntryDraft("j1", fields({ note: "eins" }), { scope: A });
    saveEntryDraft("j2", fields({ note: "zwei" }), { scope: A });
    saveEntryDraft(undefined, fields({ note: "ohne" }), { scope: A });
    expect(loadEntryDraft("j1", { scope: A })!.note).toBe("eins");
    expect(loadEntryDraft("j2", { scope: A })!.note).toBe("zwei");
    expect(loadEntryDraft(undefined, { scope: A })!.note).toBe("ohne");
    expect(loadEntryDraft("j3", { scope: A })).toBeNull();
    clearEntryDraft("j1", { scope: A });
    expect(loadEntryDraft("j1", { scope: A })).toBeNull();
    expect(loadEntryDraft("j2", { scope: A })!.note).toBe("zwei");
    expect(loadEntryDraft(undefined, { scope: A })!.note).toBe("ohne");
  });

  it("speichert weder Fotos noch GPS noch Id noch Berechnetes", () => {
    const dirty = {
      ...fields(),
      id: "shift-1",
      photos: ["data:image/png;base64,AAAA"],
      gps: { lat: 1, lng: 2 },
      earnings: 123.45,
      totalHours: 7.5,
      sickCaseId: "case-1",
    } as unknown as EntryDraftFields;
    saveEntryDraft("j1", dirty, { scope: A });
    const raw = window.localStorage.getItem(entryDraftStorageKey(A))!;
    for (const forbidden of [
      "shift-1",
      "photos",
      "gps",
      "earnings",
      "totalHours",
      "sickCaseId",
      "AAAA",
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("lehnt der Speicher ab, liefert saveEntryDraft false und wirft nicht", () => {
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(saveEntryDraft("j1", fields(), { scope: A })).toBe(false);
    spy.mockRestore();
  });
});

describe("beschädigte, veraltete und fremde Daten", () => {
  const key = entryDraftStorageKey(A);
  const put = (value: unknown) =>
    window.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  const file = (draft: unknown, savedAt = Date.now()) => ({
    v: 1,
    drafts: { "j:j1": { savedAt, fields: draft } },
  });

  it.each([
    ["kein JSON", "{kaputt"],
    ["null", "null"],
    ["Zahl", "42"],
    ["Array", "[]"],
    ["andere Version", JSON.stringify({ v: 2, drafts: {} })],
    ["drafts fehlt", JSON.stringify({ v: 1 })],
    ["drafts kein Objekt", JSON.stringify({ v: 1, drafts: 5 })],
  ])("%s → kein Entwurf, kein Absturz", (_name, raw) => {
    put(raw);
    expect(loadEntryDraft("j1", { scope: A })).toBeNull();
    expect(saveEntryDraft("j1", fields(), { scope: A })).toBe(true); // überschreibt Defektes
    expect(loadEntryDraft("j1", { scope: A })).not.toBeNull();
  });

  it("ungültige Felder verwerfen den Entwurf; die übrigen bleiben nutzbar", () => {
    put({
      v: 1,
      drafts: {
        "j:j1": { savedAt: Date.now(), fields: { ...fields(), date: "2026-13-45" } },
        "j:j2": { savedAt: Date.now(), fields: { ...fields(), start: "25:99" } },
        "j:j3": { savedAt: Date.now(), fields: fields({ note: "ok" }) },
        "j:j4": { savedAt: "gestern", fields: fields() },
      },
    });
    expect(loadEntryDraft("j1", { scope: A })).toBeNull();
    expect(loadEntryDraft("j2", { scope: A })).toBeNull();
    expect(loadEntryDraft("j3", { scope: A })!.note).toBe("ok");
    expect(loadEntryDraft("j4", { scope: A })).toBeNull();
  });

  it("veraltete Entwürfe (älter als 30 Tage) und solche aus der Zukunft werden nicht angewendet", () => {
    const now = Date.now();
    put(file(fields(), now - ENTRY_DRAFT_MAX_AGE_MS - 1000));
    expect(loadEntryDraft("j1", { scope: A, now })).toBeNull();
    put(file(fields(), now - ENTRY_DRAFT_MAX_AGE_MS + 60_000));
    expect(loadEntryDraft("j1", { scope: A, now })).not.toBeNull();
    put(file(fields(), now + 3 * 24 * 60 * 60 * 1000));
    expect(loadEntryDraft("j1", { scope: A, now })).toBeNull();
  });

  it("unbrauchbare Pause fällt auf den Standard zurück, falsche Typen werden ignoriert", () => {
    const out = normalizeEntryDraftFields({
      ...fields(),
      breakMinutes: "abc",
      note: 5,
      overtime: "ja",
      tasks: ["a", 3, ""],
    })!;
    expect(out.breakMinutes).toBe("30");
    expect(out.note).toBeUndefined();
    expect(out.overtime).toBeUndefined();
    expect(out.tasks).toEqual(["a"]);
  });

  it("clear entfernt den Schlüssel, wenn kein Entwurf mehr übrig ist", () => {
    saveEntryDraft("j1", fields(), { scope: A });
    clearEntryDraft("j1", { scope: A });
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});
