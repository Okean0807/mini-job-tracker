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

  it("demo completion is local only — flag stays until sign-in clears it", async () => {
    const store = await import("./store");
    store.updateSettings({
      localDemoMode: true,
      onboarded: true,
      wizardCompletedAt: 123,
    });
    expect(store.getData().settings.localDemoMode).toBe(true);
    store.updateSettings({ localDemoMode: false });
    expect(store.getData().settings.localDemoMode).toBe(false);
    // onboarded stamp must not be invented as cloud completion by clearing demo
    expect(store.getData().settings.onboarded).toBe(true);
    expect(store.getData().settings.wizardCompletedAt).toBe(123);
  });
});
