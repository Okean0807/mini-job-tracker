import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WIZARD_STEPS,
  WIZARD_STEP_COUNT,
  WIZARD_STEP_INDEX,
  canAdvancePastCloud,
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
      "wiz.help.selfActivity",
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

describe("local demo onboarding (no Google)", () => {
  it("demo may advance past Cloud without signed_in; non-demo cannot", () => {
    expect(canAdvancePastCloud("signed_out", true)).toBe(true);
    expect(canAdvancePastCloud("loading", true)).toBe(true);
    expect(canAdvancePastCloud("signed_in", false)).toBe(true);
    expect(canAdvancePastCloud("signed_out", false)).toBe(false);
    expect(canAdvancePastCloud("loading", false)).toBe(false);
  });

  it("resolveWizardResumeStep: demo keeps Work Mode when signed_out", () => {
    expect(
      resolveWizardResumeStep(WIZARD_STEP_INDEX.workMode, "signed_out", {
        localDemoMode: true,
      }),
    ).toBe(WIZARD_STEP_INDEX.workMode);
    expect(
      resolveWizardResumeStep(WIZARD_STEP_INDEX.region, "signed_out", {
        localDemoMode: true,
      }),
    ).toBe(WIZARD_STEP_INDEX.region);
    expect(
      resolveWizardResumeStep(WIZARD_STEP_INDEX.personalized, "signed_out", {
        localDemoMode: true,
      }),
    ).toBe(WIZARD_STEP_INDEX.personalized);
  });

  it("resolveWizardResumeStep: non-demo still blocked past Cloud when signed_out", () => {
    expect(
      resolveWizardResumeStep(WIZARD_STEP_INDEX.workMode, "signed_out"),
    ).toBe(WIZARD_STEP_INDEX.cloud);
    expect(
      resolveWizardResumeStep(WIZARD_STEP_INDEX.workMode, "signed_out", {
        localDemoMode: false,
      }),
    ).toBe(WIZARD_STEP_INDEX.cloud);
  });

  it("all three modes still branch after workMode (indices unchanged)", () => {
    expect(WIZARD_STEP_INDEX.workMode).toBe(2);
    expect(isPersonalizedStep(WIZARD_STEP_INDEX.personalized)).toBe(true);
    for (const mode of ["flex", "fest", "selbststaendig"] as const) {
      expect(["flex", "fest", "selbststaendig"]).toContain(mode);
    }
    const src = readFileSync(join(root, "components/minijob/OnboardingWizard.tsx"), "utf8");
    expect(src).toMatch(/wiz\.personalized\.flex/);
    expect(src).toMatch(/wiz\.personalized\.fest/);
    expect(src).toMatch(/wiz\.personalized\.self/);
  });

  it("finish() completes wizard in demo (onboarded + stamp; localDemoMode kept)", async () => {
    window.localStorage.clear();
    vi.resetModules();
    const store = await import("./store");
    store.updateSettings({
      localDemoMode: true,
      onboarded: true,
      wizardCompletedAt: Date.now(),
      language: "de",
    });
    const data = store.getData();
    expect(data.settings.localDemoMode).toBe(true);
    expect(isWizardComplete(data.settings, data.jobs)).toBe(true);
    expect(shouldShowOnboardingWizard(data.settings, data.jobs)).toBe(false);
  });

  it("Google path resume still advances Cloud → Work Mode when signed_in", () => {
    expect(
      resolveWizardResumeStep(WIZARD_STEP_INDEX.cloud, "signed_in", {
        localDemoMode: false,
      }),
    ).toBe(WIZARD_STEP_INDEX.workMode);
  });

  it("OnboardingWizard exposes demo CTA and gates goNext via canAdvancePastCloud", () => {
    const src = readFileSync(join(root, "components/minijob/OnboardingWizard.tsx"), "utf8");
    expect(src).toMatch(/wiz\.cloud\.demoTest/);
    expect(src).toMatch(/startLocalDemo/);
    expect(src).toMatch(/localDemoMode:\s*true/);
    expect(src).toMatch(/canAdvancePastCloud/);
    expect(src).toMatch(/wiz\.demo\.banner/);
    // Must not invent fake Supabase/Google session for demo
    expect(src).not.toMatch(/fake.*supabase|demo@|fake@google/i);
  });
});

describe("SELF rate step is Tätigkeit (no Pflicht-Stundenlohn)", () => {
  it("SELF branches rate step to Tätigkeit UI; FLEX/FEST keep wage", () => {
    const src = readFileSync(join(root, "components/minijob/OnboardingWizard.tsx"), "utf8");
    // SELF: Tätigkeit at rate index — no Standard-Stundenlohn in that branch
    expect(src).toMatch(/mode === "selbststaendig"/);
    expect(src).toMatch(/wiz\.rate\.self\.title/);
    expect(src).toMatch(/wiz\.rate\.self\.label/);
    expect(src).toMatch(/wiz\.step\.activity/);
    expect(src).toMatch(/ob-activity/);
    expect(src).toMatch(/wiz\.help\.selfActivity/);
    // FLEX/FEST wage screen unchanged
    expect(src).toMatch(/wiz\.rate\.label/);
    expect(src).toMatch(/id="ob-rate"/);
    expect(src).toMatch(/wiz\.help\.rate/);
    // FEST personalized Sollstunden unchanged
    expect(src).toMatch(/wiz\.personalized\.fest\.weeklyTarget/);
    expect(src).toMatch(/ob-weekly/);
  });

  it("SELF step label uses Tätigkeit, not Stundenlohn", () => {
    const src = readFileSync(join(root, "components/minijob/OnboardingWizard.tsx"), "utf8");
    expect(src).toMatch(
      /mode === "selbststaendig" \? t\("wiz\.step\.activity"\) : t\("wiz\.step\.rate"\)/,
    );
  });

  it("SELF finish omits Job.rate wage; stores Tätigkeit in job name", () => {
    const src = readFileSync(join(root, "components/minijob/OnboardingWizard.tsx"), "utf8");
    // SELF never gets Job.rate; FEST monthly also omits (monthlyGross). Flex/fest-hourly keep rate.
    expect(src).toMatch(/mode !== "selbststaendig"/);
    expect(src).toMatch(/rate: numericRate/);
    expect(src).toMatch(/payType === "monthly"/);
    // Tätigkeit field writes jobName (Job.name) — existing safe field
    expect(src).toMatch(/id="ob-activity"[\s\S]*?value=\{jobName\}/);
  });

  it("i18n: SELF Tätigkeit keys; wage label kept for FLEX; no kalk. Stundensatz", () => {
    const dict = readFileSync(join(root, "lib/i18n/dict/wizard.ts"), "utf8");
    expect(dict).toContain('"wiz.rate.label": "Standard-Stundenlohn (€)"');
    expect(dict).toContain('"wiz.rate.self.title": "Deine selbständige Tätigkeit"');
    expect(dict).toContain('"wiz.rate.self.label": "Tätigkeit / Leistung"');
    expect(dict).toContain('"wiz.step.activity": "Tätigkeit"');
    // No kalkulatorischer Stundensatz — Job.rate is Lohn semantics (omit without migration)
    expect(dict).not.toContain("Kalkulatorischer Stundensatz");
  });

  it("rate step index and count stay stable", () => {
    expect(WIZARD_STEP_INDEX.rate).toBe(4);
    expect(WIZARD_STEP_COUNT).toBe(7);
  });
});

describe("wizard job name required (v1.1)", () => {
  it("Finish disabled when jobName empty; finish() early-returns with toast", () => {
    const src = readFileSync(join(root, "components/minijob/OnboardingWizard.tsx"), "utf8");
    expect(src).toMatch(/disabled=\{!jobName\.trim\(\)\}/);
    expect(src).toMatch(/if \(!name\) \{[\s\S]*?toast\.error\(t\("job\.errorName"\)\)/);
    expect(src).toMatch(/function finish\(\) \{[\s\S]*?const name = jobName\.trim\(\)/);
  });
});
