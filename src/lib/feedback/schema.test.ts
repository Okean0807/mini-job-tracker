import { describe, expect, it } from "vitest";

import {
  FeedbackError,
  MAX_FEEDBACK_CHARS,
  feedbackSchema,
  parseFeedbackInput,
  readFeedbackError,
} from "./schema";

const base = {
  submissionId: "11111111-1111-4111-8111-111111111111",
  kind: "bug" as const,
  message: "Der Button reagiert nicht",
  appVersion: "1.0.0",
  lang: "de" as const,
  route: "/einstellungen",
};
const ok = (over: Record<string, unknown> = {}) => feedbackSchema.safeParse({ ...base, ...over });

describe("feedback schema: kinds and text", () => {
  it.each(["bug", "idea"])("%s needs a text of at least 3 characters", (kind) => {
    expect(ok({ kind }).success).toBe(true);
    expect(ok({ kind, message: "ab" }).success).toBe(false);
    expect(ok({ kind, message: "   " }).success).toBe(false);
    expect(ok({ kind, message: "  a  " }).success).toBe(false);
  });

  it("rating needs no text but a rating", () => {
    expect(ok({ kind: "rating", message: "", rating: 4 }).success).toBe(true);
    expect(ok({ kind: "rating", message: "gut", rating: 5 }).success).toBe(true);
    expect(ok({ kind: "rating", message: "" }).success).toBe(false);
  });

  it("accepts exactly 2000 characters and rejects 2001", () => {
    expect(ok({ message: "x".repeat(MAX_FEEDBACK_CHARS) }).success).toBe(true);
    expect(ok({ message: "x".repeat(MAX_FEEDBACK_CHARS + 1) }).success).toBe(false);
  });

  it("rejects unknown kinds", () => {
    expect(ok({ kind: "spam" }).success).toBe(false);
    expect(ok({ kind: "" }).success).toBe(false);
  });
});

describe("feedback schema: ratings", () => {
  it.each([1, 2, 3, 4, 5])("rating %i is valid for kind rating", (rating) => {
    expect(ok({ kind: "rating", message: "", rating }).success).toBe(true);
  });
  it.each([0, 6, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, "3", null])(
    "rating %s is invalid",
    (rating) => {
      expect(ok({ kind: "rating", message: "", rating }).success).toBe(false);
    },
  );
  it.each(["bug", "idea"])("a rating is not allowed for kind %s", (kind) => {
    expect(ok({ kind, rating: 3 }).success).toBe(false);
  });
});

describe("feedback schema: only minimal fields, nothing else", () => {
  it.each([
    ["shifts", [{ id: "s1" }]],
    ["jobs", []],
    ["data", { shifts: [] }],
    ["backup", "{}"],
    ["token", "abc"],
    ["userId", "u1"],
    ["email", "a@b.de"],
    ["website", ""],
    ["user_id", "00000000-0000-4000-8000-000000000000"],
  ])("rejects the extra field %s", (key, value) => {
    expect(ok({ [key]: value }).success).toBe(false);
  });

  it("route accepts a plain path only (no query, hash, uppercase or host)", () => {
    expect(ok({ route: "/" }).success).toBe(true);
    expect(ok({ route: "/einstellungen" }).success).toBe(true);
    for (const route of [
      "/a?x=1",
      "/a#b",
      "https://x.de/",
      "einstellungen",
      "/A",
      "/a b",
      "/" + "a".repeat(64),
    ]) {
      expect(ok({ route }).success, route).toBe(false);
    }
  });

  it("lang must be one of the five app languages; version a short token", () => {
    expect(ok({ lang: "fr" }).success).toBe(false);
    for (const lang of ["de", "en", "ru", "tr", "pl"]) expect(ok({ lang }).success).toBe(true);
    expect(ok({ appVersion: "1.0 beta" }).success).toBe(false);
    expect(ok({ appVersion: "x".repeat(33) }).success).toBe(false);
  });

  it("submissionId must be a UUID", () => {
    expect(ok({ submissionId: "nope" }).success).toBe(false);
  });
});

describe("parseFeedbackInput / error codes", () => {
  it("throws a FeedbackError('invalid') without leaking the input", () => {
    try {
      parseFeedbackInput({ ...base, message: "SECRET".repeat(1000) });
      throw new Error("should not parse");
    } catch (error) {
      expect(error).toBeInstanceOf(FeedbackError);
      expect((error as FeedbackError).code).toBe("invalid");
      expect((error as Error).message).not.toContain("SECRET");
    }
  });

  it("round-trips error codes through their message", () => {
    expect(readFeedbackError(new FeedbackError("rate_limited", 90))).toEqual({
      code: "rate_limited",
      retry: 90,
    });
    expect(readFeedbackError(new Error("Failed to fetch"))).toBeNull();
    expect(readFeedbackError("feedback:unavailable:0")).toEqual({ code: "unavailable", retry: 0 });
  });
});
