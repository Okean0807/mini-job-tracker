/**
 * Regression: empty-string VITE_/SUPABASE_* must be treated as missing so the
 * lazy supabase Proxy throws instead of baking blank credentials.
 *
 * ACCEPTANCE BUG #3: independent Vercel Preview with only VITE_SUPABASE_* must
 * resolve (KI auth middleware shares this helper) and must never suggest
 * "Connect Supabase in Lovable Cloud".
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

  it("missing-env message lists VITE_/SUPABASE_ options and omits Lovable Cloud", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");

    const { resolveSupabasePublicEnv: resolve } = await import("./public-env");
    expect(() => resolve()).toThrow(/VITE_SUPABASE_URL \(or SUPABASE_URL\)/);
    expect(() => resolve()).toThrow(
      /VITE_SUPABASE_PUBLISHABLE_KEY \(or SUPABASE_PUBLISHABLE_KEY\)/,
    );
    expect(() => resolve()).toThrow(/deployment environment/);
    try {
      resolve();
    } catch (e) {
      expect(String(e)).not.toMatch(/Lovable Cloud/i);
    }
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

  it("accepts VITE_* alone (independent Vercel Preview / KI auth path)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://vite-only.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_vite_only");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");

    const { resolveSupabasePublicEnv: resolve } = await import("./public-env");
    const env = resolve();
    expect(env.url).toBe("https://vite-only.supabase.co");
    expect(env.publishableKey).toBe("sb_publishable_vite_only");
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
