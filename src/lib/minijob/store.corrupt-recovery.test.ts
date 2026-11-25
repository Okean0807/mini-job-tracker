import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 5.26 (R-1): Ein vorhandener, aber unlesbarer lokaler Stand darf nicht still überschrieben werden. Vor dem ersten
 * Schreiben wird sein Originaltext unverändert in `minijob-tracker-corrupt-v1:<scope>` gesichert; schlägt die Sicherung
 * fehl, wird nicht überschrieben. Lesbare und fehlende Stände verhalten sich wie bisher.
 */
const GUEST_KEY = "minijob-tracker-v1:guest";
const SIDE_KEY = "minijob-tracker-corrupt-v1:guest";

const job = (id: string) => ({ id, name: `Job ${id}`, color: "#000", mode: "flex" as const });

async function freshStore() {
  vi.resetModules();
  return import("./store");
}

function preserved(): { at: number; raw: string }[] {
  const raw = window.localStorage.getItem(SIDE_KEY);
  return raw ? (JSON.parse(raw) as { at: number; raw: string }[]) : [];
}

/**
 * Speicher mit einstellbaren Fehlern (voll/blockiert). Ersetzt `window.localStorage` (in happy-dom greifen Spys auf
 * `Storage.prototype.getItem` nicht zuverlässig); `restore` stellt den echten Speicher wieder her.
 */
const realStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage")!;
function installFlakyStorage() {
  const real = window.localStorage;
  const flaky = {
    failSet: (_key: string): boolean => false,
    failGet: false,
    setCalls: [] as string[],
  };
  const wrapper = {
    getItem: (key: string) => {
      if (flaky.failGet) throw new DOMException("blocked", "SecurityError");
      return real.getItem(key);
    },
    setItem: (key: string, value: string) => {
      flaky.setCalls.push(key);
      if (flaky.failSet(key)) throw new DOMException("full", "QuotaExceededError");
      real.setItem(key, value);
    },
    removeItem: (key: string) => real.removeItem(key),
    clear: () => real.clear(),
    key: (index: number) => real.key(index),
    get length() {
      return real.length;
    },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: wrapper });
  return flaky;
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", realStorageDescriptor);
  window.localStorage.clear();
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", realStorageDescriptor);
});

describe("R-1 – unlesbarer lokaler Stand wird vor dem Überschreiben gesichert", () => {
  const UNREADABLE: [string, string][] = [
    ["abgeschnittenes JSON", '{"shifts":[{"id":"s1","date":"2026-01-0'],
    ["Müll-Text", "this is not json {{{"],
    ["JSON-Zeichenkette", '"hello"'],
    ["JSON-Zahl", "12345"],
    ["JSON-Array", '[{"id":"x"}]'],
    ["JSON null", "null"],
    ["JSON true", "true"],
  ];

  it.each(UNREADABLE)(
    "%s: Originaltext wird unverändert gesichert, danach wird gespeichert",
    async (_name, rawValue) => {
      window.localStorage.setItem(GUEST_KEY, rawValue);
      const store = await freshStore();
      store.loadFromStorage();
      // Laden allein schreibt nichts: der Originalwert ist unberührt, es gibt keine Sicherung.
      expect(window.localStorage.getItem(GUEST_KEY)).toBe(rawValue);
      expect(window.localStorage.getItem(SIDE_KEY)).toBeNull();

      store.saveJob(job("j1"));
      expect(store.isPersistFailed()).toBe(false);
      const saved = preserved();
      expect(saved).toHaveLength(1);
      expect(saved[0]!.raw).toBe(rawValue); // byte-identisch
      expect(typeof saved[0]!.at).toBe("number");
      // der Hauptschlüssel enthält jetzt den neuen, lesbaren Stand
      const stored = JSON.parse(window.localStorage.getItem(GUEST_KEY) ?? "null") as {
        jobs: { id: string }[];
      };
      expect(stored.jobs.map((j) => j.id)).toEqual(["j1"]);
      expect(store.readPreservedUnreadable(store.getActiveScope())).toEqual(saved);
    },
  );

  it("jede weitere Speicherung erzeugt keine weitere Sicherung", async () => {
    window.localStorage.setItem(GUEST_KEY, "garbage");
    const store = await freshStore();
    store.loadFromStorage();
    store.saveJob(job("j1"));
    store.saveJob(job("j2"));
    store.saveJob(job("j3"));
    expect(preserved().map((p) => p.raw)).toEqual(["garbage"]);
  });

  it("fehlender Stand und leerer Text: keine Sicherung, Verhalten wie bisher", async () => {
    let store = await freshStore();
    store.loadFromStorage();
    store.saveJob(job("j1"));
    expect(window.localStorage.getItem(SIDE_KEY)).toBeNull();
    window.localStorage.clear();
    window.localStorage.setItem(GUEST_KEY, "");
    store = await freshStore();
    store.loadFromStorage();
    store.saveJob(job("j1"));
    expect(window.localStorage.getItem(SIDE_KEY)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(GUEST_KEY) ?? "null")).toMatchObject({
      jobs: [{ id: "j1" }],
    });
  });

  it("lesbarer Stand (auch Altformat/Teilobjekt): keine Sicherung, Daten bleiben erhalten", async () => {
    window.localStorage.setItem(GUEST_KEY, JSON.stringify({ jobs: [job("old")], shifts: [] }));
    const store = await freshStore();
    store.loadFromStorage();
    expect(store.getData().jobs.map((j) => j.id)).toEqual(["old"]);
    store.saveJob(job("new"));
    expect(window.localStorage.getItem(SIDE_KEY)).toBeNull();
    const stored = JSON.parse(window.localStorage.getItem(GUEST_KEY) ?? "null") as {
      jobs: { id: string }[];
    };
    expect(stored.jobs.map((j) => j.id).sort()).toEqual(["new", "old"]);
  });

  it("Speicher voll bei der Sicherung: unlesbarer Wert bleibt unberührt, Fehler wird gemeldet; danach erholt sich der Ablauf", async () => {
    window.localStorage.setItem(GUEST_KEY, "garbage");
    const flaky = installFlakyStorage();
    const store = await freshStore();
    const seen: boolean[] = [];
    store.onPersistError((failed) => seen.push(failed));
    store.loadFromStorage();

    flaky.failSet = (key) => key.startsWith("minijob-tracker-corrupt-v1");
    store.saveJob(job("j1"));
    expect(store.isPersistFailed()).toBe(true);
    expect(seen).toEqual([true]);
    expect(window.localStorage.getItem(GUEST_KEY)).toBe("garbage"); // NICHT überschrieben
    expect(window.localStorage.getItem(SIDE_KEY)).toBeNull();
    expect(flaky.setCalls).not.toContain(GUEST_KEY); // der Hauptwert wurde nicht einmal versucht
    expect(store.getData().jobs.map((j) => j.id)).toEqual(["j1"]); // Eingabe bleibt im Arbeitsspeicher

    flaky.failSet = () => false;
    store.saveJob(job("j2"));
    expect(store.isPersistFailed()).toBe(false);
    expect(seen).toEqual([true, false]);
    expect(preserved().map((p) => p.raw)).toEqual(["garbage"]);
    expect(JSON.parse(window.localStorage.getItem(GUEST_KEY) ?? "null")).toMatchObject({
      jobs: [{ id: "j1" }, { id: "j2" }],
    });
  });

  it("Speicher voll beim Schreiben des Hauptwertes nach gelungener Sicherung: wiederholter Versuch dupliziert die Sicherung nicht", async () => {
    window.localStorage.setItem(GUEST_KEY, "garbage");
    const flaky = installFlakyStorage();
    const store = await freshStore();
    store.loadFromStorage();
    flaky.failSet = (key) => key === GUEST_KEY;
    store.saveJob(job("j1"));
    store.saveJob(job("j2"));
    expect(store.isPersistFailed()).toBe(true);
    expect(window.localStorage.getItem(GUEST_KEY)).toBe("garbage");
    expect(preserved().map((p) => p.raw)).toEqual(["garbage"]); // einmal gesichert, nicht doppelt
    flaky.failSet = () => false;
    store.saveJob(job("j3"));
    expect(store.isPersistFailed()).toBe(false);
    expect(preserved()).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem(GUEST_KEY) ?? "null")).toMatchObject({
      jobs: [{ id: "j1" }, { id: "j2" }, { id: "j3" }],
    });
  });

  it("blockierter Speicher (Lesen wirft): kein Absturz, Fehler wird gemeldet, nichts wird geschrieben", async () => {
    const flaky = installFlakyStorage();
    const store = await freshStore();
    store.loadFromStorage();
    flaky.failGet = true;
    flaky.setCalls.length = 0;
    expect(() => store.saveJob(job("j1"))).not.toThrow();
    expect(store.isPersistFailed()).toBe(true);
    expect(flaky.setCalls).toEqual([]);
  });

  it("von der Normalisierung tolerierte Formen gelten als lesbar (keine Sicherung, Verhalten wie bisher)", async () => {
    window.localStorage.setItem(GUEST_KEY, '{"shifts":[null]}');
    const store = await freshStore();
    store.loadFromStorage();
    store.saveJob(job("j1"));
    expect(window.localStorage.getItem(SIDE_KEY)).toBeNull();
    expect(store.isPersistFailed()).toBe(false);
  });

  it("wiederholte Wiederherstellungsversuche über Sitzungen: gleicher Text einmal, verschiedene Texte nacheinander, höchstens drei", async () => {
    const session = async (raw: string) => {
      window.localStorage.setItem(GUEST_KEY, raw);
      const store = await freshStore();
      store.loadFromStorage();
      store.saveJob(job("x"));
      expect(store.isPersistFailed()).toBe(false);
    };
    await session("corrupt-A");
    await session("corrupt-B");
    expect(preserved().map((p) => p.raw)).toEqual(["corrupt-A", "corrupt-B"]);
    await session("corrupt-A"); // schon gesichert: kein Duplikat
    expect(preserved().map((p) => p.raw)).toEqual(["corrupt-A", "corrupt-B"]);
    await session("corrupt-C");
    await session("corrupt-D"); // vierter verschiedener Text: ältester wird verdrängt (dokumentiert)
    expect(preserved().map((p) => p.raw)).toEqual(["corrupt-B", "corrupt-C", "corrupt-D"]);
  });

  it("eine selbst unlesbare Sicherungsliste wird nie überschrieben: nicht speichern, melden", async () => {
    window.localStorage.setItem(SIDE_KEY, "not a list");
    window.localStorage.setItem(GUEST_KEY, "garbage");
    const store = await freshStore();
    store.loadFromStorage();
    store.saveJob(job("j1"));
    expect(store.isPersistFailed()).toBe(true);
    expect(window.localStorage.getItem(SIDE_KEY)).toBe("not a list");
    expect(window.localStorage.getItem(GUEST_KEY)).toBe("garbage");
  });

  it("Konto-Scope: Sicherung liegt unter dem Konto-Schlüssel und wird beim Löschen der Kontodaten entfernt; Gast-Sicherung bleibt", async () => {
    const { userScope, clearUserScopeLocalData, scopedKey } = await import("./storage-scope");
    const scope = userScope("user-1");
    window.localStorage.setItem(scopedKey("minijob-tracker-v1", scope), "garbage-user");
    window.localStorage.setItem(GUEST_KEY, "garbage-guest");
    const store = await freshStore();
    store.loadFromStorage();
    store.saveJob(job("g1")); // Gast-Scope speichert -> Gast-Sicherung
    store.activateScope(scope);
    store.saveJob(job("u1")); // Konto-Scope speichert -> Konto-Sicherung
    expect(store.readPreservedUnreadable(scope).map((p) => p.raw)).toEqual(["garbage-user"]);
    expect(preserved().map((p) => p.raw)).toEqual(["garbage-guest"]);
    clearUserScopeLocalData("user-1");
    expect(window.localStorage.getItem(scopedKey("minijob-tracker-corrupt-v1", scope))).toBeNull();
    expect(preserved().map((p) => p.raw)).toEqual(["garbage-guest"]);
  });

  it("zwei Stores (zwei Tabs) mit demselben unlesbaren Text sichern ihn genau einmal", async () => {
    window.localStorage.setItem(GUEST_KEY, "garbage");
    const a = await freshStore();
    a.loadFromStorage();
    const b = await freshStore();
    b.loadFromStorage();
    a.saveJob(job("a"));
    // Tab B sieht jetzt einen lesbaren Stand von A; sein eigenes erstes Speichern darf nichts mehr sichern müssen
    b.saveJob(job("b"));
    expect(preserved().map((p) => p.raw)).toEqual(["garbage"]);
  });
});
