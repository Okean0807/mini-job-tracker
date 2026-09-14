import { beforeEach, describe, expect, it } from "vitest";

import {
  ONBOARDING_DRAFT_KEY,
  checkpointOnboardingBeforeOAuth,
  clearOnboardingDraft,
  loadOnboardingDraft,
  normalizeOnboardingDraft,
  saveOnboardingDraft,
} from "./onboarding-draft";

const STEPS = 7;

describe("normalizeOnboardingDraft", () => {
  it("accepts a valid draft", () => {
    expect(normalizeOnboardingDraft({ step: 5, mode: "fest" }, STEPS)).toEqual({
      step: 5,
      mode: "fest",
    });
  });

  it("rejects out-of-range step, non-integer, or bad mode", () => {
    expect(normalizeOnboardingDraft({ step: 7, mode: "flex" }, STEPS)).toBeNull();
    expect(normalizeOnboardingDraft({ step: -1, mode: "flex" }, STEPS)).toBeNull();
    expect(normalizeOnboardingDraft({ step: 5.5, mode: "flex" }, STEPS)).toBeNull();
    expect(normalizeOnboardingDraft({ step: 5, mode: "nope" }, STEPS)).toBeNull();
    expect(normalizeOnboardingDraft(null, STEPS)).toBeNull();
    expect(normalizeOnboardingDraft("x", STEPS)).toBeNull();
  });
});

describe("onboarding draft storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips save → load across a simulated OAuth remount", () => {
    saveOnboardingDraft({ step: 5, mode: "selbststaendig" });
    // Full page return: new read from localStorage (same key)
    expect(window.localStorage.getItem(ONBOARDING_DRAFT_KEY)).toBeTruthy();
    expect(loadOnboardingDraft(STEPS)).toEqual({ step: 5, mode: "selbststaendig" });
  });

  it("clearOnboardingDraft removes the key", () => {
    saveOnboardingDraft({ step: 5, mode: "flex" });
    clearOnboardingDraft();
    expect(loadOnboardingDraft(STEPS)).toBeNull();
    expect(window.localStorage.getItem(ONBOARDING_DRAFT_KEY)).toBeNull();
  });

  it("loadOnboardingDraft ignores corrupt JSON", () => {
    window.localStorage.setItem(ONBOARDING_DRAFT_KEY, "{not-json");
    expect(loadOnboardingDraft(STEPS)).toBeNull();
  });
});

describe("checkpointOnboardingBeforeOAuth", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists settings then draft so Cloud-step OAuth can resume", () => {
    const calls: string[] = [];
    checkpointOnboardingBeforeOAuth({
      step: 5,
      mode: "fest",
      persistSettings: () => {
        calls.push("settings");
        // Simulate store write that must happen before redirect
      },
    });
    expect(calls).toEqual(["settings"]);
    expect(loadOnboardingDraft(STEPS)).toEqual({ step: 5, mode: "fest" });
  });
});
