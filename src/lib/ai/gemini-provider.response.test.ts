/**
 * Response validation, safety blocks, truncation and HTTP-error diagnostics of GeminiProvider
 * (mock fetch only; no network). Field names follow the Gemini API generateContent reference:
 * promptFeedback.blockReason, candidates[].finishReason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AI_FAILURE_CAUSES, AI_PROVIDER_STATUSES, AiGuardError } from "@/lib/ai-guard";

import {
  BLOCKED_RESPONSE_MESSAGE,
  EMPTY_RESPONSE_MESSAGE,
  GeminiProvider,
  PROVIDER_UNAVAILABLE_MESSAGE,
  INCOMPLETE_RESPONSE_MESSAGE,
  TRUNCATED_ANSWER_NOTE,
  GEMINI_MAX_OUTPUT_TOKENS,
  TRUNCATED_EMPTY_MESSAGE,
  mapHttpError,
  providerStatusFromBody,
} from "./gemini-provider";

const REQ = { question: "Wie viel habe ich verdient?", context: '{"currentDate":"2026-10-26"}' };

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(
    async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function failure(): Promise<AiGuardError> {
  try {
    await new GeminiProvider().ask(REQ);
  } catch (e) {
    return e as AiGuardError;
  }
  throw new Error("expected the request to fail");
}

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
  vi.stubEnv("GEMINI_MODEL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("empty or unusable 200 responses are failures, never answers", () => {
  it.each([
    ["empty object", {}],
    ["missing candidates", { usageMetadata: { totalTokenCount: 3 } }],
    ["empty candidates", { candidates: [] }],
    ["candidate without content", { candidates: [{}] }],
    ["content without parts", { candidates: [{ content: {} }] }],
    ["empty parts", { candidates: [{ content: { parts: [] } }] }],
    ["part without text", { candidates: [{ content: { parts: [{}] } }] }],
    ["non-string text", { candidates: [{ content: { parts: [{ text: 42 }] } }] }],
    ["empty text", { candidates: [{ content: { parts: [{ text: "" }] } }] }],
    ["whitespace-only text", { candidates: [{ content: { parts: [{ text: " \n\t " }] } }] }],
    [
      "whitespace across parts",
      { candidates: [{ content: { parts: [{ text: " " }, { text: "\n" }] } }] },
    ],
  ])("%s → provider_empty, no answer, single request", async (_n, body) => {
    const fetchMock = mockFetch(200, body);
    const err = await failure();
    expect(err).toBeInstanceOf(AiGuardError);
    expect(err.code).toBe("unavailable");
    expect(err.message).toBe(EMPTY_RESPONSE_MESSAGE);
    expect(err.message).not.toContain("Keine Antwort erhalten");
    expect(err.diag).toEqual({ cause: "provider_empty", httpStatus: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an empty response that carries a provider error status keeps only the allowlisted status", async () => {
    mockFetch(200, { error: { status: "UNAVAILABLE", message: "SECRET-TEXT" } });
    const err = await failure();
    expect(err.diag).toEqual({
      cause: "provider_empty",
      httpStatus: 200,
      providerStatus: "UNAVAILABLE",
    });
    expect(JSON.stringify(err)).not.toContain("SECRET-TEXT");
    expect(err.message).not.toContain("SECRET-TEXT");
  });
});

describe("malformed or unexpected 200 responses", () => {
  it.each([
    ["not JSON", "<html>oops</html>"],
    ["JSON null", "null"],
    ["JSON array", "[]"],
    ["JSON string", '"text"'],
    ["candidates is not an array", { candidates: { content: { parts: [{ text: "x" }] } } }],
    ["parts is not an array", { candidates: [{ content: { parts: "text" } }] }],
  ])("%s → provider_parse_error, generic safe message", async (_n, body) => {
    mockFetch(200, body);
    const err = await failure();
    expect(err.code).toBe("unavailable");
    expect(err.message).toBe("Die KI konnte nicht antworten.");
    expect(err.diag).toEqual({ cause: "provider_parse_error", httpStatus: 200 });
  });
});

describe("legitimate responses are unchanged", () => {
  it("STOP response", async () => {
    mockFetch(200, {
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "  Antwort  " }] } }],
    });
    await expect(new GeminiProvider().ask(REQ)).resolves.toEqual({ answer: "Antwort" });
  });

  it("response without finishReason", async () => {
    mockFetch(200, { candidates: [{ content: { parts: [{ text: "Antwort" }] } }] });
    await expect(new GeminiProvider().ask(REQ)).resolves.toEqual({ answer: "Antwort" });
  });

  it("multiple text parts are joined; non-text parts are ignored; grounding metadata is ignored", async () => {
    mockFetch(200, {
      candidates: [
        {
          content: {
            parts: [{ text: "Teil 1 " }, { functionCall: { name: "x" } }, { text: "Teil 2" }],
          },
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://example.org", title: "x" } }],
          },
        },
      ],
    });
    await expect(new GeminiProvider().ask(REQ)).resolves.toEqual({ answer: "Teil 1 Teil 2" });
  });
});

describe("HTTP errors carry normalised diagnostics and unchanged safe messages", () => {
  const cases: Array<[string, number, unknown, string, string | undefined, string]> = [
    // label, status, body, cause, providerStatus, expected user message fragment
    [
      "400 invalid key",
      400,
      { error: { status: "INVALID_ARGUMENT", message: "API key not valid" } },
      "provider_auth",
      "INVALID_ARGUMENT",
      PROVIDER_UNAVAILABLE_MESSAGE,
    ],
    [
      "400 bare INVALID_ARGUMENT",
      400,
      { error: { status: "INVALID_ARGUMENT", message: "Unknown field" } },
      "provider_bad_request",
      "INVALID_ARGUMENT",
      "Die KI konnte nicht antworten.",
    ],
    [
      "400 quota",
      400,
      { error: { status: "RESOURCE_EXHAUSTED", message: "quota" } },
      "provider_quota",
      "RESOURCE_EXHAUSTED",
      "Kontingent aufgebraucht",
    ],
    [
      "401",
      401,
      { error: { status: "UNAUTHENTICATED", message: "x" } },
      "provider_auth",
      "UNAUTHENTICATED",
      PROVIDER_UNAVAILABLE_MESSAGE,
    ],
    [
      "403 quota",
      403,
      { error: { status: "PERMISSION_DENIED", message: "quota exceeded" } },
      "provider_quota",
      "PERMISSION_DENIED",
      "Kontingent",
    ],
    [
      "403 forbidden",
      403,
      { error: { status: "PERMISSION_DENIED", message: "forbidden" } },
      "provider_forbidden",
      "PERMISSION_DENIED",
      "KI-Zugriff derzeit nicht möglich",
    ],
    [
      "404",
      404,
      { error: { status: "NOT_FOUND", message: "model" } },
      "provider_model_not_found",
      "NOT_FOUND",
      "nicht erreichbar",
    ],
    [
      "429",
      429,
      { error: { status: "RESOURCE_EXHAUSTED", message: "q" } },
      "provider_rate_limited",
      "RESOURCE_EXHAUSTED",
      "Zu viele Anfragen",
    ],
    [
      "500",
      500,
      { error: { status: "INTERNAL", message: "boom" } },
      "provider_server_error",
      "INTERNAL",
      "Die KI konnte nicht antworten.",
    ],
    [
      "502 html",
      502,
      "<html>Bad gateway</html>",
      "provider_server_error",
      undefined,
      "Die KI konnte nicht antworten.",
    ],
    [
      "503",
      503,
      { error: { status: "UNAVAILABLE", message: "busy" } },
      "provider_server_error",
      "UNAVAILABLE",
      "Die KI konnte nicht antworten.",
    ],
    [
      "418 other client error",
      418,
      "teapot",
      "provider_http_error",
      undefined,
      "Die KI konnte nicht antworten.",
    ],
    [
      "unknown provider status token",
      500,
      { error: { status: "SOMETHING_NEW", message: "x" } },
      "provider_server_error",
      "OTHER",
      "Die KI konnte nicht antworten.",
    ],
  ];

  it.each(cases)("%s", async (_label, status, body, cause, providerStatus, messagePart) => {
    const fetchMock = mockFetch(status, body);
    const err = await failure();
    expect(err.message).toContain(messagePart);
    expect(err.message).not.toMatch(/\b[1-5]\d\d\b|INVALID_ARGUMENT|UNAUTHENTICATED|API key/);
    expect(err.diag).toEqual({
      cause,
      httpStatus: status,
      ...(providerStatus ? { providerStatus } : {}),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the three authentication-like provider failures never claim a login problem", () => {
    for (const [status, body] of [
      [401, ""],
      [400, '{"error":{"message":"API key not valid"}}'],
    ] as const) {
      expect(mapHttpError(status, body).message).not.toMatch(/Sitzung|anmelden|Anmeldung/i);
    }
  });

  it("every cause/status value produced is inside the closed allowlists", () => {
    for (const [, status, body] of cases) {
      const diag = mapHttpError(
        status,
        typeof body === "string" ? body : JSON.stringify(body),
      ).diag!;
      expect(AI_FAILURE_CAUSES).toContain(diag.cause);
      if (diag.providerStatus) expect(AI_PROVIDER_STATUSES).toContain(diag.providerStatus);
    }
  });

  it("providerStatusFromBody never returns text from the body", () => {
    expect(providerStatusFromBody('{"error":{"status":"NOT_FOUND"}}')).toBe("NOT_FOUND");
    expect(providerStatusFromBody('{"error":{"status":"api key SECRET"}}')).toBe("OTHER");
    expect(providerStatusFromBody("not json")).toBeUndefined();
    expect(providerStatusFromBody('{"error":{"status":5}}')).toBeUndefined();
    expect(providerStatusFromBody("{}")).toBeUndefined();
  });
});

describe("transport failures", () => {
  it("non-abort fetch failure → provider_network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed: SECRET-HOST");
      }),
    );
    const err = await failure();
    expect(err.message).toBe("Die KI konnte nicht antworten.");
    expect(err.diag).toEqual({ cause: "provider_network" });
    expect(JSON.stringify(err)).not.toContain("SECRET-HOST");
  });

  it.each(["TimeoutError", "AbortError"])("%s → provider_timeout", async (name) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("x", name);
      }),
    );
    const err = await failure();
    expect(err.diag).toEqual({ cause: "provider_timeout" });
  });

  it("missing API key → no_api_key and no request", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetchMock = mockFetch(200, {});
    const err = await failure();
    expect(err.message).toBe("KI ist derzeit nicht verfügbar.");
    expect(err.diag).toEqual({ cause: "no_api_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const withReason = (finishReason: string | undefined, text: string | undefined) => ({
  candidates: [
    {
      ...(finishReason !== undefined ? { finishReason } : {}),
      ...(text !== undefined ? { content: { parts: [{ text }] } } : {}),
    },
  ],
});

describe("blocked responses are failures (promptFeedback.blockReason, finishReason)", () => {
  it.each(["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "OTHER", "IMAGE_SAFETY"])(
    "prompt blocked with blockReason %s → provider_blocked, reason never shown",
    async (blockReason) => {
      const fetchMock = mockFetch(200, {
        promptFeedback: { blockReason, safetyRatings: [{ category: "X", probability: "HIGH" }] },
      });
      const err = await failure();
      expect(err.code).toBe("unavailable");
      expect(err.message).toBe(BLOCKED_RESPONSE_MESSAGE);
      expect(err.message).not.toContain(blockReason);
      expect(err.diag).toEqual({ cause: "provider_blocked", httpStatus: 200 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("a prompt block wins even if a candidate with text is present", async () => {
    mockFetch(200, { promptFeedback: { blockReason: "SAFETY" }, ...withReason("STOP", "Text") });
    expect((await failure()).diag?.cause).toBe("provider_blocked");
  });

  it("BLOCK_REASON_UNSPECIFIED and an empty blockReason are not blocks", async () => {
    for (const blockReason of ["BLOCK_REASON_UNSPECIFIED", ""]) {
      mockFetch(200, { promptFeedback: { blockReason }, ...withReason("STOP", "Antwort") });
      await expect(new GeminiProvider().ask(REQ)).resolves.toEqual({ answer: "Antwort" });
    }
  });

  it.each([
    "SAFETY",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "SPII",
    "IMAGE_SAFETY",
    "IMAGE_PROHIBITED_CONTENT",
    "RECITATION",
    "LANGUAGE",
  ])("finishReason %s → provider_blocked, with or without partial text", async (reason) => {
    for (const text of [undefined, "Teilantwort, die nicht angezeigt werden darf"]) {
      mockFetch(200, {
        ...withReason(reason, text),
        candidates: [
          {
            finishReason: reason,
            finishMessage: "SECRET-FINISH-MESSAGE",
            ...(text ? { content: { parts: [{ text }] } } : {}),
          },
        ],
      });
      const err = await failure();
      expect(err.message).toBe(BLOCKED_RESPONSE_MESSAGE);
      expect(err.message).not.toContain(reason);
      expect(JSON.stringify(err)).not.toContain("SECRET-FINISH-MESSAGE");
      expect(JSON.stringify(err)).not.toContain("Teilantwort");
      expect(err.diag).toEqual({ cause: "provider_blocked", httpStatus: 200 });
    }
  });
});

describe("finishReason OTHER fails closed without guessing a cause", () => {
  it.each([undefined, "Teilantwort, die nicht angezeigt werden darf"])(
    "text %j → neutral incomplete-answer error, own diagnostic cause, text never shown",
    async (text) => {
      mockFetch(200, {
        candidates: [
          {
            finishReason: "OTHER",
            finishMessage: "SECRET-FINISH-MESSAGE",
            ...(text ? { content: { parts: [{ text }] } } : {}),
          },
        ],
      });
      const err = await failure();
      expect(err.code).toBe("unavailable");
      expect(err.message).toBe(INCOMPLETE_RESPONSE_MESSAGE);
      expect(err.message).not.toMatch(/OTHER|blockiert|Sicherheit/i);
      expect(JSON.stringify(err)).not.toContain("SECRET-FINISH-MESSAGE");
      expect(JSON.stringify(err)).not.toContain("Teilantwort");
      expect(err.diag).toEqual({ cause: "provider_other_finish", httpStatus: 200 });
    },
  );

  it("promptFeedback.blockReason OTHER is still a documented prompt block", async () => {
    mockFetch(200, { promptFeedback: { blockReason: "OTHER" } });
    const err = await failure();
    expect(err.message).toBe(BLOCKED_RESPONSE_MESSAGE);
    expect(err.diag).toEqual({ cause: "provider_blocked", httpStatus: 200 });
  });
});

describe("MAX_TOKENS is never presented as a complete answer", () => {
  it("with text: text is kept and the warning comes first", async () => {
    mockFetch(200, withReason("MAX_TOKENS", "Du hast im Oktober"));
    const result = await new GeminiProvider().ask(REQ);
    expect(result).toEqual({
      answer: `${TRUNCATED_ANSWER_NOTE}\n\nDu hast im Oktober`,
      degraded: "truncated",
    });
    expect(result.answer).toMatch(/unvollständig/);
  });

  it.each([undefined, "", "   \n"])(
    "without usable text (%j) → provider_truncated error",
    async (text) => {
      mockFetch(200, withReason("MAX_TOKENS", text));
      const err = await failure();
      expect(err.message).toBe(TRUNCATED_EMPTY_MESSAGE);
      expect(err.diag).toEqual({ cause: "provider_truncated", httpStatus: 200 });
    },
  );

  it("sends exactly one request: no automatic retry and no raised token limit", async () => {
    const fetchMock = mockFetch(200, withReason("MAX_TOKENS", "Teil"));
    await new GeminiProvider().ask(REQ);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    // The configured cap is sent unchanged: a truncated answer is never retried with a higher limit.
    expect(body.generationConfig.maxOutputTokens).toBe(GEMINI_MAX_OUTPUT_TOKENS);
    expect(JSON.stringify(body).match(/maxOutputTokens/g)).toHaveLength(1);
  });
});

describe("normal, absent and unknown finish reasons", () => {
  it.each(["STOP", undefined])("%s → plain answer, no marker", async (reason) => {
    mockFetch(200, withReason(reason, "Antwort"));
    const result = await new GeminiProvider().ask(REQ);
    expect(result).toEqual({ answer: "Antwort" });
    expect(result).not.toHaveProperty("degraded");
  });

  it.each([
    "CONTINUATION",
    "MALFORMED_FUNCTION_CALL",
    "FINISH_REASON_UNSPECIFIED",
    "SOMETHING_NEW",
    "IMAGE_RECITATION",
  ])(
    "unlisted value %s with text → text unchanged, flagged unexpected_finish (value never exposed)",
    async (reason) => {
      mockFetch(200, withReason(reason, "Antwort"));
      const result = await new GeminiProvider().ask(REQ);
      expect(result).toEqual({ answer: "Antwort", degraded: "unexpected_finish" });
      expect(JSON.stringify(result)).not.toContain(reason);
    },
  );

  it("unlisted value without text → provider_empty error", async () => {
    mockFetch(200, withReason("SOMETHING_NEW", undefined));
    expect((await failure()).diag).toEqual({ cause: "provider_empty", httpStatus: 200 });
  });

  it("a non-string finishReason is treated as absent", async () => {
    mockFetch(200, {
      candidates: [{ finishReason: 4, content: { parts: [{ text: "Antwort" }] } }],
    });
    await expect(new GeminiProvider().ask(REQ)).resolves.toEqual({ answer: "Antwort" });
  });
});
