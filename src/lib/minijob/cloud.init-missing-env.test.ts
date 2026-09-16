/**
 * Regression: missing VITE_SUPABASE_* makes the lazy supabase Proxy throw on
 * first property access. initCloudSync must swallow that so the root ready-gate
 * can still set ready=true (otherwise Outlet stays blank forever).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppData } from "./types";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(
          `Missing Supabase environment variable(s): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (accessed .${String(prop)})`,
        );
      },
    },
  ),
}));

vi.mock("./store", async () => {
  const actual = await vi.importActual<typeof import("./store")>("./store");
  return {
    ...actual,
    getData: (): AppData =>
      ({
        shifts: [],
        jobs: [],
        customers: [],
        projects: [],
        payments: [],
        goals: [],
        settings: { autoBackup: true },
        timer: null,
      }) as unknown as AppData,
    onDataChange: () => {},
    replaceAll: () => {},
  };
});

vi.mock("./notify", () => ({ markBackup: vi.fn() }));

async function loadModule() {
  vi.resetModules();
  return await import("./cloud");
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("initCloudSync without Supabase env", () => {
  it("does not throw when supabase.auth access fails", async () => {
    const { initCloudSync, getSyncState } = await loadModule();

    expect(() => initCloudSync()).not.toThrow();
    expect(getSyncState()).toMatchObject({
      status: "idle",
      signedIn: false,
      pending: false,
    });
  });

  it("stays initialized so a second call does not retry the throw", async () => {
    const { initCloudSync } = await loadModule();

    expect(() => initCloudSync()).not.toThrow();
    expect(() => initCloudSync()).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });
});
