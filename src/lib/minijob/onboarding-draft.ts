import type { WorkMode } from "@/lib/minijob/types";

/** Survives full-page OAuth redirect (same origin). Cleared when wizard finishes/skips. */
export const ONBOARDING_DRAFT_KEY = "minijob-onboarding-draft-v1";

export type OnboardingDraft = {
  /** 0-based wizard step index at the time of save (typically Cloud step before OAuth). */
  step: number;
  mode: WorkMode;
};

const WORK_MODES: readonly WorkMode[] = ["flex", "fest", "selbststaendig"];

export function isWorkMode(value: unknown): value is WorkMode {
  return typeof value === "string" && (WORK_MODES as readonly string[]).includes(value);
}

/**
 * Validate raw storage JSON. Invalid / out-of-range drafts are discarded so the
 * wizard falls back to step 0 rather than crashing.
 */
export function normalizeOnboardingDraft(
  raw: unknown,
  stepCount: number,
): OnboardingDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const step = obj['step'];
  const mode = obj['mode'];
  if (typeof step !== "number" || !Number.isInteger(step)) return null;
  if (step < 0 || step >= stepCount) return null;
  if (!isWorkMode(mode)) return null;
  return { step, mode };
}

export function saveOnboardingDraft(draft: OnboardingDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* quota / private mode — OAuth resume may fail; settings still persist */
  }
}

export function loadOnboardingDraft(stepCount: number): OnboardingDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ONBOARDING_DRAFT_KEY);
    if (!raw) return null;
    return normalizeOnboardingDraft(JSON.parse(raw) as unknown, stepCount);
  } catch {
    return null;
  }
}

export function clearOnboardingDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ONBOARDING_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Persist wizard progress + settings patch immediately before OAuth navigates away.
 * Settings (language/region/rate/supplements) live in the store; step/mode need the draft.
 */
export function checkpointOnboardingBeforeOAuth(input: {
  step: number;
  mode: WorkMode;
  persistSettings: () => void;
}): void {
  input.persistSettings();
  saveOnboardingDraft({ step: input.step, mode: input.mode });
}
