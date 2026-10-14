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
});
