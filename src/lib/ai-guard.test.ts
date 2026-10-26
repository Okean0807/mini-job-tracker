import { beforeEach, describe, expect, it } from "vitest";

import { aiClientErrorMessage } from "./ai-client-error";
import {
  AiGuardError,
  MAX_CONTEXT_CHARS,
  MAX_QUESTION_CHARS,
  PAYLOAD_TOO_LARGE_MESSAGE,
  QUESTION_TOO_LONG_MESSAGE,
  RATE_LIMIT_PER_HOUR,
  RATE_LIMIT_PER_MINUTE,
  assertRateLimit,
  parseAskAssistantInput,
  rateLimitStatus,
  resetRateLimits,
} from "./ai-guard";

const ok = { question: "Wie viele Stunden?", context: '{"jahr":2026}', language: "Deutsch" };

describe("ai-guard payload validation", () => {
  it("accepts a normal request", () => {
    expect(parseAskAssistantInput(ok)).toEqual(ok);
  });

  it("rejects invalid payloads without leaking details", () => {
    for (const bad of [null, {}, { question: "", context: "x" }, { question: 5, context: "x" }]) {
      try {
        parseAskAssistantInput(bad);
        throw new Error("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AiGuardError);
        expect((error as AiGuardError).code).toBe("invalid_payload");
        expect((error as AiGuardError).message).toBe("Ungültige Anfrage.");
      }
    }
  });

  const codeOf = (bad: unknown) => {
    try {
      parseAskAssistantInput(bad);
    } catch (error) {
      return { code: (error as AiGuardError).code, message: (error as AiGuardError).message };
    }
    throw new Error("should have thrown");
  };

  it("oversized context -> payload_too_large (not a generic invalid payload)", () => {
    const bad = { question: "Frage", context: "x".repeat(MAX_CONTEXT_CHARS + 1) };
    expect(codeOf(bad)).toEqual({ code: "payload_too_large", message: PAYLOAD_TOO_LARGE_MESSAGE });
  });

  it("over-long question -> payload_too_large with a fixable hint", () => {
    const bad = { question: "x".repeat(MAX_QUESTION_CHARS + 1), context: "{}" };
    expect(codeOf(bad)).toEqual({ code: "payload_too_large", message: QUESTION_TOO_LONG_MESSAGE });
    expect(QUESTION_TOO_LONG_MESSAGE).toContain(String(MAX_QUESTION_CHARS));
  });

  it("size + type errors together stay invalid_payload (no partial classification)", () => {
    const bad = { question: 5, context: "x".repeat(MAX_CONTEXT_CHARS + 1) };
    expect(codeOf(bad).code).toBe("invalid_payload");
    expect(codeOf({ question: "", context: "{}" }).code).toBe("invalid_payload");
  });

  it("size messages carry no input, schema or internal details", () => {
    const secretish = "GEMINI_API_KEY=sk-123 " + "x".repeat(MAX_CONTEXT_CHARS);
    const { message } = codeOf({ question: "Frage", context: secretish });
    expect(message).not.toMatch(/GEMINI|sk-|too_big|zod|context|question/i);
  });

  it("the client shows these messages unchanged (not replaced by a generic error)", () => {
    for (const msg of [
      PAYLOAD_TOO_LARGE_MESSAGE,
      QUESTION_TOO_LONG_MESSAGE,
      "Ungültige Anfrage.",
    ]) {
      expect(aiClientErrorMessage(new Error(msg), "fallback")).toBe(msg);
    }
  });

  it("rejects an oversized total payload budget", () => {
    const bad = {
      question: "x".repeat(2000),
      context: "y".repeat(MAX_CONTEXT_CHARS),
      language: "d".repeat(50),
    };

    try {
      parseAskAssistantInput(bad);
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as AiGuardError).code).toBe("payload_too_large");
      expect((error as AiGuardError).message).toBe(PAYLOAD_TOO_LARGE_MESSAGE);
    }
  });
});

describe("ai-guard per-user rate limit", () => {
  beforeEach(() => resetRateLimits());

  it("allows requests within the burst window", () => {
    const now = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      expect(rateLimitStatus("user-a", now + i).allowed).toBe(true);
    }
  });

  it("blocks the next request after the per-minute limit", () => {
    const now = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) rateLimitStatus("user-a", now + i);
    const blocked = rateLimitStatus("user-a", now + 100);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(() => assertRateLimit("user-a", now + 100)).toThrowError(AiGuardError);
  });

  it("isolates counters per user", () => {
    const now = 2_000_000;
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) rateLimitStatus("user-a", now + i);
    expect(rateLimitStatus("user-b", now).allowed).toBe(true);
  });

  it("recovers after the minute window passes", () => {
    const now = 3_000_000;
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) rateLimitStatus("user-a", now + i);
    expect(rateLimitStatus("user-a", now + 61_000).allowed).toBe(true);
  });

  it("enforces the hourly cap across spread-out requests", () => {
    let now = 4_000_000;
    let allowed = 0;
    for (let i = 0; i < RATE_LIMIT_PER_HOUR + 10; i++) {
      if (rateLimitStatus("user-c", now).allowed) allowed++;
      now += 30_000; // 2 requests per minute → burst limit never hit
    }
    expect(allowed).toBe(RATE_LIMIT_PER_HOUR);
  });
});
