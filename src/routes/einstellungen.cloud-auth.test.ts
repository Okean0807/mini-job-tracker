/**
 * Regression: CloudSync auth useEffect must soft-fail when the lazy supabase
 * Proxy throws (missing VITE_SUPABASE_*), matching dokumente.tsx / initCloudSync.
 * Without try/catch, visiting Einstellungen crashes the settings tab.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcPath = join(dirname(fileURLToPath(import.meta.url)), "einstellungen.tsx");
const src = readFileSync(srcPath, "utf8");

function cloudSyncAuthEffect(): string {
  const fnStart = src.indexOf("function CloudSync(");
  expect(fnStart).toBeGreaterThanOrEqual(0);
  const effectStart = src.indexOf("useEffect(() => {", fnStart);
  expect(effectStart).toBeGreaterThan(fnStart);
  const effectEnd = src.indexOf("}, []);", effectStart);
  expect(effectEnd).toBeGreaterThan(effectStart);
  return src.slice(effectStart, effectEnd + "}, []);".length);
}

describe("CloudSync auth soft-fail (einstellungen.tsx)", () => {
  it("wraps auth bind in try/catch", () => {
    const effect = cloudSyncAuthEffect();
    expect(effect).toMatch(/try\s*\{/);
    expect(effect).toMatch(/catch\s*\(/);
    expect(effect).toMatch(/\[einstellungen\] Supabase auth unavailable/);
    expect(effect).toMatch(/setSession\(null\)/);
  });

  it("binds via bindAuthSession (subscribe + getSession)", () => {
    const effect = cloudSyncAuthEffect();
    expect(effect).toMatch(/bindAuthSession\(supabase,\s*setSession\)/);
  });
});
