/**
 * v1.0 „vorübergehend kostenlos“ (R5b): Alle Funktionen für alle Nutzer.
 * premium.ts bleibt der einzige Erweiterungspunkt für spätere Pläne.
 */
import { describe, expect, it } from "vitest";

import { ALL_FEATURES_FREE, canAddJob, canUse, type PremiumFeature } from "./premium";

const FEATURES: PremiumFeature[] = [
  "multiJob",
  "ai",
  "cloud",
  "excel",
  "advancedReports",
  "forecast",
];

describe("premium entitlement (v1.0 free)", () => {
  it("v1.0 resolves to all features free", () => {
    expect(ALL_FEATURES_FREE).toBe(true);
  });

  it.each([{}, { premium: false }, { premium: true }])(
    "canUse is true for every feature (%o)",
    (settings) => {
      for (const f of FEATURES) expect(canUse(settings, f)).toBe(true);
    },
  );

  it.each([0, 1, 2, 5, 50])("canAddJob is true without premium for %i existing jobs", (n) => {
    expect(canAddJob({}, n)).toBe(true);
    expect(canAddJob({ premium: false }, n)).toBe(true);
  });
});
