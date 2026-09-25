/**
 * P0/P1: Konto- und Testmodus-Isolation lokaler Daten.
 *
 * Integrationsnah mit ECHTEM Store (kein Store-Mock) und gemocktem Supabase:
 * Namensraum-Wechsel bei Login/Logout/Kontowechsel, Owner-Guard vor Push,
 * generierte Dokumente, Onboarding-Entwurf, Testmodus ↔ Google-OAuth und
 * Legacy-Gerätedaten (nie automatisch einem Konto zugeordnet).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppData, Shift } from "./types";

/* ---------- Supabase-Mock (Backups pro user_id, Auth-Events) ---------- */

type Row = { payload: unknown; updated_at: string };
const backups = new Map<string, Row>();
const upserts: { user_id: string; payload: AppData }[] = [];
let session: { user: { id: string } } | null = null;
let authCallback: ((event: string, s: unknown) => void) | null = null;
/**
 * signOut-Verhalten wie auth-js (_signOut):
 * - "ok": Session entfernt, SIGNED_OUT
 * - "network": Server-Aufruf scheitert, auth-js entfernt die LOKALE Session
 *   trotzdem (feuert SIGNED_OUT) und liefert { error }
 * - "sessionError": Session konnte nicht geladen werden → { error }, Session bleibt
 */
let signOutMode: "ok" | "network" | "sessionError" = "ok";
let selectGate: Promise<void> | null = null;
let upsertGate: Promise<void> | null = null;
let upsertError: { message: string } | null = null;
let upsertAttempts = 0;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: async (row: { user_id: string; payload: AppData; updated_at: string }) => {
        upsertAttempts += 1;
        if (upsertGate) await upsertGate;
        if (upsertError) return { error: upsertError };
        upserts.push({ user_id: row.user_id, payload: row.payload });
        backups.set(row.user_id, { payload: row.payload, updated_at: row.updated_at });
        return { error: null };
      },
      select: () => ({
        eq: (_col: string, uid: string) => ({
          maybeSingle: async () => {
            if (selectGate) await selectGate;
            return { data: backups.get(uid) ?? null, error: null };
          },
        }),
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => {
        if (signOutMode === "sessionError") return { error: { message: "session load failed" } };
        session = null;
        authCallback?.("SIGNED_OUT", null);
        return { error: signOutMode === "network" ? { message: "Failed to fetch" } : null };
      },
    },
  },
}));

vi.mock("./notify", () => ({ markBackup: vi.fn() }));

/* ---------- Hilfen ---------- */

const A = "user-a-uuid";
const B = "user-b-uuid";
const C = "user-c-uuid";

function shift(id: string, date = "2026-09-01"): Shift {
  return {
    id,
    date,
    start: "09:00",
    end: "12:00",
    jobId: "j1",
    kind: "arbeit",
    breakMinutes: 0,
  } as Shift;
}

function payloadWith(shiftIds: string[]): AppData {
  return {
    shifts: shiftIds.map((id) => shift(id)),
    jobs: [{ id: "j1", name: "Cloud-Job", color: "#0d9488", mode: "flex" }],
    customers: [],
    projects: [],
    payments: [],
    goals: [],
    orders: [],
    objects: [],
    settings: { onboarded: true, wizardCompletedAt: 1, autoBackup: true },
    timer: null,
  } as unknown as AppData;
}

async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

/** Simuliert einen (Neu-)Start der App: frische Module, gleicher localStorage. */
async function boot() {
  vi.resetModules();
  const store = await import("./store");
  const cloud = await import("./cloud");
  const docs = await import("./generated-docs");
  const draft = await import("./onboarding-draft");
  const imp = await import("./local-data-import");
  const scope = await import("./storage-scope");
  store.loadFromStorage();
  cloud.initCloudSync();
  await settle();
  return { store, cloud, docs, draft, imp, scope };
}

async function signIn(id: string) {
  session = { user: { id } };
  authCallback?.("SIGNED_IN", session);
  await settle();
}

function upsertsContaining(shiftId: string) {
  return upserts.filter((u) => (u.payload?.shifts ?? []).some((s) => s.id === shiftId));
}

/** Nur App-eigene Schlüssel entfernen (kein localStorage.clear()). */
function clearAppKeys() {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
}

beforeEach(() => {
  clearAppKeys();
  backups.clear();
  upserts.length = 0;
  session = null;
  authCallback = null;
  signOutMode = "ok";
  selectGate = null;
  upsertGate = null;
  upsertError = null;
  upsertAttempts = 0;
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/* ---------- Konto A → Logout → Konto B ---------- */

describe("Kontowechsel A → Logout → B", () => {
  it("T1: B sieht A's lokale Daten nicht (A behält sie auf dem Gerät)", async () => {
    session = { user: { id: A } };
    const { store, cloud } = await boot();
    expect(store.getActiveScopeOwner()).toBe(A);
    store.saveShift(shift("a-secret"));
    expect(store.getData().shifts.map((s) => s.id)).toEqual(["a-secret"]);

    const res = await cloud.performSignOut();
    expect(res.ok).toBe(true);
    // Sofort nach Logout: Kontodaten nicht mehr im Speicher.
    expect(store.getData().shifts).toHaveLength(0);
    expect(store.getActiveScope().kind).toBe("guest");

    await signIn(B);
    expect(store.getActiveScopeOwner()).toBe(B);
    expect(store.getData().shifts.some((s) => s.id === "a-secret")).toBe(false);

    // A's Daten sind nicht gelöscht – A sieht sie beim nächsten Login wieder.
    await cloud.performSignOut();
    await signIn(A);
    expect(store.getData().shifts.map((s) => s.id)).toContain("a-secret");
  });

  it("T2: B ohne Cloud-Backup → kein Push von A's Daten in B's Backup", async () => {
    session = { user: { id: A } };
    const { store, cloud } = await boot();
    // A erfasst Daten und meldet sich ab, bevor der debouncete Push läuft.
    store.saveShift(shift("a-unsynced"));
    await cloud.performSignOut();

    await signIn(B);
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();

    expect(upserts.filter((u) => u.user_id === B)).toHaveLength(0);
    expect(upsertsContaining("a-unsynced").filter((u) => u.user_id !== A)).toHaveLength(0);
    expect(backups.has(B)).toBe(false);
    expect(cloud.getSyncState().status).not.toBe("conflict");
  });

  it("T3: generierte Dokumente von A sind für B unsichtbar", async () => {
    session = { user: { id: A } };
    const { docs, cloud } = await boot();
    docs.registerGeneratedDocument({
      name: "Arbeitsnachweis_Max_Mustermann_Musterstr_1.pdf",
      category: "arbeitsnachweis",
      mimeType: "application/pdf",
      size: 10,
      dataUrl: "data:application/pdf;base64,AAAA",
    });
    expect(docs.listGeneratedDocuments()).toHaveLength(1);

    await cloud.performSignOut();
    expect(docs.listGeneratedDocuments()).toHaveLength(0);
    await signIn(B);
    expect(docs.listGeneratedDocuments()).toHaveLength(0);
    // Globaler Legacy-Schlüssel wird nicht beschrieben.
    expect(window.localStorage.getItem("minijob-generated-docs-v1")).toBeNull();
  });

  it("T4: unvollständiger Onboarding-Entwurf von A erscheint nicht bei B", async () => {
    session = { user: { id: A } };
    const { draft, cloud } = await boot();
    draft.saveOnboardingDraft({ step: 4, mode: "fest" });
    expect(draft.loadOnboardingDraft()).toEqual({ step: 4, mode: "fest" });

    await cloud.performSignOut();
    expect(draft.loadOnboardingDraft()).toBeNull();
    await signIn(B);
    expect(draft.loadOnboardingDraft()).toBeNull();
    expect(window.localStorage.getItem("minijob-onboarding-draft-v2")).toBeNull();
  });

  it("A → Logout → ohne Login (Neustart): Gast-Namensraum, keine Kontodaten", async () => {
    session = { user: { id: A } };
    const first = await boot();
    first.store.saveShift(shift("a-1"));
    await first.cloud.performSignOut();

    const { store } = await boot(); // session === null
    expect(store.getActiveScope().kind).toBe("guest");
    expect(store.getData().shifts).toHaveLength(0);
  });

  it("A → Logout → Testmodus: Testmodus startet leer, ohne A's Daten", async () => {
    session = { user: { id: A } };
    const { store, cloud } = await boot();
    store.saveShift(shift("a-1"));
    await cloud.performSignOut();
    expect(cloud.enterTestModeScope()).toBe(true);
    expect(store.getActiveScope().kind).toBe("demo");
    expect(store.getData().shifts).toHaveLength(0);
  });

  it("abgelaufene Session beim Start (kein Fehler) → Kontodaten werden nicht angezeigt", async () => {
    session = { user: { id: A } };
    const first = await boot();
    first.store.saveShift(shift("a-1"));
    session = null; // Session lokal weg, ohne SIGNED_OUT-Event
    const { store } = await boot();
    expect(store.getActiveScope().kind).toBe("guest");
    expect(store.getData().shifts).toHaveLength(0);
  });
});

/* ---------- Owner-Guard & Logout-Fehler ---------- */

describe("Owner-Guard und Abmeldung", () => {
  it("Owner-Guard: kein Push/Lokal-behalten/Restore, wenn geladene Daten nicht dem Session-Konto gehören", async () => {
    session = { user: { id: A } };
    const { store, cloud, scope } = await boot();
    await vi.advanceTimersByTimeAsync(1000);
    const before = upserts.length;

    // Store künstlich auf fremden Namensraum (Gast) – Session bleibt A.
    store.activateScope(scope.GUEST_SCOPE);
    store.saveShift(shift("guest-data"));
    await expect(cloud.backupNow()).rejects.toThrow();
    await expect(cloud.resolveConflict("local")).rejects.toThrow();
    await expect(cloud.restoreNow()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(upserts.length).toBe(before);
    expect(upsertsContaining("guest-data")).toHaveLength(0);
  });

  it("signOut-Fehler (Session bleibt): Konto-Namensraum bleibt aktiv, nichts wird umgeschaltet oder gelöscht", async () => {
    session = { user: { id: A } };
    const { store, cloud } = await boot();
    store.saveShift(shift("a-keep"));
    signOutMode = "sessionError";

    const res = await cloud.performSignOut();
    expect(res.ok).toBe(false);
    expect(store.getActiveScopeOwner()).toBe(A);
    expect(store.getData().shifts.map((s) => s.id)).toContain("a-keep");

    signOutMode = "ok";
    const ok = await cloud.performSignOut();
    expect(ok.ok).toBe(true);
    expect(store.getData().shifts).toHaveLength(0);
    // Daten von A bleiben unter A's Namensraum gespeichert.
    expect(window.localStorage.getItem(`minijob-tracker-v1:u:${A}`)).toContain("a-keep");
  });

  it("signOut-Netzfehler: auth-js entfernt die lokale Session → Gast-Scope, kein „noch angemeldet“", async () => {
    session = { user: { id: A } };
    const { store, cloud } = await boot();
    store.saveShift(shift("a-net"));
    signOutMode = "network";

    const res = await cloud.performSignOut();
    expect(res.ok).toBe(true);
    expect(res.localOnly).toBe(true);
    expect(store.getActiveScope().kind).toBe("guest");
    expect(store.getData().shifts).toHaveLength(0);
    expect(cloud.getSyncState().signedIn).toBe(false);
    expect(window.localStorage.getItem(`minijob-tracker-v1:u:${A}`)).toContain("a-net");
  });
});

/* ---------- Testmodus ↔ Google ---------- */

async function setupDemoWithData() {
  const ctx = await boot(); // abgemeldet
  expect(ctx.cloud.enterTestModeScope()).toBe(true);
  ctx.store.updateSettings({ localDemoMode: true, onboarded: true, wizardCompletedAt: 123 });
  ctx.store.saveJob({ id: "demo-job", name: "Demo", color: "#000", mode: "flex" });
  ctx.store.saveShift(shift("demo-shift"));
  ctx.docs.registerGeneratedDocument({
    name: "Demo-Bericht.pdf",
    category: "report_pdf",
    mimeType: "application/pdf",
    size: 5,
    dataUrl: "data:application/pdf;base64,AAAA",
  });
  // Google-Button: Testmodus bleibt aktiv, nur Marker für den Callback.
  ctx.scope.markOAuthPending(ctx.store.getActiveScope());
  expect(ctx.store.getData().settings.localDemoMode).toBe(true);
  return ctx;
}

describe("Testmodus → Google", () => {
  it("T5: OAuth abgebrochen → weiter im Testmodus, Daten vollständig", async () => {
    await setupDemoWithData();
    // Rückkehr ohne Session (Abbruch/Fehler bei Google) = Neustart ohne Session.
    session = null;
    const { store, scope } = await boot();
    expect(store.getActiveScope().kind).toBe("demo");
    expect(store.getData().settings.localDemoMode).toBe(true);
    expect(store.getData().shifts.map((s) => s.id)).toEqual(["demo-shift"]);
    expect(scope.readOAuthPending()).toBeNull();
    expect(upserts).toHaveLength(0);
  });

  it("T6: OAuth erfolgreich → Konto startet eigenständig, kein Auto-Import, kein Push von Testdaten", async () => {
    await setupDemoWithData();
    session = { user: { id: C } };
    const { store, imp, scope } = await boot();
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();

    expect(store.getActiveScopeOwner()).toBe(C);
    expect(store.getData().shifts).toHaveLength(0);
    expect(store.getData().jobs).toHaveLength(0);
    expect(store.getData().settings.localDemoMode).not.toBe(true);
    // Neue, sichere Spezifikation: kein Übertrag von onboarded/wizardCompletedAt.
    expect(store.getData().settings.onboarded).not.toBe(true);
    expect(store.getData().settings.wizardCompletedAt).toBeUndefined();
    expect(upsertsContaining("demo-shift")).toHaveLength(0);
    expect(upserts.filter((u) => u.user_id === C)).toHaveLength(0);

    // Testmodus-Namensraum bleibt unverändert erhalten.
    const demo = store.readScopeData(scope.DEMO_SCOPE);
    expect(demo?.shifts.map((s) => s.id)).toEqual(["demo-shift"]);
    expect(demo?.settings.localDemoMode).toBe(true);
    // Explizite Wahl wird angeboten.
    expect(imp.pendingPromptSources()).toContain("demo");
  });

  it("T6b: „Mit leerem Konto starten“ → nichts importiert, Testdaten bleiben im Testmodus", async () => {
    await setupDemoWithData();
    session = { user: { id: C } };
    const { store, imp, scope } = await boot();
    imp.declineImport("demo");
    expect(imp.pendingPromptSources()).not.toContain("demo");
    expect(store.getData().shifts).toHaveLength(0);
    expect(store.readScopeData(scope.DEMO_SCOPE)?.shifts).toHaveLength(1);
  });

  it("T6c: „Testdaten übernehmen“ ohne Backup → explizit übernommen und gesichert", async () => {
    await setupDemoWithData();
    session = { user: { id: C } };
    const { store, imp } = await boot();
    expect(imp.importLocalData("demo")).toBe("imported");
    await settle();
    expect(store.getData().shifts.map((s) => s.id)).toEqual(["demo-shift"]);
    expect(store.getData().settings.localDemoMode).toBe(false);
    expect(upsertsContaining("demo-shift").map((u) => u.user_id)).toEqual([C]);
  });

  it("T6d: „Testdaten übernehmen“ mit bestehendem Backup → Konflikt statt stillem Überschreiben", async () => {
    await setupDemoWithData();
    backups.set(C, { payload: payloadWith(["cloud-1"]), updated_at: new Date().toISOString() });
    session = { user: { id: C } };
    const { store, imp, cloud } = await boot();
    // Erststart: Cloud wird wiederhergestellt.
    expect(store.getData().shifts.map((s) => s.id)).toEqual(["cloud-1"]);
    const before = upserts.length;

    expect(imp.importLocalData("demo")).toBe("imported");
    await settle();
    expect(cloud.getSyncState().status).toBe("conflict");
    expect(upserts.length).toBe(before);
    expect((backups.get(C)?.payload as AppData).shifts.map((s) => s.id)).toEqual(["cloud-1"]);
  });

  it("T7: generiertes Testmodus-Dokument bleibt demo-gebunden, bis es explizit übernommen wird", async () => {
    await setupDemoWithData();
    session = { user: { id: C } };
    const { docs, imp, scope } = await boot();
    expect(docs.listGeneratedDocuments()).toHaveLength(0);
    expect(
      docs.readGeneratedDocumentsAt(docs.generatedDocsStorageKey(scope.DEMO_SCOPE)),
    ).toHaveLength(1);

    expect(imp.importLocalData("demo")).toBe("imported");
    expect(docs.listGeneratedDocuments().map((d) => d.name)).toEqual(["Demo-Bericht.pdf"]);
    // Quelle bleibt erhalten (nichts still gelöscht).
    expect(
      docs.readGeneratedDocumentsAt(docs.generatedDocsStorageKey(scope.DEMO_SCOPE)),
    ).toHaveLength(1);
  });

  it("Wizard-Fortschritt (nur Schritt/Arbeitsart) übersteht den OAuth-Redirect", async () => {
    const ctx = await boot();
    ctx.draft.saveOnboardingDraft({ step: 2, mode: "selbststaendig" });
    ctx.scope.markOAuthPending(ctx.store.getActiveScope());
    session = { user: { id: C } };
    const { draft } = await boot();
    expect(draft.loadOnboardingDraft()).toEqual({ step: 2, mode: "selbststaendig" });
  });
});

/* ---------- Legacy-Gerätedaten ---------- */

function seedLegacy(opts: { owner: string | null; demo?: boolean }) {
  window.localStorage.setItem(
    "minijob-tracker-v1",
    JSON.stringify({
      ...payloadWith(["legacy-1", "legacy-2"]),
      settings: { onboarded: true, wizardCompletedAt: 5, localDemoMode: opts.demo === true },
    }),
  );
  if (opts.owner) {
    window.localStorage.setItem(
      "minijob-sync-meta-v1",
      JSON.stringify({
        userId: opts.owner,
        lastSyncedAt: 1,
        remoteSeenAt: 1,
        localChangedAt: null,
      }),
    );
  }
  window.localStorage.setItem(
    "minijob-generated-docs-v1",
    JSON.stringify([
      {
        id: "gen-legacy",
        name: "Alt.pdf",
        category: "report_pdf",
        mimeType: "application/pdf",
        size: 3,
        createdAt: "2026-01-01T00:00:00.000Z",
        dataUrl: "",
        source: "generated",
      },
    ]),
  );
}

describe("Legacy-Daten (globaler Schlüssel ohne Besitzer)", () => {
  it("T8: Login A → Legacy wird nicht still A's; expliziter Import respektiert bestehendes Backup", async () => {
    seedLegacy({ owner: A });
    const legacyRaw = window.localStorage.getItem("minijob-tracker-v1");
    backups.set(A, { payload: payloadWith(["cloud-a"]), updated_at: new Date().toISOString() });
    session = { user: { id: A } };
    const { store, imp, cloud, docs } = await boot();

    // Nicht automatisch übernommen: A sieht seinen Cloud-Stand, nicht Legacy.
    expect(store.getData().shifts.map((s) => s.id)).toEqual(["cloud-a"]);
    expect(docs.listGeneratedDocuments()).toHaveLength(0);
    expect(window.localStorage.getItem("minijob-tracker-v1")).toBe(legacyRaw);
    expect(upsertsContaining("legacy-1")).toHaveLength(0);

    const candidate = imp.findLegacyCandidate();
    expect(candidate?.lastSyncedWithThisAccount).toBe(true);
    expect(imp.pendingPromptSources()).toContain("legacy");

    // Expliziter Import → Konflikt (Backup existiert), kein stilles Überschreiben.
    const before = upserts.length;
    expect(imp.importLocalData("legacy")).toBe("imported");
    await settle();
    expect(cloud.getSyncState().status).toBe("conflict");
    expect(upserts.length).toBe(before);
    expect(
      store
        .getData()
        .shifts.map((s) => s.id)
        .sort(),
    ).toEqual(["legacy-1", "legacy-2"]);
    expect(docs.listGeneratedDocuments().map((d) => d.id)).toEqual(["gen-legacy"]);
    expect(window.localStorage.getItem("minijob-tracker-v1")).toBe(legacyRaw);

    // Nutzer entscheidet bewusst „Lokal behalten“ → erst jetzt Upload.
    await cloud.resolveConflict("local");
    expect(upsertsContaining("legacy-1").map((u) => u.user_id)).toEqual([A]);
  });

  it("T8b: an Konto A gebundene Legacy-Daten werden B / Gast nie angeboten", async () => {
    seedLegacy({ owner: A });
    session = { user: { id: B } };
    const { store, imp, cloud } = await boot();
    expect(store.getData().shifts).toHaveLength(0);
    expect(imp.findLegacyCandidate()).toBeNull();
    expect(imp.importLocalData("legacy")).toBe("nothing");
    await cloud.performSignOut();
    expect(imp.findLegacyCandidate()).toBeNull();
  });

  it("T8c: Legacy ohne Backup → expliziter Import wird für das Konto gesichert", async () => {
    seedLegacy({ owner: A });
    session = { user: { id: A } };
    const { store, imp } = await boot();
    expect(store.getData().shifts).toHaveLength(0);
    expect(upserts).toHaveLength(0);
    expect(imp.importLocalData("legacy")).toBe("imported");
    await settle();
    expect(upsertsContaining("legacy-1").map((u) => u.user_id)).toEqual([A]);
  });

  it("T8d: Import verweigert, wenn das Konto ungesicherte eigene Daten hat", async () => {
    seedLegacy({ owner: A });
    session = { user: { id: A } };
    const { store, imp } = await boot();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    store.saveShift(shift("own-unsynced"));
    expect(imp.importLocalData("legacy")).toBe("refused-unsynced");
    expect(store.getData().shifts.map((s) => s.id)).toEqual(["own-unsynced"]);
  });

  it("T8e: ungebundene Testmodus-Legacy-Daten → nur explizit in den Testmodus übernehmbar", async () => {
    seedLegacy({ owner: null, demo: true });
    const { store, imp } = await boot();
    expect(store.getActiveScope().kind).toBe("guest");
    expect(store.getData().shifts).toHaveLength(0);
    expect(imp.pendingPromptSources()).toContain("legacy");
    expect(imp.importLocalData("legacy")).toBe("imported");
    expect(store.getActiveScope().kind).toBe("demo");
    expect(store.getData().settings.localDemoMode).toBe(true);
    expect(store.getData().shifts).toHaveLength(2);
    expect(upserts).toHaveLength(0);
  });

  it("Ignorieren/Verwerfen: Ignorieren blendet nur den Dialog aus; Löschen entfernt nur Legacy-Schlüssel", async () => {
    seedLegacy({ owner: A });
    session = { user: { id: A } };
    const { imp } = await boot();
    imp.declineImport("legacy");
    expect(imp.pendingPromptSources()).not.toContain("legacy");
    expect(window.localStorage.getItem("minijob-tracker-v1")).not.toBeNull();
    imp.discardLegacyData();
    expect(window.localStorage.getItem("minijob-tracker-v1")).toBeNull();
    expect(window.localStorage.getItem("minijob-generated-docs-v1")).toBeNull();
    expect(window.localStorage.getItem(`minijob-sync-meta-v1:u:${A}`)).not.toBeNull();
  });
});

describe("Upgrade: Gerätesperre", () => {
  it("PIN aus Legacy-Daten desselben Kontos schützt den neuen Konto-Namensraum (ohne Daten zu übernehmen)", async () => {
    window.localStorage.setItem(
      "minijob-tracker-v1",
      JSON.stringify({
        ...payloadWith(["legacy-1"]),
        settings: { onboarded: true, wizardCompletedAt: 5, pin: "1234", pinEnabled: true },
      }),
    );
    window.localStorage.setItem("minijob-sync-meta-v1", JSON.stringify({ userId: A }));
    session = { user: { id: A } };
    const { store } = await boot();
    expect(store.getData().settings.pinEnabled).toBe(true);
    expect(store.getData().shifts).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it("PIN wird einem fremden Konto nicht übertragen", async () => {
    window.localStorage.setItem(
      "minijob-tracker-v1",
      JSON.stringify({ ...payloadWith(["x"]), settings: { pin: "1234", pinEnabled: true } }),
    );
    window.localStorage.setItem("minijob-sync-meta-v1", JSON.stringify({ userId: A }));
    session = { user: { id: B } };
    const { store } = await boot();
    expect(store.getData().settings.pinEnabled).not.toBe(true);
  });
});

/* ---------- Races: Kontowechsel WÄHREND eines laufenden Cloud-Zugriffs ---------- */

function deferred() {
  let release: () => void = () => {};
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value: online, configurable: true });
}

const metaKeyOf = (id: string) => `minijob-sync-meta-v1:u:${id}`;

describe("Race: Kontowechsel während await", () => {
  it("(a) Push-Race A→B: B's Meta unverändert, kein A-Fingerprint; Neustart mit neuerem B-Cloud-Stand → Konflikt statt Restore", async () => {
    const T0 = Date.now() - 100_000;
    const T1 = Date.now() - 50_000;
    // B hat auf diesem Gerät eine ungesicherte Schicht (Änderung T1 nach Sync T0).
    window.localStorage.setItem(
      `minijob-tracker-v1:u:${B}`,
      JSON.stringify(payloadWith(["b-unsynced"])),
    );
    const bMeta = {
      userId: B,
      lastSyncedAt: T0,
      remoteSeenAt: T0,
      localChangedAt: T1,
      localWorkChangedAt: T1,
      localWorkFingerprint: "fp-b",
      wizardPendingFirstSync: false,
    };
    window.localStorage.setItem(metaKeyOf(B), JSON.stringify(bMeta));
    backups.set(B, {
      payload: payloadWith(["b-cloud-old"]),
      updated_at: new Date(T0).toISOString(),
    });
    // A hat lokale Daten, noch kein Backup → Init-Sync pusht.
    window.localStorage.setItem(`minijob-tracker-v1:u:${A}`, JSON.stringify(payloadWith(["a-1"])));

    const gate = deferred();
    upsertGate = gate.promise;
    session = { user: { id: A } };
    const { cloud } = await boot(); // A-Push hängt im Upsert

    // Während des await: Kontowechsel A → B (B offline, damit B selbst nicht synct).
    setOnline(false);
    authCallback?.("SIGNED_OUT", null);
    session = { user: { id: B } };
    authCallback?.("SIGNED_IN", session);
    await settle();
    const bMetaBefore = window.localStorage.getItem(metaKeyOf(B));

    gate.release();
    upsertGate = null;
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    await settle();

    // A's Upload ging korrekt an A – aber B's Meta ist unberührt.
    expect(upserts.map((u) => u.user_id)).toEqual([A]);
    expect(window.localStorage.getItem(metaKeyOf(B))).toBe(bMetaBefore);
    const bMetaAfter = JSON.parse(window.localStorage.getItem(metaKeyOf(B))!);
    expect(bMetaAfter.lastSyncedAt).toBe(T0);
    expect(bMetaAfter.localWorkChangedAt).toBe(T1);
    expect(bMetaAfter.localWorkFingerprint).toBe("fp-b");
    expect(cloud.getSyncState().status).not.toBe("synced");

    // Neustart: B's Cloud wurde inzwischen auf einem anderen Gerät aktualisiert.
    backups.set(B, {
      payload: payloadWith(["b-cloud-new"]),
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    });
    setOnline(true);
    session = { user: { id: B } };
    const restarted = await boot();
    expect(restarted.cloud.getSyncState().status).toBe("conflict");
    expect(restarted.store.getData().shifts.map((s) => s.id)).toContain("b-unsynced");
  });

  it("(a2) Logout während laufendem Push → kein Fehler-/Synced-Status, keine Meta im Gast-Scope", async () => {
    window.localStorage.setItem(`minijob-tracker-v1:u:${A}`, JSON.stringify(payloadWith(["a-1"])));
    const gate = deferred();
    upsertGate = gate.promise;
    session = { user: { id: A } };
    const { cloud, store } = await boot();

    session = null;
    authCallback?.("SIGNED_OUT", null);
    await settle();
    gate.release();
    upsertGate = null;
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    await settle();

    expect(store.getActiveScope().kind).toBe("guest");
    expect(cloud.getSyncState().status).toBe("idle");
    expect(cloud.getSyncState().message).toBeNull();
    const guestMeta = JSON.parse(window.localStorage.getItem("minijob-sync-meta-v1:guest") ?? "{}");
    expect(guestMeta.lastSyncedAt ?? null).toBeNull();
  });

  it("(b) autoSync nach Fetch: A→B während des Fetch → kein Apply von A's Cloud, kein Push in B", async () => {
    backups.set(A, { payload: payloadWith(["a-cloud"]), updated_at: new Date().toISOString() });
    const gate = deferred();
    selectGate = gate.promise;
    session = { user: { id: A } };
    const { store } = await boot(); // A-Fetch hängt

    authCallback?.("SIGNED_OUT", null);
    session = { user: { id: B } };
    authCallback?.("SIGNED_IN", session);
    await settle();
    gate.release();
    selectGate = null;
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();

    expect(store.getActiveScopeOwner()).toBe(B);
    expect(store.getData().shifts.some((s) => s.id === "a-cloud")).toBe(false);
    expect(window.localStorage.getItem(`minijob-tracker-v1:u:${B}`) ?? "").not.toContain("a-cloud");
    expect(upserts.filter((u) => u.user_id === B)).toHaveLength(0);
    const bMeta = JSON.parse(window.localStorage.getItem(metaKeyOf(B)) ?? "{}");
    expect(bMeta.lastSyncedAt ?? null).toBeNull();
  });

  it("(b2) autoSync Mid-flight-Guard: Namensraum wechselt während des Fetch (ohne Auth-Event) → kein Apply/Push", async () => {
    backups.set(A, { payload: payloadWith(["a-cloud"]), updated_at: new Date().toISOString() });
    const gate = deferred();
    selectGate = gate.promise;
    session = { user: { id: A } };
    const { store, cloud, scope } = await boot();

    store.activateScope(scope.GUEST_SCOPE); // Scope-Wechsel ohne Epoch-Bump
    gate.release();
    selectGate = null;
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    await settle();

    expect(store.getData().shifts.some((s) => s.id === "a-cloud")).toBe(false);
    expect(window.localStorage.getItem("minijob-tracker-v1:guest") ?? "").not.toContain("a-cloud");
    expect(upserts).toHaveLength(0);
    expect(cloud.getSyncState().status).not.toBe("synced");
  });

  it("(c) restoreNow: A→B während des await → nichts in B's Scope geschrieben", async () => {
    session = { user: { id: A } };
    const { store, cloud } = await boot();
    backups.set(A, { payload: payloadWith(["a-cloud"]), updated_at: new Date().toISOString() });
    const gate = deferred();
    selectGate = gate.promise;
    const restore = cloud.restoreNow().catch(() => false);

    authCallback?.("SIGNED_OUT", null);
    session = { user: { id: B } };
    authCallback?.("SIGNED_IN", session);
    await settle();
    gate.release();
    selectGate = null;
    await settle();
    expect(await restore).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await settle();

    expect(store.getActiveScopeOwner()).toBe(B);
    expect(store.getData().shifts.some((s) => s.id === "a-cloud")).toBe(false);
    expect(window.localStorage.getItem(`minijob-tracker-v1:u:${B}`) ?? "").not.toContain("a-cloud");
    const bMeta = JSON.parse(window.localStorage.getItem(metaKeyOf(B)) ?? "{}");
    expect(bMeta.lastSyncedAt ?? null).toBeNull();
  });

  it("(c2) restoreNow Post-await-Guard: Namensraum wechselt während des await (ohne Auth-Event) → kein Restore", async () => {
    session = { user: { id: A } };
    const { store, cloud, scope } = await boot();
    backups.set(A, { payload: payloadWith(["a-cloud"]), updated_at: new Date().toISOString() });
    const gate = deferred();
    selectGate = gate.promise;
    const restore = cloud.restoreNow().then(
      () => "resolved",
      () => "rejected",
    );

    store.activateScope(scope.GUEST_SCOPE); // ohne Epoch-Bump
    gate.release();
    selectGate = null;
    await settle();

    expect(await restore).toBe("rejected");
    expect(store.getData().shifts.some((s) => s.id === "a-cloud")).toBe(false);
    expect(window.localStorage.getItem("minijob-tracker-v1:guest") ?? "").not.toContain("a-cloud");
    expect(cloud.getSyncState().status).not.toBe("synced");
  });
});

/* ---------- Legacy: global verbraucht ---------- */

describe("Legacy: Übernahme verbraucht den Bestand global", () => {
  it("ungebundene Legacy-Daten: nach Übernahme durch A wird B nichts mehr angeboten; Quelle bleibt", async () => {
    seedLegacy({ owner: null });
    const legacyRaw = window.localStorage.getItem("minijob-tracker-v1");
    session = { user: { id: A } };
    const { imp, cloud, store } = await boot();
    expect(imp.importLocalData("legacy")).toBe("imported");
    expect(imp.canDiscardLegacy()).toBe(true);
    await settle();

    await cloud.performSignOut();
    expect(imp.findLegacyCandidate()).toBeNull(); // auch Gast nicht
    await signIn(B);
    expect(store.getActiveScopeOwner()).toBe(B);
    expect(imp.findLegacyCandidate()).toBeNull();
    expect(imp.pendingPromptSources()).not.toContain("legacy");
    expect(imp.importLocalData("legacy")).toBe("nothing");
    expect(imp.canDiscardLegacy()).toBe(false);
    expect(store.getData().shifts).toHaveLength(0);
    // Quelle bleibt als Sicherung erhalten.
    expect(window.localStorage.getItem("minijob-tracker-v1")).toBe(legacyRaw);
  });

  it("lastSyncedWithThisAccount nur mit echtem lastSyncedAt (Rest aus altem A→B-Bug)", async () => {
    seedLegacy({ owner: A });
    window.localStorage.setItem("minijob-sync-meta-v1", JSON.stringify({ userId: A }));
    session = { user: { id: A } };
    const { imp } = await boot();
    const candidate = imp.findLegacyCandidate();
    expect(candidate).not.toBeNull();
    expect(candidate?.lastSyncedWithThisAccount).toBe(false);
  });
});

/* ---------- QA-Reste: manuelle Aktionen, Auth-Events, async-Schreibpfade ---------- */

describe("Manuelles Sichern/Wiederherstellen bei Kontowechsel (StaleSyncError still)", () => {
  it("backupNow: Namensraum wechselt während des Upserts → StaleSyncError, kein Fehlerstatus, kein Toast-Text", async () => {
    window.localStorage.setItem(`minijob-tracker-v1:u:${A}`, JSON.stringify(payloadWith(["a-1"])));
    session = { user: { id: A } };
    const { store, cloud, scope } = await boot();
    const { syncActionErrorMessage } = await import("./sync-action-error");
    const gate = deferred();
    upsertGate = gate.promise;
    const run = cloud.backupNow().then(
      () => null,
      (e: unknown) => e,
    );
    store.activateScope(scope.GUEST_SCOPE); // Scope-Wechsel ohne Auth-Event (z. B. anderer Tab)
    gate.release();
    upsertGate = null;
    const error = await run;
    await settle();

    expect(error).toBeInstanceOf(cloud.StaleSyncError);
    expect(syncActionErrorMessage(error, "fallback")).toBeNull();
    expect(cloud.getSyncState().status).toBe("idle");
    expect(cloud.getSyncState().message).toBeNull();
    const guestMeta = JSON.parse(window.localStorage.getItem("minijob-sync-meta-v1:guest") ?? "{}");
    expect(guestMeta.lastSyncedAt ?? null).toBeNull();
  });

  it("restoreNow: Namensraum wechselt während des Fetch → StaleSyncError, kein Fehlerstatus", async () => {
    session = { user: { id: A } };
    const { store, cloud, scope } = await boot();
    const { syncActionErrorMessage } = await import("./sync-action-error");
    backups.set(A, { payload: payloadWith(["a-cloud"]), updated_at: new Date().toISOString() });
    const gate = deferred();
    selectGate = gate.promise;
    const run = cloud.restoreNow().then(
      () => null,
      (e: unknown) => e,
    );
    store.activateScope(scope.GUEST_SCOPE);
    gate.release();
    selectGate = null;
    const error = await run;
    await settle();

    expect(error).toBeInstanceOf(cloud.StaleSyncError);
    expect(syncActionErrorMessage(error, "fallback")).toBeNull();
    expect(cloud.getSyncState().status).toBe("idle");
    expect(cloud.getSyncState().message).toBeNull();
    expect(store.getData().shifts.some((s) => s.id === "a-cloud")).toBe(false);
  });

  it("andere Fehler unverändert: Upsert-Fehler → error-Status + Fehlertext", async () => {
    window.localStorage.setItem(`minijob-tracker-v1:u:${A}`, JSON.stringify(payloadWith(["a-1"])));
    session = { user: { id: A } };
    const { cloud } = await boot();
    const { syncActionErrorMessage } = await import("./sync-action-error");
    upsertError = { message: "db down" };
    const error = await cloud.backupNow().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).not.toBeInstanceOf(cloud.StaleSyncError);
    expect(cloud.getSyncState().status).toBe("error");
    expect(syncActionErrorMessage(new Error("db down"), "fallback")).toBe("db down");
    expect(syncActionErrorMessage("??", "fallback")).toBe("fallback");
  });
});

describe("Race: backupNow A→B (Upsert erst nach Kontowechsel freigegeben)", () => {
  it("(d) B's Meta und Backup bleiben unberührt, kein Schreiben in B, still beendet", async () => {
    const T0 = Date.now() - 100_000;
    const T1 = Date.now() - 50_000;
    window.localStorage.setItem(
      `minijob-tracker-v1:u:${B}`,
      JSON.stringify(payloadWith(["b-unsynced"])),
    );
    window.localStorage.setItem(
      metaKeyOf(B),
      JSON.stringify({
        userId: B,
        lastSyncedAt: T0,
        remoteSeenAt: T0,
        localChangedAt: T1,
        localWorkChangedAt: T1,
        localWorkFingerprint: "fp-b",
        wizardPendingFirstSync: false,
      }),
    );
    const bBackup = { payload: payloadWith(["b-cloud"]), updated_at: new Date(T0).toISOString() };
    backups.set(B, bBackup);
    window.localStorage.setItem(`minijob-tracker-v1:u:${A}`, JSON.stringify(payloadWith(["a-1"])));

    session = { user: { id: A } };
    const { cloud, store } = await boot(); // Init-Sync von A läuft ungebremst durch
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    upserts.length = 0;

    const gate = deferred();
    upsertGate = gate.promise;
    const run = cloud.backupNow().then(
      () => null,
      (e: unknown) => e,
    );
    await settle();

    // Während des Upserts: Kontowechsel A → B (B offline, damit B selbst nicht synct).
    setOnline(false);
    authCallback?.("SIGNED_OUT", null);
    session = { user: { id: B } };
    authCallback?.("SIGNED_IN", session);
    await settle();
    const bMetaBefore = window.localStorage.getItem(metaKeyOf(B));
    const bDataBefore = window.localStorage.getItem(`minijob-tracker-v1:u:${B}`);

    gate.release();
    upsertGate = null;
    const error = await run;
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    await settle();

    expect(error).toBeInstanceOf(cloud.StaleSyncError);
    expect(upserts.map((u) => u.user_id)).toEqual([A]); // A's Upload ging an A
    expect(backups.get(B)).toBe(bBackup); // B's Cloud-Backup unberührt
    expect(window.localStorage.getItem(metaKeyOf(B))).toBe(bMetaBefore);
    expect(window.localStorage.getItem(`minijob-tracker-v1:u:${B}`)).toBe(bDataBefore);
    const bMeta = JSON.parse(bMetaBefore!);
    expect(bMeta.lastSyncedAt).toBe(T0);
    expect(bMeta.localWorkFingerprint).toBe("fp-b");
    expect(store.getActiveScopeOwner()).toBe(B);
    expect(cloud.getSyncState().status).not.toBe("error");
    expect(cloud.getSyncState().status).not.toBe("synced");
    expect(cloud.getSyncState().message).toBeNull();
  });
});

describe("Auth-Event ohne Session (nicht SIGNED_OUT)", () => {
  it("null-Session (z. B. TOKEN_REFRESHED/USER_UPDATED ohne Session) → Konto-Namensraum verlassen wie Logout, geplanter Push verworfen", async () => {
    session = { user: { id: A } };
    const { store, cloud } = await boot();
    const scopeChanges: string[] = [];
    store.onScopeChange((s) => scopeChanges.push(s.kind));
    store.saveShift(shift("a-secret")); // plant debounceten Push
    session = null;
    authCallback?.("TOKEN_REFRESHED", null);
    await settle();

    expect(scopeChanges).toEqual(["guest"]);
    expect(store.getActiveScope().kind).toBe("guest");
    expect(store.getData().shifts.some((s) => s.id === "a-secret")).toBe(false);
    expect(cloud.getSyncState().signedIn).toBe(false);
    expect(cloud.getCloudUserId()).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(upserts).toHaveLength(0);
    // A behält seine Daten auf dem Gerät.
    expect(window.localStorage.getItem(`minijob-tracker-v1:u:${A}`) ?? "").toContain("a-secret");
  });

  it("null-Session während laufendem Push → keine Meta in A, kein synced/error", async () => {
    window.localStorage.setItem(`minijob-tracker-v1:u:${A}`, JSON.stringify(payloadWith(["a-1"])));
    const gate = deferred();
    upsertGate = gate.promise;
    session = { user: { id: A } };
    const { cloud, store } = await boot(); // Init-Push hängt

    session = null;
    authCallback?.("USER_UPDATED", null);
    await settle();
    gate.release();
    upsertGate = null;
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    await settle();

    expect(store.getActiveScope().kind).toBe("guest");
    expect(cloud.getSyncState().status).toBe("idle");
    const aMeta = JSON.parse(window.localStorage.getItem(metaKeyOf(A)) ?? "{}");
    expect(aMeta.lastSyncedAt ?? null).toBeNull();
  });

  it("INITIAL_SESSION null (auth-js meldet so auch Netzfehler) → Namensraum bleibt (offline-fähig), laufender Abgleich wird ungültig", async () => {
    window.localStorage.setItem(`minijob-tracker-v1:u:${A}`, JSON.stringify(payloadWith(["a-1"])));
    const gate = deferred();
    upsertGate = gate.promise;
    session = { user: { id: A } };
    const { cloud, store } = await boot();

    expect(upsertAttempts).toBe(1);
    authCallback?.("INITIAL_SESSION", null);
    await settle();
    expect(store.getActiveScopeOwner()).toBe(A);
    expect(store.getData().shifts.map((s) => s.id)).toContain("a-1");
    expect(cloud.getSyncState().signedIn).toBe(false);
    // Session wieder da (online): neuer Abgleich startet sofort – der hängende
    // Lauf des alten Bindings blockiert nicht mehr (Epoch-Bump/cancelPendingSync).
    authCallback?.("SIGNED_IN", { user: { id: A } });
    await settle();
    expect(upsertAttempts).toBe(2);
    authCallback?.("INITIAL_SESSION", null);
    await settle();

    gate.release();
    upsertGate = null;
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    const aMeta = JSON.parse(window.localStorage.getItem(metaKeyOf(A)) ?? "{}");
    expect(aMeta.lastSyncedAt ?? null).toBeNull();
    expect(cloud.getSyncState().status).not.toBe("synced");
  });
});

describe("Async-Schreibpfade außerhalb des Sync (Epoch-Snapshot)", () => {
  it("JSON-Sicherung: Konto wechselt während des Datei-Lesens → nichts in B geschrieben", async () => {
    session = { user: { id: A } };
    const { store } = await boot();
    const { importJsonBackupFile } = await import("./json-backup-import");
    const gate = deferred();
    const file = {
      text: async () => {
        await gate.promise;
        return JSON.stringify(payloadWith(["from-file"]));
      },
    };
    const run = importJsonBackupFile(file);
    authCallback?.("SIGNED_OUT", null);
    await signIn(B);
    const bBefore = window.localStorage.getItem(`minijob-tracker-v1:u:${B}`);
    gate.release();

    expect(await run).toBe("stale");
    expect(store.getActiveScopeOwner()).toBe(B);
    expect(store.getData().shifts.some((s) => s.id === "from-file")).toBe(false);
    expect(window.localStorage.getItem(`minijob-tracker-v1:u:${B}`)).toBe(bBefore);
    expect(window.localStorage.getItem(`minijob-tracker-v1:u:${A}`) ?? "").not.toContain(
      "from-file",
    );

    // Ohne Wechsel: wie bisher importiert.
    const ok = await importJsonBackupFile({
      text: async () => JSON.stringify(payloadWith(["from-file"])),
    });
    expect(ok).toBe("imported");
    expect(store.getData().shifts.map((s) => s.id)).toContain("from-file");
  });

  it("Export-Registrierung: Konto wechselt während blobToDataUrl → Dokument bleibt bei A, nie in B's Liste", async () => {
    session = { user: { id: A } };
    const { docs } = await boot();
    const run = docs.saveAndRegisterExport({
      blob: new Blob(["a-private"], { type: "application/pdf" }),
      filename: "a-report.pdf",
      category: "report_pdf",
    });
    authCallback?.("SIGNED_OUT", null);
    await signIn(B);
    vi.useRealTimers();
    await run;

    expect(docs.listGeneratedDocuments().some((d) => d.name === "a-report.pdf")).toBe(false);
    const aDocs = window.localStorage.getItem(`minijob-generated-docs-v1:u:${A}`) ?? "";
    expect(aDocs).toContain("a-report.pdf");
  });
});

describe("Offene Dialoge bei Scope-Wechsel", () => {
  it("Root nutzt ScopeBoundary um die Seiten und key={scope} am Wizard (Render-Test: ScopeBoundary.test.ts)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/routes/__root.tsx"), "utf8");
    expect(src).toMatch(/<ScopeBoundary>\s*<Outlet \/>\s*<\/ScopeBoundary>/);
    expect(src).toMatch(/<OnboardingWizard key=\{scope\}/);
  });
});
