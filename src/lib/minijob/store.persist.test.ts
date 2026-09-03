import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ein fehlgeschlagenes lokales Speichern (voller/blockierter Speicher) darf
 * nicht still bleiben: die UI muss darüber informiert werden.
 */
describe("Speicherfehler im lokalen Store", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  it("meldet Fehler und Erholung an Zuhörer", async () => {
    const store = await import("./store");
    const seen: boolean[] = [];
    store.onPersistError((failed) => seen.push(failed));

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    setItem.mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });

    store.saveJob({ id: "j1", name: "Test", color: "#000" });
    expect(store.isPersistFailed()).toBe(true);
    expect(seen).toEqual([true]);

    setItem.mockRestore();
    store.saveJob({ id: "j2", name: "Zweit", color: "#111" });
    expect(store.isPersistFailed()).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it("meldet nur bei Statuswechsel", async () => {
    const store = await import("./store");
    const seen: boolean[] = [];
    store.onPersistError((failed) => seen.push(failed));

    store.saveJob({ id: "j1", name: "Test", color: "#000" });
    store.saveJob({ id: "j2", name: "Zweit", color: "#111" });
    expect(seen).toEqual([]);
    expect(store.isPersistFailed()).toBe(false);
  });
});
