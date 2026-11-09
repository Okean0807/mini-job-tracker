/**
 * Unfinished onboarding survives reload, sign-out and sign-in again on the same device,
 * and never leaks into another namespace. Real store + draft modules, jsdom storage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WIZARD_STEP_INDEX,
  resolveWizardResumeStep,
  shouldShowOnboardingWizard,
} from "./wizard-flow";

async function modules() {
  const store = await import("./store");
  const draft = await import("./onboarding-draft");
  const scope = await import("./storage-scope");
  return { store, draft, scope };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.resetModules();
});

describe("unfinished onboarding across sign-out / sign-in", () => {
  it("sign-out and sign-in again restores step, mode and settings of that account only", async () => {
    const { store, draft, scope } = await modules();
    store.loadFromStorage();

    store.activateScope(scope.userScope("account-a"));
    store.updateSettings({ language: "en", bundesland: "BY", onboarded: false });
    draft.saveOnboardingDraft({ step: WIZARD_STEP_INDEX.rate, mode: "fest" });

    // sign-out → guest namespace: nothing of the account is visible, wizard starts fresh
    store.activateScope(scope.GUEST_SCOPE);
    expect(draft.loadOnboardingDraft()).toBeNull();
    expect(store.getData().settings.bundesland).not.toBe("BY");

    // another account on the same device sees none of it
    store.activateScope(scope.userScope("account-b"));
    expect(draft.loadOnboardingDraft()).toBeNull();

    // sign-in again → progress is back
    store.activateScope(scope.userScope("account-a"));
    expect(draft.loadOnboardingDraft()).toEqual({ step: WIZARD_STEP_INDEX.rate, mode: "fest" });
    const { settings, jobs } = store.getData();
    expect(settings.bundesland).toBe("BY");
    expect(shouldShowOnboardingWizard(settings, jobs)).toBe(true);
    expect(resolveWizardResumeStep(WIZARD_STEP_INDEX.rate, "signed_in")).toBe(
      WIZARD_STEP_INDEX.rate,
    );
  });

  it("a full reload in the account namespace resumes at the saved step", async () => {
    {
      const { store, draft, scope } = await modules();
      store.loadFromStorage();
      store.activateScope(scope.userScope("account-a"));
      store.updateSettings({ onboarded: false });
      draft.saveOnboardingDraft({ step: WIZARD_STEP_INDEX.personalized, mode: "selbststaendig" });
    }
    vi.resetModules();
    const { store, draft, scope } = await modules();
    store.loadFromStorage();
    expect(scope.ownerOfScope(store.getActiveScope())).toBe("account-a");
    expect(draft.loadOnboardingDraft()).toEqual({
      step: WIZARD_STEP_INDEX.personalized,
      mode: "selbststaendig",
    });
    expect(shouldShowOnboardingWizard(store.getData().settings, store.getData().jobs)).toBe(true);
  });

  it("signed out, a saved step beyond the Google step falls back to it (no bypass)", () => {
    expect(resolveWizardResumeStep(WIZARD_STEP_INDEX.rate, "signed_out")).toBe(
      WIZARD_STEP_INDEX.cloud,
    );
  });

  it("signed in on the Google step moves on to Work Mode, never to the start page", () => {
    expect(resolveWizardResumeStep(WIZARD_STEP_INDEX.cloud, "signed_in")).toBe(
      WIZARD_STEP_INDEX.workMode,
    );
  });

  it("an unfinished profile is never reported as complete after re-login", async () => {
    const { store, scope } = await modules();
    store.loadFromStorage();
    store.activateScope(scope.userScope("account-a"));
    store.updateSettings({ onboarded: false });
    store.activateScope(scope.GUEST_SCOPE);
    store.activateScope(scope.userScope("account-a"));
    expect(store.getData().settings.onboarded).toBe(false);
    expect(shouldShowOnboardingWizard(store.getData().settings, store.getData().jobs)).toBe(true);
  });
});
