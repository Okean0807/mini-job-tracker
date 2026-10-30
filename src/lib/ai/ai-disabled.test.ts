/**
 * Free-launch guarantee: with AI_FEATURES_ENABLED not "true", askAssistant must not touch the
 * rate-limit RPC, must not build a provider and must not issue ANY outbound request — in
 * particular none to Gemini or Tavily. Uses the REAL provider chain (only the framework wrapper
 * and the auth middleware are faked) with a global fetch spy.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
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
        (opts?: { data: unknown; context: unknown }) =>
          fn({ data: validate(opts?.data), context: opts?.context }),
    };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import { getAiStatus } from "../ai-status.functions";
import { askAssistant } from "../ai.functions";
import { createDefaultProvider } from "./provider";

const fetchSpy = vi.fn();
const rpc = vi.fn();

function ask(question: string) {
  const call = askAssistant as unknown as (opts: {
    data: unknown;
    context: unknown;
  }) => Promise<unknown>;
  return call({
    data: { question, context: "{}" },
    context: { supabase: { rpc }, userId: "user-1" },
  });
}

beforeEach(() => {
  fetchSpy.mockReset();
  rpc.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
  vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each([
  ["unset", undefined],
  ["empty", ""],
  ["false", "false"],
  ["TRUE (wrong case)", "TRUE"],
  ["1", "1"],
])("AI off (AI_FEATURES_ENABLED %s)", (_label, value) => {
  beforeEach(() => {
    if (value === undefined) vi.stubEnv("AI_FEATURES_ENABLED", undefined as unknown as string);
    else vi.stubEnv("AI_FEATURES_ENABLED", value);
    if (value === undefined) delete process.env["AI_FEATURES_ENABLED"];
  });

  it("askAssistant → controlled `unavailable`; no RPC, no fetch", async () => {
    await expect(ask("Wie hoch ist der Verdienst im Mai?")).rejects.toMatchObject({
      name: "AiGuardError",
      code: "unavailable",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a current-info question (would trigger Tavily) sends nothing either", async () => {
    await expect(
      ask("Wie hoch ist der aktuelle Mindestlohn 2026 in Deutschland?"),
    ).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("createDefaultProvider refuses to build a provider", () => {
    expect(() => createDefaultProvider()).toThrowError(/nicht verfügbar/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("getAiStatus reports { enabled: false } and nothing else", async () => {
    const status = await (getAiStatus as unknown as () => Promise<unknown>)();
    expect(status).toEqual({ enabled: false });
  });
});

describe('AI on (AI_FEATURES_ENABLED="true")', () => {
  beforeEach(() => {
    vi.stubEnv("AI_FEATURES_ENABLED", "true");
  });

  it("createDefaultProvider builds the provider without any network call", () => {
    expect(() => createDefaultProvider()).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("askAssistant proceeds to the rate-limit gate (which still fails closed)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(ask("Frage?")).rejects.toMatchObject({
      code: "unavailable",
      message: "Die KI ist vorübergehend nicht verfügbar.",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("getAiStatus reports { enabled: true }", async () => {
    expect(await (getAiStatus as unknown as () => Promise<unknown>)()).toEqual({ enabled: true });
  });
});

describe("static guards", () => {
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }
  const files = walk(srcRoot).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));

  it("Gemini/Tavily hosts appear only in their two provider files", () => {
    const hits = files
      .filter((f) =>
        /generativelanguage\.googleapis\.com|api\.tavily\.com/.test(readFileSync(f, "utf8")),
      )
      .map((f) => relative(srcRoot, f).replaceAll("\\", "/"))
      .sort();
    expect(hits).toEqual(["lib/ai/gemini-provider.ts", "lib/ai/web-search/tavily-provider.ts"]);
  });

  it("only provider.ts reaches the orchestrator, only ai.functions.ts calls createDefaultProvider", () => {
    const rel = (re: RegExp) =>
      files
        .filter((f) => re.test(readFileSync(f, "utf8")))
        .map((f) => relative(srcRoot, f).replaceAll("\\", "/"))
        .sort();
    expect(rel(/OrchestratingAIProvider/)).toEqual([
      "lib/ai/orchestrator.ts",
      "lib/ai/provider.ts",
    ]);
    expect(rel(/createDefaultProvider\(/)).toEqual(["lib/ai.functions.ts", "lib/ai/provider.ts"]);
  });

  it("askAssistant checks the flag before the RPC and before the provider", () => {
    const fn = readFileSync(join(srcRoot, "lib/ai.functions.ts"), "utf8");
    const flag = fn.indexOf("isAiFeatureEnabled()");
    expect(flag).toBeGreaterThan(-1);
    expect(flag).toBeLessThan(fn.indexOf("consume_ai_rate_limit"));
    expect(flag).toBeLessThan(fn.indexOf("createDefaultProvider()"));
  });

  it("the client never reads AI_FEATURES_ENABLED or a VITE_ twin of it", () => {
    const offenders = files
      .filter((f) => /AI_FEATURES_ENABLED/.test(readFileSync(f, "utf8")))
      .map((f) => relative(srcRoot, f).replaceAll("\\", "/"));
    expect(offenders).toEqual(["lib/ai/feature-flag.ts"]);
  });
});
