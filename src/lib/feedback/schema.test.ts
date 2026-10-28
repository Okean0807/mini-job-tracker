import { describe, expect, it } from "vitest";

import {
  FeedbackError,
  MAX_FEEDBACK_CHARS,
  cleanMessage,
  feedbackSchema,
  parseFeedbackInput,
  readFeedbackError,
} from "./schema";

const base = {
  submissionId: "11111111-1111-4111-8111-111111111111",
  message: "Der Button reagiert nicht",
  appVersion: "1.0.0",
  lang: "de" as const,
  route: "/einstellungen",
};
const ok = (over: Record<string, unknown> = {}) => feedbackSchema.safeParse({ ...base, ...over });

describe("message", () => {
  it("accepts 3..2000 characters", () => {
    expect(ok({ message: "abc" }).success).toBe(true);
    expect(ok({ message: "x".repeat(MAX_FEEDBACK_CHARS) }).success).toBe(true);
  });

  it.each(["", "  ", "ab", " a ", "\n\n\n", "\u0000\u0001\u0002\u0003"])(
    "rejects %j (too short after cleaning)",
    (message) => {
      expect(ok({ message }).success).toBe(false);
    },
  );

  it("rejects 2001 characters and non-strings", () => {
    expect(ok({ message: "x".repeat(MAX_FEEDBACK_CHARS + 1) }).success).toBe(false);
    for (const message of [undefined, null, 123, ["abc"], { a: 1 }])
      expect(ok({ message }).success).toBe(false);
  });

  it("cleanMessage removes control characters, keeps line breaks and tabs, normalises CRLF", () => {
    expect(cleanMessage("  a\r\nb\rc\td\u0000e\u0007f\u001bg\u007fh  ")).toBe("a\nb\nc\tdefgh");
  });
});

describe("only the allowed fields", () => {
  it.each([
    ["to", "evil@example.com"],
    ["recipient", "evil@example.com"],
    ["cc", "evil@example.com"],
    ["from", "evil@example.com"],
    ["subject", "x"],
    ["replyTo", "evil@example.com"],
    ["html", "<b>x</b>"],
    ["kind", "bug"],
    ["rating", 5],
    ["website", ""],
    ["userId", "u1"],
    ["shifts", [{ id: "s1" }]],
    ["token", "abc"],
  ])("rejects the extra field %s", (key, value) => {
    expect(ok({ [key]: value }).success).toBe(false);
  });

  it("route accepts a plain path only", () => {
    expect(ok({ route: "/" }).success).toBe(true);
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

  it("lang is one of the five app languages; version a short token; submissionId a UUID", () => {
    expect(ok({ lang: "fr" }).success).toBe(false);
    for (const lang of ["de", "en", "ru", "tr", "pl"]) expect(ok({ lang }).success).toBe(true);
    expect(ok({ appVersion: "1.0 beta" }).success).toBe(false);
    expect(ok({ appVersion: "x".repeat(33) }).success).toBe(false);
    expect(ok({ submissionId: "nope" }).success).toBe(false);
  });
});

describe("parseFeedbackInput / error codes", () => {
  it("throws FeedbackError('invalid') without leaking the input", () => {
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
    expect(readFeedbackError("feedback:forbidden:0")).toEqual({ code: "forbidden", retry: 0 });
  });
});
