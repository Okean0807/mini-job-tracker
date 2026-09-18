import { beforeEach, describe, expect, it } from "vitest";

import {
  ONBOARDING_DRAFT_KEY,
  ONBOARDING_DRAFT_KEY_V1,
  checkpointOnboardingBeforeOAuth,
  clearOnboardingDraft,
  loadOnboardingDraft,
  normalizeOnboardingDraft,
  persistOnboardingProgress,
  saveOnboardingDraft,
} from "./onboarding-draft";
import { WIZARD_STEP_COUNT, WIZARD_STEP_INDEX } from "./wizard-flow";

const STEPS = WIZARD_STEP_COUNT;

describe("normalizeOnboardingDraft", () => {
  it("accepts a valid draft", () => {
    expect(normalizeOnboardingDraft({ step: WIZARD_STEP_INDEX.cloud, mode: "fest" }, STEPS)).toEqual({
      step: WIZARD_STEP_INDEX.cloud,
      mode: "fest",
    });
  });

  it("rejects out-of-range step, non-integer, or bad mode", () => {
    expect(normalizeOnboardingDraft({ step: STEPS, mode: "flex" }, STEPS)).toBeNull();
    expect(normalizeOnboardingDraft({ step: -1, mode: "flex" }, STEPS)).toBeNull();
    expect(normalizeOnboardingDraft({ step: 5.5, mode: "flex" }, STEPS)).toBeNull();
    expect(normalizeOnboardingDraft({ step: 1, mode: "nope" }, STEPS)).toBeNull();
    expect(normalizeOnboardingDraft(null, STEPS)).toBeNull();
    expect(normalizeOnboardingDraft("x", STEPS)).toBeNull();
  });
});

describe("onboarding draft storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips save → load across a simulated OAuth remount", () => {
    saveOnboardingDraft({ step: WIZARD_STEP_INDEX.cloud, mode: "selbststaendig" });
    expect(window.localStorage.getItem(ONBOARDING_DRAFT_KEY)).toBeTruthy();
    expect(loadOnboardingDraft(STEPS)).toEqual({
      step: WIZARD_STEP_INDEX.cloud,
      mode: "selbststaendig",
    });
  });

  it("clearOnboardingDraft removes the key", () => {
    saveOnboardingDraft({ step: WIZARD_STEP_INDEX.cloud, mode: "flex" });
    clearOnboardingDraft();
    expect(loadOnboardingDraft(STEPS)).toBeNull();
    expect(window.localStorage.getItem(ONBOARDING_DRAFT_KEY)).toBeNull();
  });

  it("loadOnboardingDraft ignores corrupt JSON and clears legacy v1", () => {
    window.localStorage.setItem(ONBOARDING_DRAFT_KEY, "{not-json");
    expect(loadOnboardingDraft(STEPS)).toBeNull();
    window.localStorage.setItem(ONBOARDING_DRAFT_KEY_V1, JSON.stringify({ step: 5, mode: "flex" }));
    expect(loadOnboardingDraft(STEPS)).toBeNull();
    expect(window.localStorage.getItem(ONBOARDING_DRAFT_KEY_V1)).toBeNull();
  });

  it("persistOnboardingProgress saves incomplete resume point", () => {
    const calls: string[] = [];
    persistOnboardingProgress({
      step: WIZARD_STEP_INDEX.workMode,
      mode: "fest",
      persistSettings: () => calls.push("settings"),
    });
    expect(calls).toEqual(["settings"]);
    expect(loadOnboardingDraft(STEPS)).toEqual({
      step: WIZARD_STEP_INDEX.workMode,
      mode: "fest",
    });
  });
});

describe("checkpointOnboardingBeforeOAuth", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists settings then draft so Cloud-step OAuth can resume", () => {
    const calls: string[] = [];
    checkpointOnboardingBeforeOAuth({
      step: WIZARD_STEP_INDEX.cloud,
      mode: "fest",
      persistSettings: () => {
        calls.push("settings");
      },
    });
    expect(calls).toEqual(["settings"]);
    expect(loadOnboardingDraft(STEPS)).toEqual({
      step: WIZARD_STEP_INDEX.cloud,
      mode: "fest",
    });
  });
});
