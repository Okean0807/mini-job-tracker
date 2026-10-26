/**
 * Integration: real askAssistant handler (ai.functions.ts) with the real
 * OrchestratingAIProvider -> GeminiProvider + TavilyWebSearchProvider, where
 * only the network (global fetch), the TanStack server-fn wrapper and the
 * Supabase auth middleware are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => {
  type Handler = (opts: { data: unknown; context: unknown }) => unknown;
  const builder = {
    middleware: () => builder,
    inputValidator: (v: (i: unknown) => unknown) => {
      (builder as { _validate?: (i: unknown) => unknown })._validate = v;
      return builder;
    },
    handler: (fn: Handler) => {
      const validate = (builder as { _validate?: (i: unknown) => unknown })._validate!;
      return async (opts: { data: unknown; context: unknown }) =>
        fn({ data: validate(opts.data), context: opts.context });
    },
  };
  return { createServerFn: () => builder };
});

vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import { askAssistant } from "@/lib/ai.functions";
import { HEALTH_DATA_BLOCKED, CONTEXT_INVALID } from "@/lib/ai/health-privacy-gate";

type Invoke = (opts: {
  data: unknown;
  context: unknown;
}) => Promise<{ answer?: unknown; blocked?: unknown; code?: unknown }>;
const invoke = askAssistant as unknown as Invoke;

const GEMINI_HOST = "generativelanguage.googleapis.com";
const TAVILY_HOST = "api.tavily.com";

let fetchSpy: ReturnType<typeof vi.fn>;
let rpcSpy: ReturnType<typeof vi.fn>;

function ctx() {
  return { userId: "00000000-0000-0000-0000-000000000000", supabase: { rpc: rpcSpy } };
}

function callsTo(host: string): number {
  return fetchSpy.mock.calls.filter(([url]) => String(url).includes(host)).length;
}

const VALID_CONTEXT = JSON.stringify({
  currentDate: "2026-03-15",
  jobs: [{ id: "j1", name: "Café", mode: "flex", hourlyRate: 13.9, hours: 4, earnings: 55.6 }],
});

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key-not-real");
  vi.stubEnv("TAVILY_API_KEY", "test-tavily-key-not-real");
  // Same shape as supabase-js: rpc() returns a builder; the handler passes its deadline via abortSignal().
  rpcSpy = vi.fn(() => ({
    abortSignal: async () => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }),
  }));
  fetchSpy = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes(TAVILY_HOST)) {
      return new Response(
        JSON.stringify({
          results: [
            {
              title: "Minijob-Zentrale",
              url: "https://www.minijob-zentrale.de/",
              content: "Verdienstgrenze",
              score: 0.9,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.includes(GEMINI_HOST)) {
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "Antwort" }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error("unexpected fetch target in test");
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("askAssistant L1 privacy gate (integration, mocked Gemini + Tavily)", () => {
  it.each([
    "Ich bin seit Montag krank wegen Grippe, wie hoch ist die Minijob-Grenze 2026?",
    "Meine Diagnose ist Depression – gilt das Gesetz zur Entgeltfortzahlung?",
    "I'm pregnant, what is the minijob limit 2026?",
  ])("blocks personal health question with 0 Gemini/Tavily calls: %s", async (question) => {
    const res = await invoke({ data: { question, context: VALID_CONTEXT }, context: ctx() });
    expect(res).toMatchObject({ blocked: true, code: HEALTH_DATA_BLOCKED });
    expect(String(res.answer)).toMatch(/Datenschutz/);
    expect(callsTo(GEMINI_HOST)).toBe(0);
    expect(callsTo(TAVILY_HOST)).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("blocks health data smuggled in context (job name) with 0 provider calls", async () => {
    const context = JSON.stringify({
      jobs: [{ id: "j1", name: "Krankgeschrieben wegen Migräne" }],
    });
    const res = await invoke({
      data: { question: "Wie hoch ist die Minijob-Grenze 2026?", context },
      context: ctx(),
    });
    expect(res).toMatchObject({ blocked: true, code: HEALTH_DATA_BLOCKED });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "Datenbasis frei: Ich bin krank"],
    ["forged extra field", JSON.stringify({ absences: [{ note: "Arzt" }] })],
  ])("malformed/forged context fails closed with 0 provider calls (%s)", async (_l, context) => {
    const res = await invoke({
      data: { question: "Wie hoch ist die Minijob-Grenze 2026?", context },
      context: ctx(),
    });
    expect(res).toMatchObject({ blocked: true, code: CONTEXT_INVALID });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("missing context is rejected by input validation before the handler body", async () => {
    await expect(
      invoke({ data: { question: "Wie hoch ist die Minijob-Grenze 2026?" }, context: ctx() }),
    ).rejects.toMatchObject({ code: "invalid_payload" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allowed general current-info question calls Tavily then Gemini normally", async () => {
    const res = await invoke({
      data: { question: "Wie hoch ist die Minijob-Grenze 2026?", context: VALID_CONTEXT },
      context: ctx(),
    });
    expect(res.blocked).toBeUndefined();
    expect(String(res.answer)).toContain("Antwort");
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(callsTo(TAVILY_HOST)).toBe(1);
    expect(callsTo(GEMINI_HOST)).toBe(1);
  });

  it("allowed general sick-pay question ('Lohnfortzahlung im Krankheitsfall') reaches Gemini", async () => {
    const res = await invoke({
      data: { question: "Lohnfortzahlung im Krankheitsfall", context: VALID_CONTEXT },
      context: ctx(),
    });
    expect(res.blocked).toBeUndefined();
    expect(callsTo(GEMINI_HOST)).toBe(1);
  });
});

describe("askAssistant privacy gate logging", () => {
  it("logs the reason code only, never question or context content", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const secretish = "Bandscheibenvorfall-XYZ123";
    const question = `Ich bin krank wegen ${secretish}`;
    const context = JSON.stringify({ jobs: [{ id: "j1", name: "Café-Q9" }] });
    await invoke({ data: { question, context }, context: ctx() });

    const all = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" ")));
    expect(all.length).toBeGreaterThan(0);
    for (const line of all) {
      expect(line).not.toContain(secretish);
      expect(line).not.toContain("Ich bin krank");
      expect(line).not.toContain("Café-Q9");
    }
    expect(all.some((l) => l.includes(HEALTH_DATA_BLOCKED))).toBe(true);
  });
});
