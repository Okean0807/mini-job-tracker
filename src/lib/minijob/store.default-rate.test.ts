import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** B6-1: Standard-Stundenlohn neuer Datenstände = Mindestlohn zum Stichtag; Bestand bleibt unverändert. */
describe("Standard-Stundenlohn beim Erststart (B6-1)", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("initialDefaultRate folgt dem Mindestlohn zum Stichtag", async () => {
    const { initialDefaultRate } = await import("./store");
    expect(initialDefaultRate("2026-12-31")).toBe(13.9);
    expect(initialDefaultRate("2027-01-01")).toBe(14.6);
    // Ohne Regelversion (vor 2024): Fallback auf den bisherigen Standard
    expect(initialDefaultRate("2020-01-01")).toBe(13.9);
  });

  it("Nach der letzten hinterlegten Regelversion gilt weiter deren Mindestlohn (kein Rückfall auf 13,90 €)", async () => {
    const { initialDefaultRate } = await import("./store");
    expect(initialDefaultRate("2028-06-01")).toBe(14.6);
    expect(initialDefaultRate("2035-01-01")).toBe(14.6);
  });

  it("Erststart am 02.01.2027 → 14,60 €", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-02T10:00:00"));
    const store = await import("./store");
    store.loadFromStorage();
    expect(store.getData().settings.defaultRate).toBe(14.6);
  });

  it("Erststart am 31.12.2026 → 13,90 €", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-31T10:00:00"));
    const store = await import("./store");
    store.loadFromStorage();
    expect(store.getData().settings.defaultRate).toBe(13.9);
  });

  it("bestehender Datenstand mit 13,90 € bleibt 2027 unverändert", async () => {
    const seed = await import("./store");
    seed.loadFromStorage();
    seed.updateSettings({ defaultRate: 13.9 });
    seed.saveJob({ id: "j1", name: "Alt", color: "#000", mode: "flex", rate: 13.9 });
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-02-01T10:00:00"));
    const store = await import("./store");
    store.loadFromStorage();
    expect(store.getData().settings.defaultRate).toBe(13.9);
    expect(store.getData().jobs.find((j) => j.id === "j1")?.rate).toBe(13.9);
  });

  it("neuer Namensraum (Konto) 2027 → 14,60 €; bestehender Namensraum behält seinen gespeicherten Satz", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-31T10:00:00"));
    const store = await import("./store");
    const scopes = await import("./storage-scope");
    store.loadFromStorage();
    expect(store.getData().settings.defaultRate).toBe(13.9);
    // Gast-Bestand speichern (13,90 € aus 2026)
    store.updateSettings({ language: "en" });

    vi.setSystemTime(new Date("2027-02-01T10:00:00"));
    store.activateScope(scopes.userScope("neu-2027"));
    expect(store.getData().settings.defaultRate).toBe(14.6);

    // Zurück in den bestehenden Namensraum: Satz unverändert
    store.activateScope(scopes.GUEST_SCOPE);
    expect(store.getData().settings.defaultRate).toBe(13.9);
  });

  it("Sprachwechsel ändert den Standard-Stundenlohn nicht (neuer und bestehender Bestand)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-02-01T10:00:00"));
    const fresh = await import("./store");
    fresh.loadFromStorage();
    expect(fresh.getData().settings.defaultRate).toBe(14.6);
    fresh.updateSettings({ language: "tr" });
    expect(fresh.getData().settings.defaultRate).toBe(14.6);

    // bestehender Bestand mit 13,90 €: Sprachwechsel in 2027 lässt ihn unverändert
    window.localStorage.clear();
    vi.resetModules();
    const old = await import("./store");
    old.loadFromStorage();
    old.updateSettings({ defaultRate: 13.9 });
    old.updateSettings({ language: "pl" });
    expect(old.getData().settings.defaultRate).toBe(13.9);
    expect(old.getData().settings.language).toBe("pl");
  });
});
