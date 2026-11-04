/**
 * Onboarding wizard step order (Batch A).
 * Welcome+Lang → Google|Demo → WorkMode → personalized… → done.
 * Indices are stable for draft resume; do not reorder without draft migration.
 */

import type { Job, Settings } from "./types";

export const WIZARD_STEPS = [
  "welcome",
  "cloud",
  "workMode",
  "region",
  "rate",
  "personalized",
  "firstJob",
] as const;

export type WizardStepKey = (typeof WIZARD_STEPS)[number];

export const WIZARD_STEP_COUNT = WIZARD_STEPS.length;

export const WIZARD_STEP_INDEX = {
  welcome: 0,
  cloud: 1,
  workMode: 2,
  region: 3,
  rate: 4,
  personalized: 5,
  firstJob: 6,
} as const;

/** True when Google/Cloud must complete before personalized onboarding fields. */
export function isPersonalizedStep(step: number): boolean {
  return step >= WIZARD_STEP_INDEX.region;
}

/** Cloud (Google) is immediately before work mode. */
export function workModeFollowsCloud(): boolean {
  return WIZARD_STEP_INDEX.workMode === WIZARD_STEP_INDEX.cloud + 1;
}

/** New-user happy path order (keys). */
export function newUserFlowOrder(): readonly WizardStepKey[] {
  return WIZARD_STEPS;
}

/** Auth statuses the wizard uses for resume (matches useAuthSession). */
export type WizardAuthStatus = "loading" | "signed_in" | "signed_out";

/** Minimal settings slice used by the completion gate. */
export type WizardGateSettings = Pick<Settings, "onboarded" | "wizardCompletedAt">;

/**
 * True only when onboarding truly finished:
 * onboarded===true AND (at least one job OR finish() stamped wizardCompletedAt).
 * Skip-era / incomplete profiles with onboarded:true but no jobs and no stamp
 * are NOT complete — wizard must still show (Work Mode…).
 */
export function isWizardComplete(
  settings: WizardGateSettings | null | undefined,
  jobs: readonly Job[] | readonly unknown[] | null | undefined,
): boolean {
  if (settings?.onboarded !== true) return false;
  const hasJobs = Array.isArray(jobs) && jobs.length > 0;
  const stamp = settings.wizardCompletedAt;
  const hasStamp = typeof stamp === "number" && Number.isFinite(stamp) && stamp > 0;
  return hasJobs || hasStamp;
}

/**
 * Gate for __root: wizard only while onboarding is incomplete.
 * Cloud restore of a completed profile (isWizardComplete) → hide wizard.
 * Empty/partial / Skip-era backups stay incomplete → keep wizard.
 */
export function shouldShowOnboardingWizard(
  settings: WizardGateSettings | null | undefined,
  jobs: readonly Job[] | readonly unknown[] | null | undefined = [],
): boolean {
  return !isWizardComplete(settings, jobs);
}

/** Options for wizard resume / cloud gate (demo vs Google). */
export type WizardResumeOptions = {
  /** When true, allow past Cloud without signed_in (local demo path). */
  localDemoMode?: boolean;
  /**
   * False in a Public Local build: there is no Cloud/Google step at all - nobody is ever asked to sign in
   * and a draft that points at the Cloud step moves on to Work Mode. Default true (cloud builds).
   */
  cloudAvailable?: boolean;
};

/**
 * True when the Cloud step may be left without a Google session.
 * Demo path: localDemoMode. Google path: signed_in only.
 */
export function canAdvancePastCloud(
  authStatus: WizardAuthStatus,
  localDemoMode?: boolean,
  cloudAvailable: boolean = true,
): boolean {
  if (!cloudAvailable) return true;
  if (localDemoMode === true) return true;
  return authStatus === "signed_in";
}

/**
 * Resolve wizard step after OAuth redirect / session restore / reload.
 *
 * Rules (Batch A+ / demo):
 * - After Google (signed_in at Cloud), MUST continue at Work Mode — never Dashboard.
 * - Signed-out users cannot be past Cloud unless localDemoMode (Google required otherwise).
 * - Incomplete signed-in users keep a draft step beyond Work Mode (resume).
 * - While auth is loading, keep the draft step (OAuth resume may already be Work Mode).
 */
export function resolveWizardResumeStep(
  draftStep: number | null | undefined,
  authStatus: WizardAuthStatus,
  options?: WizardResumeOptions,
): number {
  const max = WIZARD_STEP_COUNT - 1;
  const step =
    typeof draftStep === "number" && Number.isInteger(draftStep) && draftStep >= 0
      ? Math.min(draftStep, max)
      : 0;
  const localDemo = options?.localDemoMode === true;

  // Public Local: the Cloud step does not exist; never stay on it, never require a session.
  if (options?.cloudAvailable === false) {
    return step === WIZARD_STEP_INDEX.cloud ? WIZARD_STEP_INDEX.workMode : step;
  }

  if (authStatus === "loading") return step;

  // Google required before Work Mode — unless local demo mode.
  if (
    authStatus === "signed_out" &&
    !localDemo &&
    step > WIZARD_STEP_INDEX.cloud
  ) {
    return WIZARD_STEP_INDEX.cloud;
  }

  // Post-Google: never leave the user on Cloud — Work Mode is next.
  if (authStatus === "signed_in" && step === WIZARD_STEP_INDEX.cloud) {
    return WIZARD_STEP_INDEX.workMode;
  }

  return step;
}

/** Step to persist immediately before OAuth so return lands on Work Mode. */
export function oauthResumeStep(): number {
  return WIZARD_STEP_INDEX.workMode;
}


/**
 * Next/previous wizard step honouring a missing Cloud step (Public Local build): moving forward from
 * Welcome lands on Work Mode, moving back from Work Mode lands on Welcome.
 */
export function neighbourStep(step: number, direction: 1 | -1, cloudAvailable: boolean): number {
  const raw = step + direction;
  const skipped = !cloudAvailable && raw === WIZARD_STEP_INDEX.cloud ? raw + direction : raw;
  return Math.min(Math.max(skipped, 0), WIZARD_STEP_COUNT - 1);
}
