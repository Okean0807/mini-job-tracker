import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)));

describe("localDemoMode separation from auth", () => {
  it("cloud clears localDemoMode on real SIGNED_IN / session restore", () => {
    const src = readFileSync(join(root, "cloud.ts"), "utf8");
    expect(src).toMatch(/exitLocalDemoMode/);
    expect(src).toMatch(/SIGNED_IN/);
    const signedInAt = src.indexOf('event === "SIGNED_IN"');
    expect(signedInAt).toBeGreaterThan(-1);
    const slice = src.slice(signedInAt, signedInAt + 200);
    expect(slice).toMatch(/exitLocalDemoMode/);
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  /**
   * Spec change (P1 Testmodus isolation): previously the demo flag was flipped
   * off IN PLACE on sign-in, so onboarded/wizardCompletedAt (and all demo data)
   * were carried over into the real account and pushed to an empty cloud.
   * New safe behavior: Testmodus lives in its own namespace (`demo`); a real
   * account loads its own namespace and does NOT inherit demo completion.
   */
  it("demo completion stays in the demo namespace — a real account does not inherit it", async () => {
    const store = await import("./store");
    const { DEMO_SCOPE, userScope } = await import("./storage-scope");
    store.activateScope(DEMO_SCOPE);
    store.updateSettings({
      localDemoMode: true,
      onboarded: true,
      wizardCompletedAt: 123,
    });
    expect(store.getData().settings.localDemoMode).toBe(true);

    // Real sign-in → account namespace (cloud.ts bindSession → activateScope).
    store.activateScope(userScope("real-user"));
    expect(store.getData().settings.localDemoMode).not.toBe(true);
    expect(store.getData().settings.onboarded).not.toBe(true);
    expect(store.getData().settings.wizardCompletedAt).toBeUndefined();

    // Demo namespace keeps its flag and completion untouched.
    const demo = store.readScopeData(DEMO_SCOPE);
    expect(demo?.settings.localDemoMode).toBe(true);
    expect(demo?.settings.onboarded).toBe(true);
    expect(demo?.settings.wizardCompletedAt).toBe(123);
  });
});
