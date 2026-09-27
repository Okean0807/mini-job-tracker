/**
 * Kataloge (eigene Leistungsarten / Tätigkeiten) sind Teil des Scope-Stands
 * (settings in minijob-tracker-v1:<scope>) – kein globaler Key, kein Leck
 * zwischen Testmodus, Gast und Konto (#114).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_SCOPE, GUEST_SCOPE, userScope } from "./storage-scope";

function clearAppKeys() {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
}

async function freshStore() {
  vi.resetModules();
  const store = await import("./store");
  store.loadFromStorage();
  return store;
}

beforeEach(() => {
  clearAppKeys();
});

describe("Katalog-Persistenz ist scoped", () => {
  it("Testmodus-Katalog leckt nicht in Gast oder Konto; kein globaler Key", async () => {
    const store = await freshStore();
    store.activateScope(DEMO_SCOPE);
    store.upsertWorkCodeDef({ code: "GL", label: "Glasreinigung" });
    store.upsertCustomTask("Dachfenster reinigen");
    store.saveShift({
      id: "s1",
      kind: "arbeit",
      date: "2026-09-24",
      start: "08:00",
      end: "12:00",
      breakMinutes: 0,
      workCode: "FS",
      workCodeLabel: "Fassadenschutz",
      tasks: ["Rinne säubern"],
    });
    expect(store.getData().settings.workCodes).toEqual([
      { code: "GL", label: "Glasreinigung" },
      { code: "FS", label: "Fassadenschutz" },
    ]);
    expect(store.getData().settings.customTasks).toEqual(["Dachfenster reinigen", "Rinne säubern"]);

    store.activateScope(GUEST_SCOPE);
    expect(store.getData().settings.workCodes ?? []).toEqual([]);
    expect(store.getData().settings.customTasks ?? []).toEqual([]);

    store.activateScope(userScope("user-a"));
    expect(store.getData().settings.workCodes ?? []).toEqual([]);
    expect(store.getData().settings.customTasks ?? []).toEqual([]);
    store.upsertCustomTask("Nur Konto A");

    // Speicher: nur Scope-Schlüssel, der globale Datenschlüssel bleibt unbeschrieben.
    expect(window.localStorage.getItem("minijob-tracker-v1")).toBeNull();
    const demoRaw = window.localStorage.getItem("minijob-tracker-v1:demo") ?? "";
    expect(demoRaw).toContain("Glasreinigung");
    expect(demoRaw).toContain("Dachfenster reinigen");
    expect(demoRaw).not.toContain("Nur Konto A");
    expect(window.localStorage.getItem("minijob-tracker-v1:guest") ?? "").not.toMatch(
      /Glasreinigung|Dachfenster|Nur Konto A/,
    );
    const userRaw = window.localStorage.getItem("minijob-tracker-v1:u:user-a") ?? "";
    expect(userRaw).toContain("Nur Konto A");
    expect(userRaw).not.toMatch(/Glasreinigung|Dachfenster/);
    const keys = Object.keys(window.localStorage).filter((k) => k.startsWith("minijob-"));
    expect(keys.filter((k) => /catalog|work-?code|task/i.test(k))).toEqual([]);

    // Zurück in den Testmodus (auch nach Neustart): Katalog wieder da.
    store.activateScope(DEMO_SCOPE);
    expect(store.getData().settings.customTasks).toEqual(["Dachfenster reinigen", "Rinne säubern"]);
    const restarted = await freshStore();
    expect(restarted.getActiveScope().kind).toBe("demo");
    expect(restarted.getData().settings.workCodes?.map((c) => c.code)).toEqual(["GL", "FS"]);
  });

  it("Legacy-Katalog im globalen Key wird keinem Scope automatisch zugeordnet", async () => {
    window.localStorage.setItem(
      "minijob-tracker-v1",
      JSON.stringify({
        shifts: [],
        jobs: [],
        settings: {
          onboarded: true,
          workCodes: [{ code: "LG", label: "Legacy-Code" }],
          customTasks: ["Legacy-Tätigkeit"],
        },
      }),
    );
    const store = await freshStore();
    expect(store.getActiveScope().kind).toBe("guest");
    expect(store.getData().settings.workCodes ?? []).toEqual([]);
    store.activateScope(DEMO_SCOPE);
    expect(store.getData().settings.customTasks ?? []).toEqual([]);
    store.activateScope(userScope("user-b"));
    expect(store.getData().settings.workCodes ?? []).toEqual([]);
  });
});
