import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
    // Google button must not appear in the signed_in branch: between signed_in and google
    // there should be the ternary else with oauth buttons.
    const slice = src.slice(signedInAt, googleAt);
    expect(slice).toMatch(/signedInAs/);
  });

  it("does not force Google buttons when session exists (signed_in branch has no oauth call)", () => {
    // Extract cloud step card body roughly
    const stepStart = src.indexOf("{step === 5 ? (");
    const stepEnd = src.indexOf("{step === 6 ? (", stepStart);
    const cloud = src.slice(stepStart, stepEnd);
    expect(cloud).toMatch(/authStatus === "signed_in"/);
    expect(cloud).toMatch(/authStatus === "loading"/);
    // oauth("google") only in else / oauth function — signed_in shows email
    const signedInBlock = cloud.split('authStatus === "signed_in"')[1]?.split(": (")[0] ?? "";
    expect(signedInBlock).toMatch(/signedInAs/);
    expect(signedInBlock).not.toMatch(/oauth\("google"\)/);
  });
});
