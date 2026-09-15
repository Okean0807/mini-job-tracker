import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiGuardError } from "@/lib/ai-guard";

import {
  buildGenerateContentUrl,
  extractSourcesFromGrounding,
  GeminiProvider,
  GROUNDING_UNAVAILABLE_NOTE,
  mapHttpError,
  normalizeGeminiModelId,
  resolveGeminiConfig,
  withGroundingUnavailableNote,
} from "./gemini-provider";

describe("normalizeGeminiModelId", () => {
  it("defaults empty/undefined to gemini-3.6-flash", () => {
    expect(normalizeGeminiModelId(undefined)).toBe("gemini-3.6-flash");
    expect(normalizeGeminiModelId("")).toBe("gemini-3.6-flash");
    expect(normalizeGeminiModelId("   ")).toBe("gemini-3.6-flash");
    expect(normalizeGeminiModelId('""')).toBe("gemini-3.6-flash");
  });

  it("trims and strips surrounding quotes", () => {
    expect(normalizeGeminiModelId('  "gemini-2.5-pro"  ')).toBe("gemini-2.5-pro");
    expect(normalizeGeminiModelId("  'gemini-3.6-flash'  ")).toBe("gemini-3.6-flash");
  });

  it("strips a single models/ prefix", () => {
    expect(normalizeGeminiModelId("models/gemini-3.6-flash")).toBe("gemini-3.6-flash");
    expect(normalizeGeminiModelId('  "models/gemini-2.5-pro"  ')).toBe("gemini-2.5-pro");
    expect(normalizeGeminiModelId("models/")).toBe("gemini-3.6-flash");
  });

  it("remaps deprecated gemini-2.5-flash ids for new API users", () => {
    expect(normalizeGeminiModelId("gemini-2.5-flash")).toBe("gemini-3.6-flash");
    expect(normalizeGeminiModelId("gemini-2.5-flash-lite")).toBe("gemini-3.5-flash-lite");
    expect(normalizeGeminiModelId("models/gemini-2.5-flash")).toBe("gemini-3.6-flash");
    expect(normalizeGeminiModelId('  "models/gemini-2.5-flash-lite"  ')).toBe(
      "gemini-3.5-flash-lite",
    );
  });
});

describe("buildGenerateContentUrl", () => {
  it("builds exact generateContent URL without double models/", () => {
    expect(buildGenerateContentUrl("gemini-3.6-flash")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    );
  });

  it("sanitizes models/ prefix and quotes so URL has no double models/", () => {
    expect(buildGenerateContentUrl("models/gemini-3.6-flash")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    );
    expect(buildGenerateContentUrl('"models/gemini-2.5-pro"')).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
    );
  });

  it("remaps deprecated model id in URL", () => {
    expect(buildGenerateContentUrl("gemini-2.5-flash")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    );
  });

  it("leaves dots unencoded and has a single :generateContent suffix", () => {
    const url = buildGenerateContentUrl("gemini-3.6-flash");
    expect(url).toContain("gemini-3.6-flash");
    expect(url).not.toContain("gemini-3%2E6-flash");
    expect(url.match(/:generateContent/g)?.length).toBe(1);
    expect(url.match(/\/models\//g)?.length).toBe(1);
  });
});

describe("resolveGeminiConfig", () => {
  it("defaults model to gemini-3.6-flash", () => {
    const cfg = resolveGeminiConfig({ GEMINI_API_KEY: "k" } as Record<string, string | undefined>);
    expect(cfg.apiKey).toBe("k");
    expect(cfg.model).toBe("gemini-3.6-flash");
  });

  it("reads GEMINI_MODEL when set", () => {
    const cfg = resolveGeminiConfig({
      GEMINI_API_KEY: "k",
      GEMINI_MODEL: " gemini-2.5-pro ",
    } as Record<string, string | undefined>);
    expect(cfg.model).toBe("gemini-2.5-pro");
  });

  it("sanitizes quoted and models/-prefixed GEMINI_MODEL and remaps deprecated", () => {
    expect(
      resolveGeminiConfig({
        GEMINI_API_KEY: "k",
        GEMINI_MODEL: '  "models/gemini-2.5-flash"  ',
      } as Record<string, string | undefined>).model,
    ).toBe("gemini-3.6-flash");
  });

  it("treats blank key as missing", () => {
    const cfg = resolveGeminiConfig({ GEMINI_API_KEY: "  " } as Record<string, string | undefined>);
    expect(cfg.apiKey).toBeUndefined();
  });

  it("strips surrounding double quotes from key (Vercel paste)", () => {
    const cfg = resolveGeminiConfig({
      GEMINI_API_KEY: '  "sk-test-quoted"  ',
    } as Record<string, string | undefined>);
    expect(cfg.apiKey).toBe("sk-test-quoted");
  });

  it("strips surrounding single quotes from key", () => {
    const cfg = resolveGeminiConfig({
      GEMINI_API_KEY: "  'sk-test-single'  ",
    } as Record<string, string | undefined>);
    expect(cfg.apiKey).toBe("sk-test-single");
  });
});

describe("mapHttpError", () => {
  it("maps 401 → clear unauthorized message", () => {
    const err = mapHttpError(401, JSON.stringify({ error: { message: "API key not valid" } }));
    expect(err).toBeInstanceOf(AiGuardError);
    expect(err.code).toBe("unavailable");
    expect(err.message).toBe("Anmeldung bei der KI fehlgeschlagen. Bitte später erneut versuchen.");
    expect(err.message).not.toMatch(/API key not valid/i);
    expect(err.message).not.toMatch(/GEMINI_/i);
  });

  it("maps 404 → model/endpoint message", () => {
    const err = mapHttpError(404, "model not found");
    expect(err.code).toBe("unavailable");
    expect(err.message).toBe("KI-Dienst vorübergehend nicht erreichbar. Bitte später erneut versuchen.");
    expect(err.message).not.toMatch(/GEMINI_/i);
  });

  it("generic fallback is safe DE without HTTP status leak", () => {
    const err = mapHttpError(502, "bad gateway");
    expect(err.code).toBe("unavailable");
    expect(err.message).toBe("Die KI konnte nicht antworten. Bitte später erneut versuchen.");
    expect(err.message).not.toMatch(/HTTP\s*502/i);
  });

  it("maps 400 API_KEY / invalid argument without leaking body", () => {
    const err = mapHttpError(
      400,
      JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "API_KEY_INVALID secret-xyz" } }),
    );
    expect(err.message).toBe("Anmeldung bei der KI fehlgeschlagen. Bitte später erneut versuchen.");
    expect(err.message).not.toContain("secret-xyz");
    expect(err.message).not.toContain("API_KEY_INVALID");
    expect(err.message).not.toMatch(/GEMINI_/i);
  });

  it("keeps 429 as rate_limited", () => {
    const err = mapHttpError(429, "quota");
    expect(err.code).toBe("rate_limited");
  });
});

describe("extractSourcesFromGrounding", () => {
  it("maps groundingChunks web uri+title to sources", () => {
    const sources = extractSourcesFromGrounding({
      groundingChunks: [
        { web: { uri: "https://www.minijob-zentrale.de/limits", title: "Minijob-Zentrale" } },
        { web: { uri: "https://www.bmas.de/x", title: "BMAS" } },
      ],
    });
    expect(sources).toEqual([
      { url: "https://www.minijob-zentrale.de/limits", title: "Minijob-Zentrale" },
      { url: "https://www.bmas.de/x", title: "BMAS" },
    ]);
  });

  it("malformed grounding → no invented sources", () => {
    expect(extractSourcesFromGrounding(null)).toEqual([]);
    expect(extractSourcesFromGrounding(undefined)).toEqual([]);
    expect(extractSourcesFromGrounding({})).toEqual([]);
    expect(extractSourcesFromGrounding({ groundingChunks: "nope" })).toEqual([]);
    expect(
      extractSourcesFromGrounding({
        groundingChunks: [{ web: { title: "only title" } }, { notWeb: true }, null, 42],
      }),
    ).toEqual([]);
  });

  it("dedupes by uri and skips empty uri", () => {
    const sources = extractSourcesFromGrounding({
      groundingChunks: [
        { web: { uri: "https://a.example/1", title: "A" } },
        { web: { uri: "https://a.example/1", title: "A again" } },
        { web: { uri: "  ", title: "blank" } },
        { web: { uri: "https://b.example/2" } },
      ],
    });
    expect(sources).toEqual([
      { url: "https://a.example/1", title: "A" },
      { url: "https://b.example/2" },
    ]);
  });
});

describe("withGroundingUnavailableNote", () => {
  it("appends clear note without inventing sources", () => {
    const out = withGroundingUnavailableNote({ answer: "Allgemeine Info." });
    expect(out.answer).toContain("Allgemeine Info.");
    expect(out.answer).toContain(GROUNDING_UNAVAILABLE_NOTE);
    expect(out.sources).toBeUndefined();
  });
});

describe("GeminiProvider.ask (mocked fetch)", () => {
  const originalKey = process.env["GEMINI_API_KEY"];
  const originalModel = process.env["GEMINI_MODEL"];

  beforeEach(() => {
    process.env["GEMINI_API_KEY"] = "test-key-not-real";
    delete process.env["GEMINI_MODEL"];
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalKey === undefined) delete process.env["GEMINI_API_KEY"];
    else process.env["GEMINI_API_KEY"] = originalKey;
    if (originalModel === undefined) delete process.env["GEMINI_MODEL"];
    else process.env["GEMINI_MODEL"] = originalModel;
  });

  it("missing GEMINI_API_KEY → clear unavailable", async () => {
    delete process.env["GEMINI_API_KEY"];
    const provider = new GeminiProvider();
    await expect(
      provider.ask({ question: "Hallo?", context: "{}" }),
    ).rejects.toMatchObject({
      name: "AiGuardError",
      code: "unavailable",
      message: "KI ist derzeit nicht verfügbar.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("plain generateContent only — no google_search tools", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "Die Minijob-Grenze liegt aktuell bei …" }] },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = new GeminiProvider();
    const result = await provider.ask({
      question: "Wie hoch ist die Minijob-Grenze?",
      context: "{}",
      language: "Deutsch",
    });

    expect(result.answer).toContain("Minijob-Grenze");
    expect(result.sources).toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    );
    expect(init.headers).toMatchObject({ "x-goog-api-key": "test-key-not-real" });
    const body = JSON.parse(String(init.body)) as {
      tools?: unknown[];
      systemInstruction?: { parts?: Array<{ text?: string }> };
      contents?: Array<{ role?: string; parts?: unknown }>;
    };
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/google_search/);
    expect(body.systemInstruction?.parts?.[0]?.text).toMatch(/Suchergebnisse/);
    expect(body.systemInstruction?.parts?.[0]?.text).not.toMatch(/Google Search Grounding/i);
    expect(body.contents?.[0]).toEqual({
      role: "user",
      parts: [{ text: expect.stringContaining("Frage:") }],
    });
    expect(JSON.stringify(result)).not.toContain("test-key-not-real");
  });

  it("Production GEMINI_MODEL=gemini-2.5-flash remaps request URL to gemini-3.6-flash", async () => {
    process.env["GEMINI_MODEL"] = "gemini-2.5-flash";
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "OK" }] } }],
        }),
        { status: 200 },
      ),
    );

    await new GeminiProvider().ask({ question: "x", context: "{}" });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    );
  });

  it("ignores residual grounding metadata — no invented sources from Gemini", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "Du hast 12 Stunden gearbeitet." }] },
              groundingMetadata: {
                groundingChunks: [
                  { web: { uri: "https://example.com", title: "Should be ignored" } },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await new GeminiProvider().ask({
      question: "Stunden?",
      context: "{}",
    });
    expect(result.answer).toContain("12 Stunden");
    expect(result.sources).toBeUndefined();
  });

  it("maps HTTP 429 → rate_limited AiGuardError (single request, no grounding retry)", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async () => new Response("quota", { status: 429 }));

    try {
      await new GeminiProvider().ask({ question: "x", context: "{}" });
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AiGuardError);
      expect(e).toMatchObject({ code: "rate_limited" });
      expect((e as Error).message).toMatch(/Kontingent|Anfragen/i);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP 403 quota → clear free-tier/quota message", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { message: "Free tier quota exceeded" } }), {
          status: 403,
        }),
    );

    try {
      await new GeminiProvider().ask({ question: "x", context: "{}" });
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AiGuardError);
      expect((e as AiGuardError).code).toBe("unavailable");
      expect((e as Error).message).toMatch(/Kontingent/i);
      expect((e as Error).message).not.toMatch(/GEMINI_/i);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP 401 → unauthorized message via ask", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async () => new Response("unauthorized", { status: 401 }));

    await expect(new GeminiProvider().ask({ question: "x", context: "{}" })).rejects.toMatchObject({
      code: "unavailable",
      message: "Anmeldung bei der KI fehlgeschlagen. Bitte später erneut versuchen.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP 404 → model message via ask", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async () => new Response("not found", { status: 404 }));

    await expect(new GeminiProvider().ask({ question: "x", context: "{}" })).rejects.toMatchObject({
      code: "unavailable",
      message: "KI-Dienst vorübergehend nicht erreichbar. Bitte später erneut versuchen.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps other HTTP errors to safe DE message without status leak", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async () => new Response("oops", { status: 503 }));

    await expect(new GeminiProvider().ask({ question: "x", context: "{}" })).rejects.toMatchObject({
      code: "unavailable",
      message: "Die KI konnte nicht antworten. Bitte später erneut versuchen.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows duck-typed AiGuardError by name (bundle-safe)", async () => {
    const provider = new GeminiProvider();
    const duck = Object.assign(new Error("API-Schlüssel ungültig oder nicht autorisiert."), {
      name: "AiGuardError",
      code: "unavailable",
    });
    vi.spyOn(
      provider as unknown as { generate: (...args: unknown[]) => Promise<unknown> },
      "generate",
    ).mockRejectedValue(duck);

    await expect(provider.ask({ question: "x", context: "{}" })).rejects.toBe(duck);
  });

  it("timeout via AbortSignal maps to unavailable", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("no signal"));
          return;
        }
        if (signal.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });

    const controller = new AbortController();
    const pending = new GeminiProvider().ask(
      { question: "x", context: "{}" },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringMatching(/rechtzeitig/i),
    });
  });
});
