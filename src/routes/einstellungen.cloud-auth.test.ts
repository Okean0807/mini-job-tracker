/**
 * Regression: CloudSync must use shared useAuthSession (bindAuthSession + loading)
 * so Account matches Dokumente/Wizard and missing env soft-fails inside the hook.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcPath = join(dirname(fileURLToPath(import.meta.url)), "einstellungen.tsx");
const src = readFileSync(srcPath, "utf8");

function cloudSyncBody(): string {
  const fnStart = src.indexOf("function CloudSync(");
  expect(fnStart).toBeGreaterThanOrEqual(0);
  const nextFn = src.indexOf("\nfunction ", fnStart + 1);
  return src.slice(fnStart, nextFn === -1 ? undefined : nextFn);
}

describe("CloudSync auth unify (einstellungen.tsx)", () => {
  it("uses shared useAuthSession (not local bindAuthSession)", () => {
    const body = cloudSyncBody();
    expect(body).toMatch(/useAuthSession\(\)/);
    expect(body).not.toMatch(/bindAuthSession/);
  });

  it("shows loading skeleton before sign-in buttons", () => {
    const body = cloudSyncBody();
    expect(body).toMatch(/authStatus === "loading"/);
    expect(body).toMatch(/Skeleton/);
    const loadingAt = body.indexOf('authStatus === "loading"');
    const signedOutAt = body.indexOf('authStatus === "signed_out"');
    expect(loadingAt).toBeGreaterThan(-1);
    expect(signedOutAt).toBeGreaterThan(loadingAt);
  });
});

describe("useAuthSession soft-fail (hook)", () => {
  it("wraps bindAuthSession in try/catch", () => {
    const hook = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../hooks/use-auth-session.ts"),
      "utf8",
    );
    expect(hook).toMatch(/try\s*\{/);
    expect(hook).toMatch(/catch\s*\(/);
    expect(hook).toMatch(/\[useAuthSession\] Supabase auth unavailable/);
    expect(hook).toMatch(/bindAuthSession\(supabase,/);
  });
});
