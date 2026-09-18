import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { WIZARD_STEP_COUNT, WIZARD_STEP_INDEX } from "./wizard-flow";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const STEPS = WIZARD_STEP_COUNT;

/**
 * Regression: setup wizard must checkpoint step/mode (+ settings) before OAuth
 * so a full-page Google return does not drop the user at step 0.
 */
describe("OnboardingWizard OAuth resume wiring", () => {
  it("checkpoints draft before OAuth and clears on finish/skip", () => {
    const src = readFileSync(join(root, "components/minijob/OnboardingWizard.tsx"), "utf8");
    expect(src).toMatch(/checkpointOnboardingBeforeOAuth/);
    expect(src).toMatch(/loadOnboardingDraft/);
    expect(src).toMatch(/clearOnboardingDraft/);
    const checkpointAt = src.indexOf("checkpointOnboardingBeforeOAuth");
    const signInAt = src.indexOf('signInWithOAuthProvider("google")');
    expect(checkpointAt).toBeGreaterThan(-1);
    expect(signInAt).toBeGreaterThan(checkpointAt);
  });
});

describe("OAuth remount resume scenario", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("restores Cloud-step progress and store settings after simulated redirect", async () => {
    const store = await import("./store");
    const { checkpointOnboardingBeforeOAuth } = await import("./onboarding-draft");

    store.updateSettings({
      language: "en",
      country: "AT",
      bundesland: "W",
      defaultRate: 15.5,
      supplements: {
        ...store.getData().settings.supplements,
        sunday: { enabled: true, mode: "prozent", value: 50 },
      },
      onboarded: false,
    });

    checkpointOnboardingBeforeOAuth({
      step: WIZARD_STEP_INDEX.cloud,
      mode: "fest",
      persistSettings: () => {
        /* settings already flushed via updateSettings above */
      },
    });

    vi.resetModules();
    const storeAfter = await import("./store");
    const draftAfter = await import("./onboarding-draft");
    storeAfter.loadFromStorage();

    const settings = storeAfter.getData().settings;
    expect(settings.language).toBe("en");
    expect(settings.country).toBe("AT");
    expect(settings.defaultRate).toBe(15.5);
    expect(settings.supplements.sunday.enabled).toBe(true);
    expect(settings.onboarded).toBe(false);

    expect(draftAfter.loadOnboardingDraft(STEPS)).toEqual({
      step: WIZARD_STEP_INDEX.cloud,
      mode: "fest",
    });

    draftAfter.clearOnboardingDraft();
    expect(draftAfter.loadOnboardingDraft(STEPS)).toBeNull();
  });
});
