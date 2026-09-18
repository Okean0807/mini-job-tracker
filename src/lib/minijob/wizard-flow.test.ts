import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WIZARD_STEPS,
  WIZARD_STEP_COUNT,
  WIZARD_STEP_INDEX,
  isPersonalizedStep,
  isWizardComplete,
  newUserFlowOrder,
  oauthResumeStep,
  resolveWizardResumeStep,
  shouldShowOnboardingWizard,
  workModeFollowsCloud,
} from "./wizard-flow";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("Batch A wizard step order", () => {
  it("Welcome → Cloud(Google) → WorkMode before personalized steps", () => {
    expect(newUserFlowOrder()).toEqual([
      "welcome",
      "cloud",
      "workMode",
      "region",
      "rate",
      "personalized",
      "firstJob",
    ]);
    expect(WIZARD_STEP_INDEX.welcome).toBe(0);
    expect(WIZARD_STEP_INDEX.cloud).toBe(1);
    expect(WIZARD_STEP_INDEX.workMode).toBe(2);
    expect(workModeFollowsCloud()).toBe(true);
    expect(isPersonalizedStep(WIZARD_STEP_INDEX.region)).toBe(true);
    expect(isPersonalizedStep(WIZARD_STEP_INDEX.cloud)).toBe(false);
    expect(WIZARD_STEP_COUNT).toBe(7);
    expect(WIZARD_STEPS[0]).toBe("welcome");
  });

  it("OnboardingWizard source follows the new indices", () => {
    const src = readFileSync(join(root, "components/minijob/OnboardingWizard.tsx"), "utf8");
    expect(src).toMatch(/WIZARD_STEP_INDEX\.welcome/);
    expect(src).toMatch(/WIZARD_STEP_INDEX\.cloud/);
    expect(src).toMatch(/WIZARD_STEP_INDEX\.workMode/);
    expect(src).toMatch(/wiz\.welcome\.title/);
    expect(src).toMatch(/wiz\.language\.select/);
    // Compare JSX step card render order (brace form), not goNext guards.
    const welcomeAt = src.indexOf("{step === WIZARD_STEP_INDEX.welcome ? (");
    const cloudAt = src.indexOf("{step === WIZARD_STEP_INDEX.cloud ? (");
    const modeAt = src.indexOf("{step === WIZARD_STEP_INDEX.workMode ? (");
    expect(welcomeAt).toBeGreaterThan(-1);
    expect(cloudAt).toBeGreaterThan(welcomeAt);
    expect(modeAt).toBeGreaterThan(cloudAt);
  });

  it("mode-specific personalized branches exist without deleting data on mode switch", () => {
    const src = readFileSync(join(root, "components/minijob/OnboardingWizard.tsx"), "utf8");
    expect(src).toMatch(/wiz\.personalized\.flex/);
    expect(src).toMatch(/wiz\.personalized\.fest/);
    expect(src).toMatch(/wiz\.personalized\.self/);
    expect(src).toMatch(/Never wipe/);
    expect(src).toMatch(/weeklyTarget/);
    expect(src).toMatch(/wiz\.personalized\.self\.noLimit/);
  });

  it("sticky footer uses safe-area and primary Weiter", () => {
    const src = readFileSync(join(root, "components/minijob/OnboardingWizard.tsx"), "utf8");
    expect(src).toMatch(/safe-area-inset-bottom/);
    expect(src).toMatch(/min-h-11/);
    expect(src).toMatch(/sticky bottom-0/);
    expect(src).toMatch(/flex-1/);
    expect(src).toMatch(/goBack/);
  });

  it("field help keys are wired for important onboarding fields", () => {
    const src = readFileSync(join(root, "components/minijob/OnboardingWizard.tsx"), "utf8");
    for (const key of [
      "wiz.help.rate",
      "wiz.help.workMode",
      "wiz.help.employer",
      "wiz.help.monthLimit",
      "wiz.help.supplements",
      "wiz.help.absence",
      "wiz.help.tax",
      "wiz.help.startEnd",
      "wiz.help.break",
      "wiz.help.activity",
      "wiz.help.location",
    ]) {
      expect(src).toContain(key);
    }
  });
});

describe("returning user skips wizard; language persists", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("root gates wizard via shouldShowOnboardingWizard(settings, jobs)", () => {
    const rootSrc = readFileSync(join(root, "routes/__root.tsx"), "utf8");
    expect(rootSrc).toMatch(/shouldShowOnboardingWizard\(loaded, data\.jobs\)/);
    expect(rootSrc).toMatch(/shouldShowOnboardingWizard\(settings, jobs\)/);
    expect(rootSrc).toMatch(/showWizard && !locked/);
  });

  it("language survives reload and is not cleared by draft", async () => {
    const store = await import("./store");
    store.updateSettings({ language: "en", onboarded: false });
    expect(store.getData().settings.language).toBe("en");

    const { persistOnboardingProgress } = await import("./onboarding-draft");
    persistOnboardingProgress({
      step: 0,
      mode: "flex",
      persistSettings: () => {
        /* language already in store */
      },
    });

    vi.resetModules();
    const storeAfter = await import("./store");
    storeAfter.loadFromStorage();
    expect(storeAfter.getData().settings.language).toBe("en");
    expect(storeAfter.getData().settings.onboarded).toBe(false);
  });

  it("incomplete onboarding resumes at last saved step", async () => {
    const { persistOnboardingProgress, loadOnboardingDraft } = await import("./onboarding-draft");
    persistOnboardingProgress({
      step: WIZARD_STEP_INDEX.region,
      mode: "flex",
      persistSettings: () => undefined,
    });
    expect(loadOnboardingDraft()).toEqual({
      step: WIZARD_STEP_INDEX.region,
      mode: "flex",
    });
  });

  it("completed users with jobs do not need the wizard", async () => {
    const store = await import("./store");
    store.updateSettings({ onboarded: true, wizardCompletedAt: Date.now(), language: "de" });
    const data = store.getData();
    expect(isWizardComplete(data.settings, data.jobs)).toBe(true);
    expect(shouldShowOnboardingWizard(data.settings, data.jobs)).toBe(false);
  });
});


describe("post-Google onboarding routing", () => {
  it("new Google user resumes at Work Mode (never Dashboard via onboarded gate)", () => {
    expect(oauthResumeStep()).toBe(WIZARD_STEP_INDEX.workMode);
    expect(
      resolveWizardResumeStep(WIZARD_STEP_INDEX.cloud, "signed_in"),
    ).toBe(WIZARD_STEP_INDEX.workMode);
    expect(
      resolveWizardResumeStep(WIZARD_STEP_INDEX.workMode, "signed_in"),
    ).toBe(WIZARD_STEP_INDEX.workMode);
    // Still incomplete → wizard must show
    expect(shouldShowOnboardingWizard({ onboarded: false }, [])).toBe(true);
  });

  it("completed onboarded users skip wizard (Dashboard)", () => {
    expect(
      shouldShowOnboardingWizard({ onboarded: true, wizardCompletedAt: 1 }, []),
    ).toBe(false);
    expect(
      shouldShowOnboardingWizard({ onboarded: true }, [{ id: "j1" }]),
    ).toBe(false);
  });

  it("empty/partial backup onboarded flag must not look completed", () => {
    expect(shouldShowOnboardingWizard({ onboarded: false }, [])).toBe(true);
    expect(shouldShowOnboardingWizard(undefined, [])).toBe(true);
    expect(shouldShowOnboardingWizard(null, [])).toBe(true);
  });

  it("Skip-era onboarded:true without jobs/stamp cannot hide wizard", () => {
    expect(isWizardComplete({ onboarded: true }, [])).toBe(false);
    expect(shouldShowOnboardingWizard({ onboarded: true }, [])).toBe(true);
  });

  it("isWizardComplete requires onboarded + (jobs OR wizardCompletedAt)", () => {
    expect(isWizardComplete({ onboarded: false }, [{ id: "j" }])).toBe(false);
    expect(isWizardComplete({ onboarded: true }, [])).toBe(false);
    expect(isWizardComplete({ onboarded: true, wizardCompletedAt: 0 }, [])).toBe(false);
    expect(isWizardComplete({ onboarded: true, wizardCompletedAt: 42 }, [])).toBe(true);
    expect(isWizardComplete({ onboarded: true }, [{ id: "j" }])).toBe(true);
  });

  it("finish() stamps wizardCompletedAt in OnboardingWizard", () => {
    const src = readFileSync(join(root, "components/minijob/OnboardingWizard.tsx"), "utf8");
    expect(src).toMatch(/wizardCompletedAt:\s*Date\.now\(\)/);
    expect(src).toMatch(/onboarded:\s*true/);
  });

  it("applyRemote uses isWizardComplete (incomplete stays wizard)", () => {
    const cloudSrc = readFileSync(join(root, "lib/minijob/cloud.ts"), "utf8");
    expect(cloudSrc).toMatch(/isWizardComplete\(merged\.settings, merged\.jobs\)/);
    expect(cloudSrc).toMatch(/onboarded: false/);
    expect(cloudSrc).toMatch(/KEEP jobs\/shifts/);
  });

  it("fest/selbststaendig stay on mode-specific path after Work Mode", () => {
    expect(resolveWizardResumeStep(WIZARD_STEP_INDEX.personalized, "signed_in")).toBe(
      WIZARD_STEP_INDEX.personalized,
    );
    expect(isPersonalizedStep(WIZARD_STEP_INDEX.personalized)).toBe(true);
  });

  it("signed-out cannot stay past Cloud; incomplete resumes open step when signed in", () => {
    expect(
      resolveWizardResumeStep(WIZARD_STEP_INDEX.region, "signed_out"),
    ).toBe(WIZARD_STEP_INDEX.cloud);
    expect(
      resolveWizardResumeStep(WIZARD_STEP_INDEX.region, "signed_in"),
    ).toBe(WIZARD_STEP_INDEX.region);
  });

  it("OAuth callback / session restore must not bypass Work Mode", () => {
    // Draft checkpointed at Cloud (legacy) or Work Mode (current) → Work Mode when signed in
    expect(resolveWizardResumeStep(WIZARD_STEP_INDEX.cloud, "signed_in")).toBe(
      WIZARD_STEP_INDEX.workMode,
    );
    expect(resolveWizardResumeStep(oauthResumeStep(), "loading")).toBe(
      WIZARD_STEP_INDEX.workMode,
    );
  });
});
