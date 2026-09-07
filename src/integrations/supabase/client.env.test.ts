/**
 * Regression: empty-string VITE_/SUPABASE_* must be treated as missing so the
 * lazy supabase Proxy throws instead of baking blank credentials.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { envString, resolveSupabasePublicEnv } from "./public-env";

describe("envString", () => {
  it("trims and treats empty/whitespace as undefined", () => {
    expect(envString(undefined)).toBeUndefined();
    expect(envString(null)).toBeUndefined();
    expect(envString(1)).toBeUndefined();
    expect(envString("")).toBeUndefined();
    expect(envString("   ")).toBeUndefined();
    expect(envString(" https://example.supabase.co ")).toBe(
      "https://example.supabase.co",
    );
  });
});

describe("resolveSupabasePublicEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("throws when all public env sources are empty", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");

    const { resolveSupabasePublicEnv: resolve } = await import("./public-env");
    expect(() => resolve()).toThrow(/Missing Supabase environment variable/);
  });

  it("accepts SUPABASE_* fallbacks when VITE_* empty", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_key");

    const { resolveSupabasePublicEnv: resolve } = await import("./public-env");
    const env = resolve();
    expect(env.url).toBe("https://proj.supabase.co");
    expect(env.publishableKey).toBe("sb_publishable_test_key");
  });

  it("prefers non-empty VITE_* over SUPABASE_*", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_vite");
    vi.stubEnv("SUPABASE_URL", "https://ssr.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_ssr");

    const env = resolveSupabasePublicEnv();
    expect(env.url).toBe("https://vite.supabase.co");
    expect(env.publishableKey).toBe("sb_publishable_vite");
  });
});
