/**
 * Behavioural tests for the askAssistant server function: the shared rate-limit RPC
 * must fail closed, and the provider (Gemini) must only be reached after an explicit
 * `allowed === true`. No network, no Supabase, no Gemini: createServerFn, the auth
 * middleware and the provider factory are replaced with in-memory fakes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { providerAsk, createDefaultProvider } = vi.hoisted(() => {
  const providerAsk = vi.fn();
  return { providerAsk, createDefaultProvider: vi.fn(() => ({ ask: providerAsk })) };
});

vi.mock("@tanstack/react-start", () => ({
  // Minimal builder: keeps the validator + handler so the function can be invoked directly.
  createServerFn: () => {
    let validate: (input: unknown) => unknown = (input) => input;
    const chain = {
      middleware: () => chain,
      inputValidator: (fn: (input: unknown) => unknown) => {
        validate = fn;
        return chain;
      },
      handler:
        (fn: (args: { data: unknown; context: unknown }) => Promise<unknown>) =>
        (opts: { data: unknown; context: unknown }) =>
          fn({ data: validate(opts.data), context: opts.context }),
    };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/ai/provider", () => ({ createDefaultProvider }));

import { askAssistant } from "./ai.functions";

type RpcResult = { data: unknown; error: unknown };

function run(rpcImpl: () => Promise<RpcResult>) {
  const rpc = vi.fn(rpcImpl);
  const call = askAssistant as unknown as (opts: {
    data: unknown;
    context: unknown;
  }) => Promise<unknown>;
  const result = call({
    data: { question: "Frage?", context: "{}" },
    context: { supabase: { rpc }, userId: "user-1" },
  });
  return { rpc, result };
}

beforeEach(() => {
  providerAsk.mockReset();
  createDefaultProvider.mockClear();
  providerAsk.mockResolvedValue({ answer: "Antwort" });
});

describe("askAssistant — rate-limit gate fails closed", () => {
  it("RPC error → refuses with the generic unavailable message, provider never created or called", async () => {
    const { result } = run(async () => ({ data: null, error: { message: "boom" } }));
    await expect(result).rejects.toMatchObject({
      name: "AiGuardError",
      code: "unavailable",
      message: "Die KI ist vorübergehend nicht verfügbar.",
    });
    expect(createDefaultProvider).not.toHaveBeenCalled();
    expect(providerAsk).not.toHaveBeenCalled();
  });

  it("RPC error does not leak the underlying error text", async () => {
    const { result } = run(async () => ({
      data: null,
      error: { message: "permission denied for function consume_ai_rate_limit" },
    }));
    const error = (await result.catch((e: unknown) => e)) as Error;
    expect(error.message).not.toMatch(/permission denied|consume_ai_rate_limit/);
  });

  it("RPC promise rejection → request fails, provider not called", async () => {
    const { result } = run(async () => {
      throw new Error("network down");
    });
    await expect(result).rejects.toThrow();
    expect(providerAsk).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty array", []],
    ["empty object", {}],
    ["array with empty row", [{}]],
    ["array with null row", [null]],
    ["string", "allowed"],
    ["number", 1],
    ["allowed null", [{ allowed: null }]],
    ["allowed missing", [{ retry_after_seconds: 5 }]],
    ["allowed as string 'true'", [{ allowed: "true" }]],
    ["allowed as string 'false'", [{ allowed: "false" }]],
    ["allowed as number 1", [{ allowed: 1 }]],
    ["allowed as object", [{ allowed: {} }]],
  ])("empty or malformed RPC result (%s) → refuses, provider not called", async (_label, data) => {
    const { result } = run(async () => ({ data, error: null }));
    await expect(result).rejects.toMatchObject({ name: "AiGuardError", code: "rate_limited" });
    expect(createDefaultProvider).not.toHaveBeenCalled();
    expect(providerAsk).not.toHaveBeenCalled();
  });

  it("allowed=false → rate_limited with the server's retry_after_seconds, provider not called", async () => {
    const { result } = run(async () => ({
      data: [{ allowed: false, retry_after_seconds: 12 }],
      error: null,
    }));
    await expect(result).rejects.toMatchObject({
      code: "rate_limited",
      message: "Zu viele KI-Anfragen. Bitte in 12 Sekunden erneut versuchen.",
    });
    expect(providerAsk).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["zero", 0],
    ["negative", -5],
  ])("allowed=false with %s retry_after_seconds → at least 1 second", async (_label, retry) => {
    const { result } = run(async () => ({
      data: [{ allowed: false, retry_after_seconds: retry }],
      error: null,
    }));
    await expect(result).rejects.toMatchObject({
      code: "rate_limited",
      message: "Zu viele KI-Anfragen. Bitte in 1 Sekunden erneut versuchen.",
    });
  });
});

describe("askAssistant — allowed=true reaches the provider", () => {
  it("array result with allowed=true → provider called once with the user's question/context", async () => {
    const { result } = run(async () => ({
      data: [{ allowed: true, retry_after_seconds: 0 }],
      error: null,
    }));
    await expect(result).resolves.toEqual({ answer: "Antwort" });
    expect(createDefaultProvider).toHaveBeenCalledTimes(1);
    expect(providerAsk).toHaveBeenCalledTimes(1);
    expect(providerAsk.mock.calls[0]?.[0]).toEqual({ question: "Frage?", context: "{}" });
  });

  it("single-object result with allowed=true is accepted too", async () => {
    const { result } = run(async () => ({ data: { allowed: true }, error: null }));
    await expect(result).resolves.toEqual({ answer: "Antwort" });
    expect(providerAsk).toHaveBeenCalledTimes(1);
  });

  it("calls the RPC with only p_user_id (never a client-supplied p_now_ms)", async () => {
    const { rpc, result } = run(async () => ({ data: [{ allowed: true }], error: null }));
    await result;
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("consume_ai_rate_limit", { p_user_id: "user-1" });
  });
});

describe("askAssistant — source keeps the strict gate", () => {
  // The refusal must be `allowed !== true` (not a truthiness check): a refactor that
  // switches to `!rateRow?.allowed` would let "true", 1 or {} through to the provider.
  const source = readFileSync(join(process.cwd(), "src/lib/ai.functions.ts"), "utf8");

  it("uses exactly one strict `rateRow?.allowed !== true` check", () => {
    expect(source.match(/rateRow\?\.allowed !== true/g)).toHaveLength(1);
  });

  it("has no truthiness check on the RPC row", () => {
    expect(source).not.toMatch(/!\s*rateRow\?\.allowed\b(?!\s*!==)/);
  });

  it("runs the privacy gate before the rate-limit RPC", () => {
    expect(source.indexOf("checkAiPrivacy(")).toBeGreaterThan(0);
    expect(source.indexOf("checkAiPrivacy(")).toBeLessThan(source.indexOf("consume_ai_rate_limit"));
  });
});
