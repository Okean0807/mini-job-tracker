import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phase 2 - Public Local Isolation. The baked client flag is OFF (what the public-local profile bakes);
// every path that could reach the cloud must stop BEFORE the Supabase client is touched. The mocked
// client records every property access, so "no client access" is proven, not assumed.
const h = vi.hoisted(() => ({ touched: [] as string[], aiCalls: 0 }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: new Proxy(
    {},
    {
      get(_t, prop) {
        h.touched.push(String(prop));
        throw new Error(`supabase client accessed: ${String(prop)}`);
      },
    },
  ),
}));
vi.mock("@/lib/ai-status.functions", () => ({
  getAiStatus: () => {
    h.aiCalls += 1;
    return Promise.resolve({ enabled: true });
  },
}));

const ROOT = process.cwd();

beforeEach(() => {
  vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", "false");
  h.touched.length = 0;
  h.aiCalls = 0;
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cloud mode decision", () => {
  it('only the exact string "true" turns the cloud on; unset/empty/false/ambiguous are OFF', async () => {
    const { isCloudMode, isPublicLocalBuild } = await import("./cloud-mode");
    for (const [v, on] of [
      ["true", true],
      ["false", false],
      ["", false],
      ["TRUE", false],
      ["1", false],
      [" true", false],
      ["yes", false],
    ] as [string, boolean][]) {
      vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", v);
      expect(isCloudMode(), v).toBe(on);
      expect(isPublicLocalBuild(), v).toBe(!on);
    }
    vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", undefined);
    expect(isCloudMode()).toBe(false);
  });
  it("assertCloudEnabled / cloudClient throw CloudDisabledError without touching the client", async () => {
    const { assertCloudEnabled, CloudDisabledError } = await import("./cloud-mode");
    const { cloudClient } = await import("@/integrations/supabase/guarded-client");
    expect(() => assertCloudEnabled("x")).toThrow(CloudDisabledError);
    expect(() => cloudClient("x")).toThrow(CloudDisabledError);
    expect(h.touched).toEqual([]);
    vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", "true");
    // control case: in a cloud build the guard lets the client through (the mock then records the access)
    expect(() => cloudClient("x").auth).toThrow(/supabase client accessed: auth/);
    expect(h.touched).toEqual(["auth"]);
  });
});

describe("no cloud work happens in a Public Local build", () => {
  it("initCloudSync registers nothing and never touches the client", async () => {
    const add = vi.spyOn(window, "addEventListener");
    vi.resetModules();
    const cloud = await import("@/lib/minijob/cloud");
    cloud.initCloudSync();
    cloud.initCloudSync();
    expect(h.touched).toEqual([]);
    expect(add.mock.calls.filter(([type]) => type === "online" || type === "offline")).toEqual([]);
  });
  it("backup, restore, conflict resolution, sign-out and OAuth are refused before any client access", async () => {
    vi.resetModules();
    const cloud = await import("@/lib/minijob/cloud");
    const { signInWithOAuthProvider } = await import("@/lib/minijob/oauth-sign-in");
    const { deleteMyAccount } = await import("@/lib/minijob/account-delete");
    await expect(cloud.backupNow()).rejects.toThrow();
    await expect(cloud.restoreNow()).rejects.toThrow();
    await expect(cloud.resolveConflict("local")).rejects.toThrow();
    await expect(signInWithOAuthProvider("google")).rejects.toThrow(/cloud-disabled/);
    await expect(deleteMyAccount()).rejects.toThrow(/cloud-disabled/);
    expect(h.touched).toEqual([]);
  });
  it("document functions run on this device (IndexedDB) and never touch the cloud client", async () => {
    vi.resetModules();
    const { createFakeIndexedDB } = await import("@/lib/minijob/__fixtures__/fake-indexeddb");
    const { __setIndexedDbForTests } = await import("@/lib/minijob/document-store");
    __setIndexedDbForTests(createFakeIndexedDB().factory);
    const docs = await import("@/lib/minijob/documents");
    expect(await docs.listDocuments()).toEqual([]);
    expect(await docs.listFolders()).toEqual([]);
    await docs.createFolder("x", "#000");
    expect((await docs.listFolders()).length).toBe(1);
    await docs.uploadDocument(new File([new Uint8Array(5)], "a.pdf", { type: "application/pdf" }), {
      category: "vertrag",
    });
    const [row] = await docs.listDocuments();
    expect(row?.name).toBe("a.pdf");
    await docs.deleteDocument(row!);
    expect(h.touched).toEqual([]);
    __setIndexedDbForTests(undefined);
  });
  it("markWizardPendingFirstSync writes no cloud metadata", async () => {
    vi.resetModules();
    const cloud = await import("@/lib/minijob/cloud");
    cloud.markWizardPendingFirstSync();
    expect(Object.keys(window.localStorage).filter((k) => k.includes("sync-meta"))).toEqual([]);
  });
});

async function mount(component: () => unknown): Promise<{ text: () => string; stop: () => void }> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => {
    root.render(createElement(component as () => null));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return {
    text: () => el.textContent ?? "",
    stop: () => act(() => root.unmount()),
  } as never;
}

describe("React hooks in a Public Local build", () => {
  it("useAuthSession is immediately 'signed_out' with no client access and no console noise", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { useAuthSession } = await import("@/hooks/use-auth-session");
    const seen: string[] = [];
    const view = await mount(() => {
      const { status, session } = useAuthSession();
      seen.push(`${status}:${session === null}`);
      return null;
    });
    expect(seen.at(-1)).toBe("signed_out:true");
    expect(h.touched).toEqual([]);
    expect(err).not.toHaveBeenCalled();
    view.stop();
  });
  it("useAiAvailability is 'disabled' immediately and never asks the server", async () => {
    vi.resetModules();
    const { useAiAvailability } = await import("@/hooks/use-ai-availability");
    const seen: string[] = [];
    const view = await mount(() => {
      seen.push(useAiAvailability());
      return null;
    });
    expect(seen.every((s) => s === "disabled")).toBe(true);
    expect(h.aiCalls).toBe(0);
    expect(h.touched).toEqual([]);
    view.stop();
  });
  it("in a cloud build the AI availability IS requested from the server (control case)", async () => {
    vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", "true");
    vi.resetModules();
    const { useAiAvailability } = await import("@/hooks/use-ai-availability");
    const view = await mount(() => {
      useAiAvailability();
      return null;
    });
    expect(h.aiCalls).toBe(1);
    view.stop();
  });
});

describe("full functionality without a subscription", () => {
  it("premium gates are open in Public Local (several employers, Excel export) and keep their rule in a cloud build", async () => {
    const { isPremium, canAddJob, canExport, canUse } = await import("@/lib/minijob/premium");
    const free = { premium: false } as never;
    expect(isPremium(free)).toBe(true);
    expect(canAddJob(free, 7)).toBe(true);
    expect(canExport(free, "xlsx")).toBe(true);
    expect(canUse(free, "multiJob")).toBe(true);
    vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", "true");
    expect(isPremium(free)).toBe(false);
    expect(canAddJob(free, 1)).toBe(false);
    expect(canExport(free, "xlsx")).toBe(false);
    expect(canExport(free, "pdf")).toBe(true);
  });
});

describe("onboarding without registration", () => {
  it("wizard flow skips the Cloud step in both directions and never requires a session", async () => {
    const w = await import("@/lib/minijob/wizard-flow");
    const I = w.WIZARD_STEP_INDEX;
    expect(w.neighbourStep(I.welcome, 1, false)).toBe(I.workMode);
    expect(w.neighbourStep(I.workMode, -1, false)).toBe(I.welcome);
    expect(w.neighbourStep(I.welcome, 1, true)).toBe(I.cloud);
    expect(w.neighbourStep(I.workMode, -1, true)).toBe(I.cloud);
    expect(w.neighbourStep(0, -1, false)).toBe(0);
    expect(w.neighbourStep(w.WIZARD_STEP_COUNT - 1, 1, false)).toBe(w.WIZARD_STEP_COUNT - 1);
    expect(w.canAdvancePastCloud("signed_out", false, false)).toBe(true);
    expect(w.canAdvancePastCloud("signed_out", false, true)).toBe(false); // cloud build unchanged
    for (const step of [0, 1, 2, 3, 6]) {
      const r = w.resolveWizardResumeStep(step, "signed_out", { cloudAvailable: false });
      expect(r).toBe(step === I.cloud ? I.workMode : step);
    }
    // cloud build keeps the original rule
    expect(w.resolveWizardResumeStep(3, "signed_out", { cloudAvailable: true })).toBe(I.cloud);
  });
});

describe("static isolation inventory", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(e) && !/\.test\.(ts|tsx)$/.test(e)) out.push(p);
    }
    return out;
  }
  const files = walk(resolve(ROOT, "src"));
  const code = (f: string) =>
    readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");

  it("only the guarded accessor (and server-only / unused generated files) may use the Supabase client", () => {
    const importers = files.filter((f) =>
      /from\s+['"](?:@\/integrations\/supabase\/client|\.\/client|\.\.\/supabase\/client)['"]/.test(
        code(f),
      ),
    );
    expect(importers.map(rel).sort()).toEqual([
      "src/integrations/lovable/index.ts", // generated, imported by nothing (checked below)
      "src/integrations/supabase/guarded-client.ts",
    ]);
    const lovableUsers = files.filter(
      (f) =>
        /integrations\/lovable/.test(readFileSync(f, "utf8")) &&
        !rel(f).startsWith("src/integrations/lovable/"),
    );
    expect(lovableUsers.map(rel)).toEqual([]);
  });
  it("no other module refers to the client module at all (also not via dynamic import or re-export)", () => {
    const refs = files
      .filter((f) =>
        /integrations\/supabase\/client(?!\.server)['"]|\.\.\/supabase\/client['"]|from\s+['"]\.\/client['"]|import\(\s*['"]\.\/client['"]/.test(
          code(f),
        ),
      )
      .map(rel)
      .sort();
    expect(refs).toEqual(
      ["src/integrations/lovable/index.ts", "src/integrations/supabase/guarded-client.ts"].sort(),
    );
  });
  it("direct createClient() calls exist only in the client, the server client and the server auth middleware", () => {
    const creators = files.filter((f) => /\bcreateClient\s*[<(]/.test(code(f)));
    expect(creators.map(rel).sort()).toEqual([
      "src/integrations/supabase/auth-middleware.ts",
      "src/integrations/supabase/client.server.ts",
      "src/integrations/supabase/client.ts",
    ]);
  });
  it("the Supabase client is lazy: importing the module creates nothing (no env needed at import time)", () => {
    const src = readFileSync(resolve(ROOT, "src/integrations/supabase/client.ts"), "utf8");
    expect(src).toMatch(/new Proxy\(/);
    expect(src).toMatch(/if \(!_supabase\) _supabase = createSupabaseClient\(\)/);
  });
  it("the global server-function middleware does not touch the client in a Public Local build", () => {
    const src = readFileSync(resolve(ROOT, "src/integrations/supabase/auth-attacher.ts"), "utf8");
    expect(src.indexOf("if (!isCloudMode()) return next(")).toBeGreaterThan(-1);
    expect(src.indexOf("if (!isCloudMode()) return next(")).toBeLessThan(
      src.indexOf("cloudClient()"),
    );
  });
  it("every use of the global fetch in app code is inventoried (Supabase wrapper, server AI providers, consent-gated address lookup)", () => {
    // the pattern also catches default parameters such as `fetchImpl = fetch` and `typeof fetch`.
    const users = files
      .filter((f) => /(?<![.\w/])fetch(?=\s*[(,)=;]|\s*$)/m.test(code(f)))
      .map(rel)
      .sort();
    expect(users).toEqual([
      "src/integrations/supabase/auth-middleware.ts",
      "src/integrations/supabase/client.server.ts",
      "src/integrations/supabase/client.ts",
      "src/lib/ai/gemini-provider.ts",
      "src/lib/ai/web-search/tavily-provider.ts",
      "src/lib/minijob/geo-address.ts", // OpenStreetMap Nominatim, only after an explicit confirmation dialog (browser run E20/E21)
      "src/server.ts",
    ]);
  });
  it("the address lookup is only reachable behind the confirmation handler", () => {
    const dlg = readFileSync(resolve(ROOT, "src/components/minijob/ShiftDialog.tsx"), "utf8");
    const calls = dlg.match(/reverseGeocodeGerman\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(dlg.indexOf("async function confirmGeoLookup()")).toBeLessThan(
      dlg.indexOf("reverseGeocodeGerman("),
    );
    const users = files
      .filter((f) => /reverseGeocodeGerman\s*\(/.test(code(f)))
      .map(rel)
      .sort();
    expect(users).toEqual([
      "src/components/minijob/ShiftDialog.tsx",
      "src/lib/minijob/geo-address.ts",
    ]);
  });
  it("no browser-side WebSocket / EventSource / sendBeacon / XMLHttpRequest in app code", () => {
    const hits = files.filter((f) =>
      /new WebSocket|new EventSource|sendBeacon|XMLHttpRequest/.test(code(f)),
    );
    expect(hits.map(rel)).toEqual([]);
  });
});
