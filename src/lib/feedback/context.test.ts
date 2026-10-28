import { describe, expect, it } from "vitest";

import { feedbackContext } from "./context";
import { feedbackSchema } from "./schema";

describe("feedbackContext", () => {
  it("keeps only a clean path, version and a known language", () => {
    expect(feedbackContext("/Einstellungen", "1.0.0", "ru")).toEqual({
      route: "/einstellungen",
      appVersion: "1.0.0",
      lang: "ru",
    });
  });
  it("falls back safely", () => {
    expect(feedbackContext("", undefined, "xx")).toEqual({
      route: "/",
      appVersion: "unknown",
      lang: "de",
    });
    expect(feedbackContext("/a b/ü?x=1#h", "v 1!", "fr").route).toMatch(/^\/[a-z0-9_\-/]*$/);
  });
  it("always satisfies the schema", () => {
    for (const p of ["/", "/x/y", "/" + "a".repeat(200), "///", "/ä"]) {
      const c = feedbackContext(p, "1.2", "de");
      expect(
        feedbackSchema.safeParse({
          submissionId: "11111111-1111-4111-8111-111111111111",
          kind: "rating",
          message: "",
          rating: 5,
          ...c,
        }).success,
        p,
      ).toBe(true);
    }
  });
});
