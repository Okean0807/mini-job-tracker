/** Structured failure diagnostics of runAskAssistant: allowlisted fields, one event per failure, no secrets. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => {
  const builder: Record<string, unknown> = {};
  builder["middleware"] = () => builder;
  builder["inputValidator"] = () => builder;
  builder["handler"] = (fn: unknown) => fn;
  return { createServerFn: () => builder };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import { ASK_GATEWAY_TIMEOUT_MESSAGE } from "@/lib/ai-ask";
import { AI_FAILURE_CAUSES, AiGuardError } from "@/lib/ai-guard";
import { GeminiProvider } from "@/lib/ai/gemini-provider";

import { type AskRateLimitClient, runAskAssistant } from "./ai.functions";

const SENTINELS = {
  key: "SECRET-API-KEY-111",
  body: "SECRET-BODY-222",
  question: "SECRET-QUESTION-333",
  user: "SECRET-USER-ID-444",
};
const ALLOWED_FIELDS = [
  "event",
  "stage",
  "outcome",
  "cause",
  "httpStatus",
  "providerStatus",
  "elapsedMs",
];
const DATA = {
  question: `Wie viel? ${SENTINELS.question}`,
  context: '{"currentDate":"2026-10-26"}',
  language: "Deutsch",
};
const rpcOk: AskRateLimitClient = {
  rpc: () => ({
    abortSignal: async () => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }),
  }),
};

async function run(
  opts: { rpc?: AskRateLimitClient; log?: (l: string) => void; deadline?: AbortSignal } = {},
) {
  const lines: string[] = [];
  const deps: Parameters<typeof runAskAssistant>[2] = {
    createProvider: () => new GeminiProvider(),
    log: opts.log ?? ((l) => lines.push(l)),
  };
  if (opts.deadline) deps.createDeadline = () => opts.deadline as AbortSignal;
  try {
    const result = await runAskAssistant(
      DATA,
      { supabase: opts.rpc ?? rpcOk, userId: SENTINELS.user },
      deps,
    );
    return { result, lines };
  } catch (error) {
    return { error: error as Error, lines };
  }
}
const stubResponse = (status: number, body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
    ),
  );

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", SENTINELS.key);
  vi.stubEnv("GEMINI_MODEL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function expectSafe(lines: string[]) {
  expect(lines).toHaveLength(1);
  const parsed = JSON.parse(lines[0]!);
  for (const key of Object.keys(parsed)) expect(ALLOWED_FIELDS).toContain(key);
  for (const secret of Object.values(SENTINELS)) expect(lines[0]).not.toContain(secret);
  expect(typeof parsed.elapsedMs).toBe("number");
  return parsed as Record<string, unknown>;
}

describe("one sanitised event per failed ask", () => {
  it.each([
    [
      400,
      { error: { status: "INVALID_ARGUMENT", message: `API key not valid ${SENTINELS.body}` } },
      "provider_auth",
      "INVALID_ARGUMENT",
    ],
    [
      401,
      { error: { status: "UNAUTHENTICATED", message: SENTINELS.body } },
      "provider_auth",
      "UNAUTHENTICATED",
    ],
    [
      403,
      { error: { status: "PERMISSION_DENIED", message: `forbidden ${SENTINELS.body}` } },
      "provider_forbidden",
      "PERMISSION_DENIED",
    ],
    [
      404,
      { error: { status: "NOT_FOUND", message: SENTINELS.body } },
      "provider_model_not_found",
      "NOT_FOUND",
    ],
    [
      429,
      { error: { status: "RESOURCE_EXHAUSTED", message: SENTINELS.body } },
      "provider_rate_limited",
      "RESOURCE_EXHAUSTED",
    ],
    [
      500,
      { error: { status: "INTERNAL", message: SENTINELS.body } },
      "provider_server_error",
      "INTERNAL",
    ],
    [502, `<html>${SENTINELS.body}</html>`, "provider_server_error", undefined],
    [
      503,
      { error: { status: "UNAVAILABLE", message: SENTINELS.body } },
      "provider_server_error",
      "UNAVAILABLE",
    ],
  ])("HTTP %i → cause %s", async (status, body, cause, providerStatus) => {
    stubResponse(status, body);
    const { error, lines } = await run();
    expect(error).toBeInstanceOf(AiGuardError);
    expect(error!.message).not.toContain(SENTINELS.body);
    const event = expectSafe(lines);
    expect(event).toMatchObject({
      event: "ai.ask.failed",
      stage: "provider",
      cause,
      httpStatus: status,
    });
    if (providerStatus) expect(event["providerStatus"]).toBe(providerStatus);
    else expect(event).not.toHaveProperty("providerStatus");
  });

  it("empty 200 response → provider_empty", async () => {
    stubResponse(200, { candidates: [{ content: { parts: [{ text: "  " }] } }] });
    const { error, lines } = await run();
    expect((error as AiGuardError).message).not.toContain("Keine Antwort erhalten");
    expect(expectSafe(lines)).toMatchObject({
      stage: "provider",
      cause: "provider_empty",
      httpStatus: 200,
    });
  });

  it("malformed 200 JSON → provider_parse_error", async () => {
    stubResponse(200, `not json ${SENTINELS.body}`);
    const { lines } = await run();
    expect(expectSafe(lines)).toMatchObject({ cause: "provider_parse_error", httpStatus: 200 });
  });

  it("network failure → provider_network, no httpStatus", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError(`fetch failed ${SENTINELS.body}`);
      }),
    );
    const { lines } = await run();
    const event = expectSafe(lines);
    expect(event).toMatchObject({ cause: "provider_network" });
    expect(event).not.toHaveProperty("httpStatus");
  });

  it("provider timeout → outcome timeout, cause provider_timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("x", "TimeoutError");
      }),
    );
    const { error, lines } = await run();
    expect(error!.message).toBe(ASK_GATEWAY_TIMEOUT_MESSAGE);
    expect(expectSafe(lines)).toMatchObject({
      stage: "provider",
      outcome: "timeout",
      cause: "provider_timeout",
    });
  });

  it("missing API key → no_api_key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    stubResponse(200, {});
    const { lines } = await run();
    expect(expectSafe(lines)).toMatchObject({ cause: "no_api_key" });
  });

  it("rate-limit RPC error → rate_limit_rpc_error; RPC timeout → rate_limit_timeout", async () => {
    stubResponse(200, {});
    const rpcError: AskRateLimitClient = {
      rpc: () => ({
        abortSignal: async () => ({ data: null, error: { message: SENTINELS.body } }),
      }),
    };
    expect(expectSafe((await run({ rpc: rpcError })).lines)).toMatchObject({
      stage: "rate_limit",
      outcome: "rpc_error",
      cause: "rate_limit_rpc_error",
    });

    const ctl = new AbortController();
    ctl.abort();
    expect(expectSafe((await run({ rpc: rpcError, deadline: ctl.signal })).lines)).toMatchObject({
      stage: "rate_limit",
      outcome: "timeout",
      cause: "rate_limit_timeout",
    });
  });

  it("a duck-typed diag with unknown values is reduced to the allowlist", async () => {
    const provider = {
      ask: async () => {
        throw Object.assign(new AiGuardError("unavailable", "Die KI konnte nicht antworten."), {
          diag: {
            cause: "SECRET-CAUSE",
            httpStatus: 12345,
            providerStatus: SENTINELS.body,
            extra: SENTINELS.key,
          },
        });
      },
    };
    const lines: string[] = [];
    await runAskAssistant(
      DATA,
      { supabase: rpcOk, userId: SENTINELS.user },
      {
        createProvider: () => provider,
        log: (l) => lines.push(l),
      },
    ).catch(() => {});
    const event = expectSafe(lines);
    expect(event).not.toHaveProperty("cause");
    expect(event).not.toHaveProperty("httpStatus");
    expect(event).not.toHaveProperty("providerStatus");
  });
});

describe("no event when nothing failed, and logger failures never mask the error", () => {
  it("successful ask and rate-limit denial log nothing", async () => {
    stubResponse(200, { candidates: [{ content: { parts: [{ text: "Antwort" }] } }] });
    const ok = await run();
    expect(ok.result).toEqual({ answer: "Antwort" });
    expect(ok.lines).toEqual([]);

    const denied: AskRateLimitClient = {
      rpc: () => ({
        abortSignal: async () => ({
          data: [{ allowed: false, retry_after_seconds: 5 }],
          error: null,
        }),
      }),
    };
    const { error, lines } = await run({ rpc: denied });
    expect((error as AiGuardError).code).toBe("rate_limited");
    expect(lines).toEqual([]);
  });

  it("a throwing logger keeps the original, specific error", async () => {
    stubResponse(403, { error: { status: "PERMISSION_DENIED", message: "quota" } });
    const { error } = await run({
      log: () => {
        throw new Error("logger down");
      },
    });
    expect(error).toBeInstanceOf(AiGuardError);
    expect(error!.message).toMatch(/Kontingent/);
  });

  it("the default logger is a single console.warn call with the same safe line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubResponse(401, { error: { status: "UNAUTHENTICATED", message: SENTINELS.body } });
    await runAskAssistant(
      DATA,
      { supabase: rpcOk, userId: SENTINELS.user },
      {
        createProvider: () => new GeminiProvider(),
      },
    ).catch(() => {});
    expect(warn).toHaveBeenCalledTimes(1);
    expectSafe([String(warn.mock.calls[0]![0])]);
  });
});

describe("blocked, truncated and unexpected-finish responses", () => {
  const candidate = (finishReason: string | undefined, text?: string) => ({
    candidates: [
      {
        ...(finishReason ? { finishReason, finishMessage: SENTINELS.body } : {}),
        ...(text !== undefined ? { content: { parts: [{ text }] } } : {}),
      },
    ],
  });

  it.each([
    [
      "promptFeedback.blockReason",
      { promptFeedback: { blockReason: "SAFETY", extra: SENTINELS.body } },
    ],
    ["finishReason SAFETY", candidate("SAFETY", `partial ${SENTINELS.body}`)],
    ["finishReason PROHIBITED_CONTENT", candidate("PROHIBITED_CONTENT")],
  ])("%s → one failed event with cause provider_blocked", async (_n, body) => {
    stubResponse(200, body);
    const { error, result, lines } = await run();
    expect(result).toBeUndefined();
    expect(error).toBeInstanceOf(AiGuardError);
    expect(error!.message).not.toMatch(/SAFETY|PROHIBITED|BLOCK/);
    expect(error!.message).not.toContain(SENTINELS.body);
    expect(expectSafe(lines)).toMatchObject({
      event: "ai.ask.failed",
      stage: "provider",
      cause: "provider_blocked",
      httpStatus: 200,
    });
  });

  it("finishReason OTHER → one failed event with its own cause, no value or text logged", async () => {
    stubResponse(200, candidate("OTHER", "SECRET-PARTIAL-555"));
    const { error, lines } = await run();
    expect(error).toBeInstanceOf(AiGuardError);
    expect(expectSafe(lines)).toMatchObject({
      event: "ai.ask.failed",
      stage: "provider",
      cause: "provider_other_finish",
      httpStatus: 200,
    });
    expect(lines[0]).not.toContain("SECRET-PARTIAL-555");
    expect(error!.message).not.toContain("SECRET-PARTIAL-555");
  });

  it("MAX_TOKENS without text → one failed event with cause provider_truncated", async () => {
    stubResponse(200, candidate("MAX_TOKENS"));
    const { error, lines } = await run();
    expect(error).toBeInstanceOf(AiGuardError);
    expect(expectSafe(lines)).toMatchObject({
      event: "ai.ask.failed",
      cause: "provider_truncated",
    });
  });

  it("MAX_TOKENS with text → the user gets the text plus the warning, plus ONE degraded event and no failed event", async () => {
    stubResponse(200, candidate("MAX_TOKENS", "Du hast im Oktober"));
    const { result, error, lines } = await run();
    expect(error).toBeUndefined();
    expect((result as { answer: string }).answer).toMatch(
      /^Hinweis: .*unvollständig.*\n\nDu hast im Oktober$/s,
    );
    // The internal marker never reaches the client payload.
    expect(result).not.toHaveProperty("degraded");
    expect(expectSafe(lines)).toMatchObject({
      event: "ai.ask.degraded",
      stage: "provider",
      outcome: "truncated",
      cause: "provider_truncated",
      httpStatus: 200,
    });
  });

  it("an unlisted finishReason with text → answer unchanged, one degraded event without the value", async () => {
    stubResponse(200, candidate("CONTINUATION", "Antwort"));
    const { result, lines } = await run();
    expect(result).toEqual({ answer: "Antwort" });
    const event = expectSafe(lines);
    expect(event).toMatchObject({
      event: "ai.ask.degraded",
      outcome: "unexpected_finish",
      cause: "provider_unexpected_finish",
    });
    expect(lines[0]).not.toContain("CONTINUATION");
  });

  it("STOP and a missing finishReason log nothing", async () => {
    for (const reason of ["STOP", undefined]) {
      stubResponse(200, candidate(reason, "Antwort"));
      const { result, lines } = await run();
      expect(result).toEqual({ answer: "Antwort" });
      expect(lines).toEqual([]);
    }
  });

  it("a throwing logger does not turn a truncated answer into an error", async () => {
    stubResponse(200, candidate("MAX_TOKENS", "Teil"));
    const { result, error } = await run({
      log: () => {
        throw new Error("logger down");
      },
    });
    expect(error).toBeUndefined();
    expect((result as { answer: string }).answer).toContain("Teil");
  });
});

describe("web search unavailable → one safe ai.search.degraded event", () => {
  const SEARCH_REASONS = [
    "missing_key",
    "rate_limited",
    "network",
    "unavailable",
    "quota_exhausted",
  ] as const;

  async function runWithSearchMarker(
    searchUnavailable: (typeof SEARCH_REASONS)[number] | undefined,
    log?: (l: string) => void,
  ) {
    const lines: string[] = [];
    const result = await runAskAssistant(
      DATA,
      { supabase: rpcOk, userId: SENTINELS.user },
      {
        createProvider: () => ({
          ask: async () => ({
            answer: `Antwort ${SENTINELS.body}`,
            ...(searchUnavailable ? { searchUnavailable } : {}),
          }),
        }),
        log: log ?? ((l) => lines.push(l)),
      },
    );
    return { result, lines };
  }

  it.each(SEARCH_REASONS)(
    "%s → exactly one allowlisted line, no marker for the client",
    async (reason) => {
      const { result, lines } = await runWithSearchMarker(reason);
      expect(result).toEqual({ answer: `Antwort ${SENTINELS.body}` });
      expect(result).not.toHaveProperty("searchUnavailable");
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]!);
      for (const key of Object.keys(parsed)) expect(ALLOWED_FIELDS).toContain(key);
      for (const secret of Object.values(SENTINELS)) expect(lines[0]).not.toContain(secret);
      expect(parsed).toMatchObject({
        event: "ai.search.degraded",
        stage: "provider",
        outcome: "search_unavailable",
        cause: `search_${reason}`,
      });
      expect(AI_FAILURE_CAUSES).toContain(parsed.cause);
    },
  );

  it("no marker → no search event", async () => {
    const { lines } = await runWithSearchMarker(undefined);
    expect(lines).toEqual([]);
  });

  it("a throwing logger does not break the answer", async () => {
    const { result } = await runWithSearchMarker("missing_key", () => {
      throw new Error("log sink down");
    });
    expect(result).toEqual({ answer: `Antwort ${SENTINELS.body}` });
  });
});
