import { describe, expect, it } from "vitest";

import { isAiFeatureEnabled } from "./feature-flag";
import { isNavItemAvailable, resolveAiAvailability } from "./availability";

describe('isAiFeatureEnabled — only the exact string "true" enables', () => {
  it('enables for "true"', () => {
    expect(isAiFeatureEnabled({ AI_FEATURES_ENABLED: "true" })).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", "True", "1", "yes", " true", "true "])(
    "disables for %j",
    (value) => {
      expect(isAiFeatureEnabled({ AI_FEATURES_ENABLED: value })).toBe(false);
    },
  );

  it("disables when the variable is absent", () => {
    expect(isAiFeatureEnabled({})).toBe(false);
  });
});

describe("client availability — unknown means unavailable", () => {
  it("only an explicit { enabled: true } enables", () => {
    expect(resolveAiAvailability({ enabled: true })).toBe("enabled");
  });

  it.each([
    undefined,
    null,
    {},
    { enabled: false },
    { enabled: "true" },
    { enabled: 1 },
    "true",
    [],
  ])("treats %j as disabled", (value) => {
    expect(resolveAiAvailability(value)).toBe("disabled");
  });

  it("hides the /assistent nav entry unless enabled; other entries are unaffected", () => {
    expect(isNavItemAvailable("/assistent", "loading")).toBe(false);
    expect(isNavItemAvailable("/assistent", "disabled")).toBe(false);
    expect(isNavItemAvailable("/assistent", "enabled")).toBe(true);
    for (const to of ["/", "/statistik", "/jobs", "/dokumente", "/einstellungen"]) {
      for (const a of ["loading", "disabled", "enabled"] as const) {
        expect(isNavItemAvailable(to, a)).toBe(true);
      }
    }
  });
});
