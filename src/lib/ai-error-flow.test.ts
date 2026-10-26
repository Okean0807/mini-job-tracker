/** Server error → client message → UI state: session vs provider errors, busy reset, no fake answers. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => {
  const builder: Record<string, unknown> = {};
  builder["middleware"] = () => builder;
  builder["inputValidator"] = () => builder;
  builder["handler"] = (fn: unknown) => fn;
  return { createServerFn: () => builder };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import { runAssistantAsk } from "@/lib/ai-ask";
import { AI_CLIENT_SAFE_MESSAGES, aiClientErrorMessage } from "@/lib/ai-client-error";
import { AiGuardError, parseAskAssistantInput } from "@/lib/ai-guard";
import {
  AI_MAX_MESSAGE_CHARS,
  type AiChatHistoryStore,
  getActiveConversation,
  loadAiChatHistory,
  normalizeAiChatHistory,
  saveAiChatHistory,
  setActiveMessages,
} from "@/lib/minijob/ai-chat-history";
import { type AskRateLimitClient, runAskAssistant } from "@/lib/ai.functions";
import {
  BLOCKED_RESPONSE_MESSAGE,
  EMPTY_RESPONSE_MESSAGE,
  GeminiProvider,
  INCOMPLETE_RESPONSE_MESSAGE,
  PROVIDER_UNAVAILABLE_MESSAGE,
  TRUNCATED_ANSWER_NOTE,
  TRUNCATED_EMPTY_MESSAGE,
  mapHttpError,
} from "@/lib/ai/gemini-provider";

async function flow(invoke: () => Promise<{ answer: string }>) {
  const busy: boolean[] = [];
  const answers: string[] = [];
  const errors: string[] = [];
  await runAssistantAsk(
    invoke,
    {
      setBusy: (b) => busy.push(b),
      onAnswer: (r) => answers.push(r.answer),
      onError: (m) => errors.push(m),
    },
    {
      timeoutMs: 35_000,
      mapError: (e) => aiClientErrorMessage(e, AI_CLIENT_SAFE_MESSAGES.unavailable),
      timeoutMessage: "t",
    },
  );
  return { busy, answers, errors };
}

describe("session errors and provider errors are different to the user", () => {
  it("application authentication failures ask the user to sign in again", async () => {
    for (const message of [
      "Unauthorized: No authorization header provided",
      "Unauthorized: Only Bearer tokens are supported",
      "Unauthorized: No token provided",
      "Unauthorized: Invalid token",
      "Unauthorized: No user ID found in token",
    ]) {
      const { errors, answers, busy } = await flow(() => Promise.reject(new Error(message)));
      expect(errors).toEqual([AI_CLIENT_SAFE_MESSAGES.auth]);
      expect(errors[0]).toMatch(/melde dich erneut an/);
      expect(answers).toEqual([]);
      expect(busy).toEqual([true, false]);
    }
  });

  it("Gemini credential failures (401, 400 invalid key) do NOT ask for a new login", async () => {
    for (const err of [
      mapHttpError(401, ""),
      mapHttpError(400, '{"error":{"status":"INVALID_ARGUMENT","message":"API key not valid"}}'),
    ]) {
      const { errors, busy } = await flow(() => Promise.reject(err));
      expect(errors).toEqual([PROVIDER_UNAVAILABLE_MESSAGE]);
      expect(errors[0]).not.toMatch(/Sitzung|anmelden|Anmeldung/i);
      expect(busy).toEqual([true, false]);
    }
  });

  it("the two cases never share a message", () => {
    const session = aiClientErrorMessage(new Error("Unauthorized: Invalid token"), "x");
    const provider = aiClientErrorMessage(mapHttpError(401, ""), "x");
    expect(session).not.toBe(provider);
  });

  it("an unreadable request object is a service problem, not a login problem", async () => {
    const { errors } = await flow(() =>
      Promise.reject(new Error("Unauthorized: No request headers available")),
    );
    expect(errors).toEqual([AI_CLIENT_SAFE_MESSAGES.unavailable]);
  });
});

describe("failed or empty provider responses are errors, not chat answers", () => {
  it("an empty-response error reaches onError only, busy is reset", async () => {
    const { errors, answers, busy } = await flow(() =>
      Promise.reject(
        new AiGuardError("unavailable", EMPTY_RESPONSE_MESSAGE, { cause: "provider_empty" }),
      ),
    );
    expect(errors).toEqual([EMPTY_RESPONSE_MESSAGE]);
    expect(answers).toEqual([]);
    expect(busy).toEqual([true, false]);
  });

  it("every other server message passes through unchanged and never leaks diagnostics", async () => {
    for (const status of [403, 404, 429, 500, 502, 503]) {
      const err = mapHttpError(status, '{"error":{"status":"INTERNAL","message":"SECRET"}}');
      const { errors } = await flow(() => Promise.reject(err));
      expect(errors).toEqual([err.message]);
      expect(errors[0]).not.toMatch(/SECRET|INTERNAL|\b[1-5]\d\d\b|provider_/);
    }
  });

  it("a normal answer still arrives through onAnswer", async () => {
    const { errors, answers, busy } = await flow(async () => ({ answer: "Antwort" }));
    expect({ errors, answers, busy }).toEqual({
      errors: [],
      answers: ["Antwort"],
      busy: [true, false],
    });
  });
});

describe("blocked and truncated provider responses in the UI flow", () => {
  it("a blocked response reaches onError with the neutral message, never onAnswer", async () => {
    const err = new AiGuardError("unavailable", BLOCKED_RESPONSE_MESSAGE, {
      cause: "provider_blocked",
    });
    const { errors, answers, busy } = await flow(() => Promise.reject(err));
    expect(errors).toEqual([BLOCKED_RESPONSE_MESSAGE]);
    expect(errors[0]).not.toMatch(/SAFETY|BLOCK|PROHIBITED|finishReason/i);
    expect(answers).toEqual([]);
    expect(busy).toEqual([true, false]);
  });

  it("an empty-after-truncation error reaches onError", async () => {
    const { errors, answers } = await flow(() =>
      Promise.reject(
        new AiGuardError("unavailable", TRUNCATED_EMPTY_MESSAGE, { cause: "provider_truncated" }),
      ),
    );
    expect(errors).toEqual([TRUNCATED_EMPTY_MESSAGE]);
    expect(answers).toEqual([]);
  });
});

// Real chain: stubbed Gemini HTTP response -> GeminiProvider -> runAskAssistant (rate-limit RPC
// stubbed) -> runAssistantAsk handlers -> the message/history steps of assistent.tsx.
describe("provider response → server → client handlers → chat history", () => {
  const rpcOk: AskRateLimitClient = {
    rpc: () => ({
      abortSignal: async () => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }),
    }),
  };
  const USER = "flow-user";

  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "SECRET-API-KEY-111");
    vi.stubEnv("GEMINI_MODEL", "");
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const stubGemini = (status: number, body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );
  const candidate = (finishReason: string, text?: string) => ({
    candidates: [
      {
        finishReason,
        ...(text !== undefined ? { content: { parts: [{ text }] } } : {}),
      },
    ],
  });

  /** Mirrors assistent.tsx: onAnswer/onError append an "ai" message, persisted through the store. */
  async function chat() {
    let history: AiChatHistoryStore = setActiveMessages({ conversations: [], activeId: null }, [
      { role: "user", text: "Frage" },
    ]);
    const busy: boolean[] = [];
    const toasts: string[] = [];
    const append = (text: string) => {
      const prior = getActiveConversation(history)?.messages ?? [];
      history = setActiveMessages(history, [...prior, { role: "ai", text }]);
      saveAiChatHistory(USER, history);
    };
    await runAssistantAsk(
      () =>
        runAskAssistant(
          parseAskAssistantInput({
            question: "Wie viel?",
            context: '{"currentDate":"2026-10-26"}',
          }),
          { supabase: rpcOk, userId: USER },
          { createProvider: () => new GeminiProvider(), log: () => {} },
        ) as Promise<{ answer: string }>,
      {
        setBusy: (b) => busy.push(b),
        onAnswer: (r) => append(r.answer),
        onError: (m) => {
          toasts.push(m);
          append(m);
        },
      },
      {
        timeoutMs: 35_000,
        mapError: (e) => aiClientErrorMessage(e, AI_CLIENT_SAFE_MESSAGES.unavailable),
        timeoutMessage: "t",
      },
    );
    const stored = loadAiChatHistory(USER);
    const last = getActiveConversation(stored)!.messages.at(-1)!;
    return { busy, toasts, last, stored };
  }

  it("MAX_TOKENS with text: the stored chat message starts with the warning", async () => {
    stubGemini(200, candidate("MAX_TOKENS", "Du hast im Oktober"));
    const { last, toasts, busy } = await chat();
    expect(toasts).toEqual([]);
    expect(busy).toEqual([true, false]);
    expect(last.role).toBe("ai");
    expect(last.text.startsWith(TRUNCATED_ANSWER_NOTE)).toBe(true);
    expect(last.text.endsWith("Du hast im Oktober")).toBe(true);
  });

  it("MAX_TOKENS with a very long text: the warning survives the 8000-char cut and re-normalization", async () => {
    stubGemini(200, candidate("MAX_TOKENS", "x".repeat(AI_MAX_MESSAGE_CHARS * 2)));
    const { last, stored } = await chat();
    expect(last.text.length).toBe(AI_MAX_MESSAGE_CHARS);
    expect(last.text.startsWith(TRUNCATED_ANSWER_NOTE)).toBe(true);
    const again = normalizeAiChatHistory(
      JSON.parse(JSON.stringify(normalizeAiChatHistory(stored))),
    );
    expect(getActiveConversation(again)!.messages.at(-1)!.text).toBe(last.text);
  });

  it("OTHER finish reason: error toast with the neutral message, no answer text stored as a real answer", async () => {
    stubGemini(200, candidate("OTHER", "SECRET-PARTIAL-555"));
    const { toasts, last, busy } = await chat();
    expect(toasts).toEqual([INCOMPLETE_RESPONSE_MESSAGE]);
    expect(last.text).toBe(INCOMPLETE_RESPONSE_MESSAGE);
    expect(JSON.stringify(localStorage)).not.toContain("SECRET-PARTIAL-555");
    expect(busy).toEqual([true, false]);
  });

  it("blocked prompt: neutral message through onError", async () => {
    stubGemini(200, { promptFeedback: { blockReason: "SAFETY" } });
    const { toasts } = await chat();
    expect(toasts).toEqual([BLOCKED_RESPONSE_MESSAGE]);
  });
});
