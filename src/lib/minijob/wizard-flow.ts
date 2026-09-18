/**
 * Onboarding wizard step order (Batch A).
 * Welcome+Lang → Google → WorkMode → personalized… → done.
 * Indices are stable for draft resume; do not reorder without draft migration.
 */
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
