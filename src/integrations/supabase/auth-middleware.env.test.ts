/**
 * ACCEPTANCE BUG #3 regression: KI askAssistant uses requireSupabaseAuth, which
 * must resolve public Supabase env the same way as the browser client.
 * Independent Vercel Preview often sets only VITE_SUPABASE_* — never require
 * Lovable Cloud SUPABASE_* alone, and never surface a Lovable Cloud hint.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("requireSupabaseAuth env source (KI)", () => {
  it("imports resolveSupabasePublicEnv instead of SUPABASE_* only", () => {
    const src = readFileSync(join(here, "auth-middleware.ts"), "utf8");
    expect(src).toMatch(/resolveSupabasePublicEnv/);
    expect(src).not.toMatch(/Connect Supabase in Lovable Cloud/);
    // Must not hard-require bare process.env SUPABASE_* without VITE fallback.
    expect(src).not.toMatch(/process\.env\['SUPABASE_URL'\]/);
    expect(src).not.toMatch(/process\.env\['SUPABASE_PUBLISHABLE_KEY'\]/);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("shared resolver succeeds with VITE_* only (middleware dependency)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://preview.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_preview");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");

    const { resolveSupabasePublicEnv } = await import("./public-env");
    expect(resolveSupabasePublicEnv()).toEqual({
      url: "https://preview.supabase.co",
      publishableKey: "sb_publishable_preview",
    });
  });
});

describe("user-facing Lovable Cloud connect hint removed from server Supabase clients", () => {
  it("client.server.ts has no Connect Supabase in Lovable Cloud hint", () => {
    const src = readFileSync(join(here, "client.server.ts"), "utf8");
    expect(src).not.toMatch(/Connect Supabase in Lovable Cloud/i);
  });

  it("public-env.ts has no Connect Supabase in Lovable Cloud hint", () => {
    const src = readFileSync(join(here, "public-env.ts"), "utf8");
    expect(src).not.toMatch(/Connect Supabase in Lovable Cloud/i);
  });
});
