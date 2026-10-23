import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultRateBelowMinimum } from "./wage-compliance";

/** QA P3-INT-143-a/-b/-c (#143 Testlücken M143-4, M143-5; Hinweis für Bestände 2026). */
describe("B6-1 Ergänzungen", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("M143-4: neues Konto (unbekannter Scope) 2027 → 14,60 €", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-01T10:00:00"));
    const store = await import("./store");
    const { userScope } = await import("./storage-scope");
    store.loadFromStorage();
    store.activateScope(userScope("00000000-0000-4000-8000-000000000001"));
    expect(store.getData().settings.defaultRate).toBe(14.6);
  });

  it("M143-4: neues Konto am 31.12.2026 → 13,90 € (Stichtag)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-31T23:00:00"));
    const store = await import("./store");
    const { userScope } = await import("./storage-scope");
    store.loadFromStorage();
    store.activateScope(userScope("00000000-0000-4000-8000-000000000002"));
    expect(store.getData().settings.defaultRate).toBe(13.9);
  });

  it("M143-5: Altbestand ohne defaultRate-Schlüssel → 13,90 € (keine Migration auf Mindestlohn)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-01T10:00:00"));
    const store = await import("./store");
    const n = store.normalize({ settings: { onboarded: true } as never });
    expect(n.settings.defaultRate).toBe(13.9);
  });

  it("Hinweis bei Standardlohn unter Mindestlohn – nur Anzeige, Satz unverändert", () => {
    expect(defaultRateBelowMinimum(13.9, "2026-10-15")).toEqual({
      from: "2027-01-01",
      minimum: 14.6,
    });
    expect(defaultRateBelowMinimum(13.9, "2027-02-01")).toEqual({
      from: "2027-02-01",
      minimum: 14.6,
    });
    expect(defaultRateBelowMinimum(14.6, "2027-02-01")).toBeUndefined();
    expect(defaultRateBelowMinimum(13.9, "2026-06-01")).toEqual({
      from: "2027-01-01",
      minimum: 14.6,
    });
    expect(defaultRateBelowMinimum(15, "2026-06-01")).toBeUndefined();
  });

  it("Einstellungen zeigen den Hinweis am Standard-Stundenlohn und ändern nichts", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../routes/einstellungen.tsx"),
      "utf8",
    );
    expect(src).toMatch(/<DefaultRateMinimumNote rate=\{settings\.defaultRate\} \/>/);
    const fn = src.slice(src.indexOf("function DefaultRateMinimumNote"));
    expect(fn).not.toMatch(/updateSettings|saveJob/);
  });
});
