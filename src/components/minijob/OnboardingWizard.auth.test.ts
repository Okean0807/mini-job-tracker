import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { WIZARD_STEP_INDEX } from "@/lib/minijob/wizard-flow";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "OnboardingWizard.tsx"),
  "utf8",
);

describe("OnboardingWizard Cloud step auth", () => {
  it("uses useAuthSession and recognizes signed_in", () => {
    expect(src).toMatch(/useAuthSession/);
    expect(src).toMatch(/authStatus === "signed_in"/);
    expect(src).toMatch(/set\.account\.cloud\.signedInAs/);
  });

  it("keeps OAuth + draft checkpoint only on signed_out path", () => {
    expect(src).toMatch(/checkpointOnboardingBeforeOAuth/);
    const signedInAt = src.indexOf('authStatus === "signed_in"');
    const googleAt = src.indexOf('t("wiz.cloud.google")');
    expect(signedInAt).toBeGreaterThan(-1);
    expect(googleAt).toBeGreaterThan(signedInAt);
    const slice = src.slice(signedInAt, googleAt);
    expect(slice).toMatch(/signedInAs/);
  });

  it("does not force Google buttons when session exists (signed_in branch has no oauth call)", () => {
    const stepStart = src.indexOf(`step === WIZARD_STEP_INDEX.cloud`);
    const stepEnd = src.indexOf(`step === WIZARD_STEP_INDEX.workMode`, stepStart);
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const cloud = src.slice(stepStart, stepEnd);
    expect(cloud).toMatch(/authStatus === "signed_in"/);
    expect(cloud).toMatch(/authStatus === "loading"/);
    const signedInBlock = cloud.split('authStatus === "signed_in"')[1]?.split(": (")[0] ?? "";
    expect(signedInBlock).toMatch(/signedInAs/);
    expect(signedInBlock).not.toMatch(/oauth\(/);
  });

  it("exposes Google only (no Apple Sign-In button)", () => {
    expect(src).toMatch(/wiz\.cloud\.google/);
    expect(src).not.toMatch(/oauth\("apple"\)/);
    expect(src).not.toMatch(/wiz\.cloud\.apple/);
  });

  it("requires Google before leaving the cloud step", () => {
    expect(src).toMatch(/WIZARD_STEP_INDEX\.cloud/);
    expect(src).toMatch(/wiz\.cloud\.required/);
    expect(WIZARD_STEP_INDEX.cloud).toBe(1);
  });
});
