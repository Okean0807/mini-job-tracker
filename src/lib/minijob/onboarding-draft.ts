import type { WorkMode } from "@/lib/minijob/types";
import { WIZARD_STEP_COUNT } from "@/lib/minijob/wizard-flow";

import { scopedKey, type StorageScope } from "./storage-scope";
import { getActiveScope } from "./store";

/**
 * Survives full-page OAuth redirect and incomplete wizard resume (same origin).
 * v2: new step order (Welcome → Cloud → WorkMode → …). Old v1 keys are ignored.
 *
 * Base key only: drafts are stored per storage scope (`<base>:u:<id>`, `:demo`,
 * `:guest`) so an incomplete draft of account A is never shown to account B.
 * The unsuffixed global key is legacy and is left untouched.
 */
export const ONBOARDING_DRAFT_KEY = "minijob-onboarding-draft-v2";

export function onboardingDraftStorageKey(scope: StorageScope = getActiveScope()): string {
  return scopedKey(ONBOARDING_DRAFT_KEY, scope);
}
/** Legacy key from pre–Batch A order; cleared on load so it cannot confuse resume. */
export const ONBOARDING_DRAFT_KEY_V1 = "minijob-onboarding-draft-v1";

export type OnboardingDraft = {
  /** 0-based wizard step index at the time of save. */
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
  stepCount: number = WIZARD_STEP_COUNT,
): OnboardingDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const step = obj["step"];
  const mode = obj["mode"];
  if (typeof step !== "number" || !Number.isInteger(step)) return null;
  if (step < 0 || step >= stepCount) return null;
  if (!isWorkMode(mode)) return null;
  return { step, mode };
}

export function saveOnboardingDraft(draft: OnboardingDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(onboardingDraftStorageKey(), JSON.stringify(draft));
  } catch {
    /* quota / private mode — OAuth resume may fail; settings still persist */
  }
}

export function loadOnboardingDraft(stepCount: number = WIZARD_STEP_COUNT): OnboardingDraft | null {
  if (typeof window === "undefined") return null;
  try {
    // Drop legacy v1 drafts (different step indices) so resume cannot land on wrong step.
    try {
      window.localStorage.removeItem(ONBOARDING_DRAFT_KEY_V1);
    } catch {
      /* ignore */
    }
    const raw = window.localStorage.getItem(onboardingDraftStorageKey());
    if (!raw) return null;
    return normalizeOnboardingDraft(JSON.parse(raw) as unknown, stepCount);
  } catch {
    return null;
  }
}

/**
 * OAuth-Handoff: nur Schritt + Arbeitsart (keine Nutzerdaten) aus dem Namensraum,
 * in dem Google gestartet wurde, in den neuen Konto-Namensraum übernehmen –
 * und nur, wenn dort noch kein eigener Entwurf liegt.
 */
export function handoffOnboardingDraft(
  from: StorageScope,
  to: StorageScope,
  stepCount: number = WIZARD_STEP_COUNT,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(onboardingDraftStorageKey(to))) return false;
    const raw = window.localStorage.getItem(onboardingDraftStorageKey(from));
    if (!raw) return false;
    const draft = normalizeOnboardingDraft(JSON.parse(raw) as unknown, stepCount);
    if (!draft) return false;
    window.localStorage.setItem(onboardingDraftStorageKey(to), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearOnboardingDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(onboardingDraftStorageKey());
    window.localStorage.removeItem(ONBOARDING_DRAFT_KEY_V1);
  } catch {
    /* ignore */
  }
}

/**
 * Persist wizard progress + settings. Used before OAuth and on each Weiter so
 * incomplete onboarding resumes at the last step (no Login↔Onboarding loop).
 */
export function persistOnboardingProgress(input: {
  step: number;
  mode: WorkMode;
  persistSettings: () => void;
}): void {
  input.persistSettings();
  saveOnboardingDraft({ step: input.step, mode: input.mode });
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
  persistOnboardingProgress(input);
}
