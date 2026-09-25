/**
 * Store-Anbindung der Kataloge (Leistungsarten/Tätigkeiten):
 * - loadScopeState zieht Kataloge ADD-only aus Schichten des Scopes nach (M3)
 * - normalize filtert kaputte Katalog-Einträge (M9)
 * - Katalog-Änderungen laufen über updateSettings → Sync-Hook (localChangedAt) (M10)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEMO_SCOPE } from "./storage-scope";
import {
  activateScope,
  deleteCustomTask,
  deleteWorkCodeDef,
  getData,
  loadFromStorage,
  normalize,
  onDataChange,
  upsertCustomTask,
  upsertWorkCodeDef,
} from "./store";
import { DEFAULT_SETTINGS, type AppData } from "./types";

function clearAppKeys() {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
}

beforeEach(() => {
  clearAppKeys();
});

afterEach(() => {
  onDataChange(null);
});

describe("loadScopeState: Kataloge aus Schichten des Scopes", () => {
  it("zieht Leistungsart + freie Tätigkeit aus gespeicherten Schichten in settings nach", () => {
    window.localStorage.setItem(
      "minijob-tracker-v1:demo",
      JSON.stringify({
        jobs: [],
        shifts: [
          {
            id: "s1",
            kind: "arbeit",
            date: "2026-09-20",
            start: "08:00",
            end: "10:00",
            breakMinutes: 0,
            workCode: "XY",
            workCodeLabel: "Xylophonreinigung",
            tasks: ["Dachrinne prüfen", "#fenster"],
          },
        ],
        settings: { ...DEFAULT_SETTINGS, onboarded: true, localDemoMode: true },
      }),
    );
    loadFromStorage();
    activateScope(DEMO_SCOPE);
    const settings = getData().settings;
    expect(settings.workCodes).toEqual([{ code: "XY", label: "Xylophonreinigung" }]);
    expect(settings.customTasks).toEqual(["Dachrinne prüfen"]);
    // Nachgezogen im Scope-Stand, kein globaler Key.
    expect(window.localStorage.getItem("minijob-tracker-v1")).toBeNull();
    expect(window.localStorage.getItem("minijob-tracker-v1:demo")).toContain("Xylophonreinigung");
  });
});

describe("normalize: Katalog-Filter", () => {
  it("entfernt leere/ungültige Tätigkeiten und Leistungsarten", () => {
    const data = normalize({
      settings: {
        ...DEFAULT_SETTINGS,
        customTasks: ["Gültig", "", "   ", 42, null] as unknown as string[],
        workCodes: [
          { code: "AB", label: "Gültig" },
          null,
          "XY",
          { code: 1, label: "x" },
          { code: "CD" },
        ] as unknown as AppData["settings"]["workCodes"],
      },
    } as Partial<AppData>);
    expect(data.settings.customTasks).toEqual(["Gültig"]);
    expect(data.settings.workCodes).toEqual([{ code: "AB", label: "Gültig" }]);
  });
});

describe("Katalog-Änderungen markieren den Datenstand für den Sync", () => {
  it("upsert/delete von Leistungsart und Tätigkeit feuern den Sync-Hook mit neuem Katalog", () => {
    loadFromStorage();
    activateScope(DEMO_SCOPE);
    const seen: AppData[] = [];
    onDataChange((data) => seen.push(data));

    const codes = () => seen.at(-1)?.settings.workCodes ?? [];
    const tasks = () => seen.at(-1)?.settings.customTasks ?? [];
    upsertWorkCodeDef({ code: "fs", label: "Fassadenschutz" });
    expect(codes()).toContainEqual({ code: "FS", label: "Fassadenschutz" });
    upsertCustomTask("Rinne säubern");
    expect(tasks()).toContain("Rinne säubern");
    deleteWorkCodeDef("FS");
    expect(codes().some((c) => c.code === "FS")).toBe(false);
    deleteCustomTask("Rinne säubern");
    expect(tasks()).not.toContain("Rinne säubern");
    expect(seen).toHaveLength(4);
  });
});
