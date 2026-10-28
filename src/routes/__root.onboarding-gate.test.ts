/**
 * Wiring guards for the root: the behaviour itself is covered by wizard-gate.test.ts,
 * post-auth-landing.test.ts and PostAuthLanding.test.ts. These only make sure the root uses
 * those pieces (and not an inline shortcut) so the tested logic is the one that runs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = readFileSync(join(process.cwd(), "src/routes/__root.tsx"), "utf8");

describe("__root onboarding / landing wiring", () => {
  it("finishing the wizard goes through useWizardDone (lands on '/'), not an inline hide", () => {
    expect(root).toMatch(/const finishWizard = useWizardDone\(hideWizard\)/);
    expect(root).toMatch(
      /<OnboardingWizard key=\{scope\} settings=\{settings\} onDone=\{finishWizard\}/,
    );
    expect(root).not.toMatch(/onDone=\{\(\) => setShowWizard\(false\)\}/);
  });

  it("renders the post-sign-in landing effect with the restore state", () => {
    expect(root).toMatch(
      /<PostAuthLanding[\s\S]*?authStatus=\{authStatus\}[\s\S]*?restorePending=\{restorePending\}/,
    );
  });

  it("the wizard only mounts when the overlay decision says 'wizard'; 'restoring' shows the loader", () => {
    expect(root).toMatch(/wizardOverlay === "restoring"[\s\S]*?<ProfileRestoreSplash/);
    expect(root).toMatch(/wizardOverlay === "wizard"[\s\S]*?<OnboardingWizard/);
    expect(root).toMatch(/resolveWizardOverlay\(\{ wizardNeeded: showWizard, restorePending \}\)/);
  });

  it("restore state combines the first-sync status with the Google-return window", () => {
    expect(root).toMatch(/isFirstProfileRestorePending\(\{[\s\S]*?status: sync\.status/);
    expect(root).toMatch(/oauthReturn && \(authStatus === "loading"/);
  });

  it("neither overlay covers the legal pages", () => {
    const hidden = root.match(/<div hidden=\{onLegalPage\}/g) ?? [];
    expect(hidden.length).toBeGreaterThanOrEqual(2);
  });
});
