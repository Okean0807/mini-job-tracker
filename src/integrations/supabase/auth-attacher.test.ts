/**
 * Regression: attachSupabaseAuth must soft-fail when the lazy supabase Proxy
 * throws (missing VITE_SUPABASE_*), matching initCloudSync / CloudSync /
 * dokumente. Without try/catch, every serverFn client call crashes the UI.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcPath = join(dirname(fileURLToPath(import.meta.url)), "auth-attacher.ts");
const src = readFileSync(srcPath, "utf8");

describe("attachSupabaseAuth soft-fail (auth-attacher.ts)", () => {
  it("wraps supabase.auth.getSession in try/catch", () => {
    expect(src).toMatch(/try\s*\{/);
    expect(src).toMatch(/catch\s*\(/);
    expect(src).toMatch(/supabase\.auth\.getSession\(\)/);
    expect(src).toMatch(/\[auth-attacher\] Supabase auth unavailable/);
  });

  it("still calls next with optional Authorization bearer", () => {
    expect(src).toMatch(/return next\(/);
    expect(src).toMatch(/Authorization:\s*`Bearer \$\{token\}`/);
    expect(src).toMatch(/continuing without bearer/);
  });
});
