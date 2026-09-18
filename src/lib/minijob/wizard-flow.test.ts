import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WIZARD_STEPS,
  WIZARD_STEP_COUNT,
  WIZARD_STEP_INDEX,
  isPersonalizedStep,
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

  it("root only shows wizard when !onboarded", () => {
    const rootSrc = readFileSync(join(root, "routes/__root.tsx"), "utf8");
    expect(rootSrc).toMatch(/shouldShowOnboardingWizard\(loaded\.onboarded\)/);
    expect(rootSrc).toMatch(/shouldShowOnboardingWizard\(settings\.onboarded\)/);
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

  it("onboarded users do not need the wizard (gate flag)", async () => {
    const store = await import("./store");
    store.updateSettings({ onboarded: true, language: "de" });
    expect(store.getData().settings.onboarded).toBe(true);
    // Mirror __root gate
    const showWizard = !store.getData().settings.onboarded;
    expect(showWizard).toBe(false);
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
    expect(shouldShowOnboardingWizard(false)).toBe(true);
  });

  it("completed onboarded users skip wizard (Dashboard)", () => {
    expect(shouldShowOnboardingWizard(true)).toBe(false);
  });

  it("empty/partial backup onboarded flag must not look completed", () => {
    // normalize defaults + applyRemote force false when not === true
    expect(shouldShowOnboardingWizard(false)).toBe(true);
    expect(shouldShowOnboardingWizard(undefined as unknown as boolean)).toBe(true);
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
