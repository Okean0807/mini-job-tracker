import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => {
  const builder: Record<string, unknown> = {};
  builder["middleware"] = () => builder;
  builder["inputValidator"] = () => builder;
  builder["handler"] = (fn: unknown) => fn;
  return { createServerFn: () => builder };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import { ASK_GATEWAY_TIMEOUT_MESSAGE } from "@/lib/ai-ask";
import { AiGuardError } from "@/lib/ai-guard";
import { CONTEXT_INVALID, HEALTH_DATA_BLOCKED } from "@/lib/ai/health-privacy-gate";
import type { AIProvider } from "@/lib/ai/types";

import { type AskRateLimitClient, runAskAssistant } from "./ai.functions";

const QUESTION = "Wie viele Stunden habe ich diesen Monat gearbeitet?";
// Shape accepted by the privacy gate (keys from buildAssistantContext only).
const CONTEXT = '{"currentDate":"2026-10-26","currentMonth":{"hours":42,"earnings":583.8}}';
const USER_ID = "11111111-2222-3333-4444-555555555555";
const data = { question: QUESTION, context: CONTEXT, language: "Deutsch" };

function rpcClient(result: () => Promise<{ data: unknown; error: unknown }>) {
  const seen: { fn?: string; args?: Record<string, unknown>; signal?: AbortSignal } = {};
  const client: AskRateLimitClient = {
    rpc(fn, args) {
      seen.fn = fn;
      seen.args = args;
      return {
        abortSignal(signal) {
          seen.signal = signal;
          return result();
        },
      };
    },
  };
  return { client, seen };
}

const allowed = () =>
  Promise.resolve({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });

function provider(impl: AIProvider["ask"]) {
  const ask = vi.fn(impl);
  return { ask, create: () => ({ ask }) as AIProvider };
}

function harness() {
  const controller = new AbortController();
  const lines: string[] = [];
  let t = 1000;
  return {
    controller,
    lines,
    advance: (ms: number) => {
      t += ms;
    },
    deps: {
      createDeadline: vi.fn(() => controller.signal),
      now: () => t,
      log: (line: string) => lines.push(line),
    },
  };
}

describe("runAskAssistant — one server deadline covers rate limit + provider", () => {
  it("success: answer returned, rate limit called for the token user, same deadline on RPC and provider", async () => {
    const h = harness();
    const { client, seen } = rpcClient(allowed);
    const p = provider(async () => ({ answer: "Du hast 42 Stunden gearbeitet." }));

    const result = await runAskAssistant(
      data,
      { supabase: client, userId: USER_ID },
      {
        ...h.deps,
        createProvider: p.create,
      },
    );

    expect(result).toEqual({ answer: "Du hast 42 Stunden gearbeitet." });
    expect(seen.fn).toBe("consume_ai_rate_limit");
    expect(seen.args).toEqual({ p_user_id: USER_ID });
    expect(h.deps.createDeadline).toHaveBeenCalledTimes(1);
    expect(seen.signal).toBe(h.controller.signal);
    expect(p.ask).toHaveBeenCalledTimes(1);
    expect(p.ask.mock.calls[0]![1]).toEqual({ signal: h.controller.signal });
    expect(h.lines).toEqual([]);
  });

  it("deadline is created before the rate-limit RPC starts", async () => {
    const order: string[] = [];
    const controller = new AbortController();
    const { client } = rpcClient(() => {
      order.push("rpc");
      return allowed();
    });
    await runAskAssistant(
      data,
      { supabase: client, userId: USER_ID },
      {
        createDeadline: () => {
          order.push("deadline");
          return controller.signal;
        },
        createProvider: provider(async () => ({ answer: "ok" })).create,
        log: () => {},
      },
    );
    expect(order).toEqual(["deadline", "rpc"]);
  });

  it("slow rate-limit RPC aborted by the deadline → timeout copy, provider never called, stage logged", async () => {
    const h = harness();
    const { client } = rpcClient(async () => {
      h.advance(30_000);
      h.controller.abort(new DOMException("timed out", "TimeoutError"));
      return {
        data: null,
        error: { message: "AbortError: The operation was aborted.", code: "20" },
      };
    });
    const p = provider(async () => ({ answer: "never" }));

    await expect(
      runAskAssistant(
        data,
        { supabase: client, userId: USER_ID },
        { ...h.deps, createProvider: p.create },
      ),
    ).rejects.toMatchObject({
      name: "AiGuardError",
      code: "unavailable",
      message: ASK_GATEWAY_TIMEOUT_MESSAGE,
    });
    expect(p.ask).not.toHaveBeenCalled();
    expect(h.lines.map((l) => JSON.parse(l))).toEqual([
      {
        event: "ai.ask.failed",
        stage: "rate_limit",
        outcome: "timeout",
        cause: "rate_limit_timeout",
        elapsedMs: 30_000,
      },
    ]);
  });

  it("RPC error without timeout still fails closed (rate limit not bypassed)", async () => {
    const h = harness();
    const { client } = rpcClient(async () => ({ data: null, error: { message: "db down" } }));
    const p = provider(async () => ({ answer: "never" }));

    await expect(
      runAskAssistant(
        data,
        { supabase: client, userId: USER_ID },
        { ...h.deps, createProvider: p.create },
      ),
    ).rejects.toMatchObject({
      code: "unavailable",
      message: "Die KI ist vorübergehend nicht verfügbar.",
    });
    expect(p.ask).not.toHaveBeenCalled();
    expect(JSON.parse(h.lines[0]!)).toMatchObject({ stage: "rate_limit", outcome: "rpc_error" });
  });

  it("rate limit denial is enforced and keeps its own message", async () => {
    const h = harness();
    const { client } = rpcClient(async () => ({
      data: [{ allowed: false, retry_after_seconds: 17 }],
      error: null,
    }));
    const p = provider(async () => ({ answer: "never" }));

    await expect(
      runAskAssistant(
        data,
        { supabase: client, userId: USER_ID },
        { ...h.deps, createProvider: p.create },
      ),
    ).rejects.toMatchObject({
      code: "rate_limited",
      message: "Zu viele KI-Anfragen. Bitte in 17 Sekunden erneut versuchen.",
    });
    expect(p.ask).not.toHaveBeenCalled();
  });

  it("missing/empty rate-limit row is treated as denied", async () => {
    const h = harness();
    const { client } = rpcClient(async () => ({ data: [], error: null }));
    const p = provider(async () => ({ answer: "never" }));
    await expect(
      runAskAssistant(
        data,
        { supabase: client, userId: USER_ID },
        { ...h.deps, createProvider: p.create },
      ),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(p.ask).not.toHaveBeenCalled();
  });

  it("raw provider AbortError/TimeoutError → timeout copy + provider timeout logged with elapsed ms", async () => {
    const h = harness();
    const { client } = rpcClient(allowed);
    const p = provider(async () => {
      h.advance(29_500);
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });

    await expect(
      runAskAssistant(
        data,
        { supabase: client, userId: USER_ID },
        { ...h.deps, createProvider: p.create },
      ),
    ).rejects.toMatchObject({ code: "unavailable", message: ASK_GATEWAY_TIMEOUT_MESSAGE });
    expect(h.lines.map((l) => JSON.parse(l))).toEqual([
      {
        event: "ai.ask.failed",
        stage: "provider",
        outcome: "timeout",
        cause: "provider_timeout",
        elapsedMs: 29_500,
      },
    ]);
  });

  it("provider AiGuardError (e.g. 429 quota) is passed through unchanged and logged by code", async () => {
    const h = harness();
    const { client } = rpcClient(allowed);
    const quota = new AiGuardError(
      "rate_limited",
      "Zu viele Anfragen oder Kontingent erschöpft – bitte kurz warten.",
    );
    const p = provider(async () => {
      throw quota;
    });

    await expect(
      runAskAssistant(
        data,
        { supabase: client, userId: USER_ID },
        { ...h.deps, createProvider: p.create },
      ),
    ).rejects.toBe(quota);
    expect(JSON.parse(h.lines[0]!)).toMatchObject({ stage: "provider", outcome: "rate_limited" });
  });

  it("unknown provider error → generic safe copy; log carries no prompt, context, user id or error text", async () => {
    const h = harness();
    const { client } = rpcClient(allowed);
    const p = provider(async () => {
      throw new Error(`upstream said key=sk-SECRET123 for ${USER_ID}: ${QUESTION}`);
    });

    await expect(
      runAskAssistant(
        data,
        { supabase: client, userId: USER_ID },
        { ...h.deps, createProvider: p.create },
      ),
    ).rejects.toMatchObject({ code: "unavailable", message: "Die KI konnte nicht antworten." });
    expect(h.lines).toHaveLength(1);
    const line = h.lines[0]!;
    // `cause` is the only addition: a closed-set value, never error text.
    expect(JSON.parse(line)).toEqual({
      event: "ai.ask.failed",
      stage: "provider",
      outcome: "error",
      cause: "provider_error",
      elapsedMs: expect.any(Number),
    });
    for (const secret of ["sk-SECRET123", USER_ID, QUESTION, CONTEXT, "42", "upstream"]) {
      expect(line).not.toContain(secret);
    }
  });

  it("a throwing logger never changes the response", async () => {
    const { client } = rpcClient(allowed);
    const p = provider(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(
      runAskAssistant(
        data,
        { supabase: client, userId: USER_ID },
        {
          createDeadline: () => new AbortController().signal,
          createProvider: p.create,
          log: () => {
            throw new Error("logger down");
          },
        },
      ),
    ).rejects.toMatchObject({ message: ASK_GATEWAY_TIMEOUT_MESSAGE });
  });

  it("default deadline is a real AbortSignal (no injection)", async () => {
    const { client, seen } = rpcClient(allowed);
    await runAskAssistant(
      data,
      { supabase: client, userId: USER_ID },
      {
        createProvider: provider(async () => ({ answer: "ok" })).create,
        log: () => {},
      },
    );
    expect(seen.signal).toBeInstanceOf(AbortSignal);
    expect(seen.signal?.aborted).toBe(false);
  });
});

describe("runAskAssistant — privacy gate runs before deadline, rate limit and provider", () => {
  it.each([
    [
      "personal health question",
      { ...data, question: "Ich bin krank wegen Migräne, was nun?" },
      HEALTH_DATA_BLOCKED,
    ],
    ["unexpected context key", { ...data, context: '{"notes":"x"}' }, CONTEXT_INVALID],
  ])("%s: blocked, no deadline, no RPC, no provider", async (_label, input, code) => {
    const h = harness();
    const rpc = vi.fn();
    const p = provider(async () => ({ answer: "never" }));
    const create = vi.fn(p.create);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runAskAssistant(
      input,
      { supabase: { rpc } as unknown as AskRateLimitClient, userId: USER_ID },
      { ...h.deps, createProvider: create },
    );

    expect(result).toMatchObject({ blocked: true, code });
    expect(rpc).not.toHaveBeenCalled();
    expect(h.deps.createDeadline).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(p.ask).not.toHaveBeenCalled();
    expect(h.lines).toEqual([]);
    expect(warn.mock.calls.map((c) => c.join(" ")).join("\n")).not.toContain("Migräne");
    warn.mockRestore();
  });
});
