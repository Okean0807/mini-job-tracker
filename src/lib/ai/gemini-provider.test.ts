import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiGuardError } from "@/lib/ai-guard";

import {
  extractSourcesFromGrounding,
  GeminiProvider,
  GROUNDING_UNAVAILABLE_NOTE,
  resolveGeminiConfig,
  withGroundingUnavailableNote,
} from "./gemini-provider";

describe("resolveGeminiConfig", () => {
  it("defaults model to gemini-2.5-flash", () => {
    const cfg = resolveGeminiConfig({ GEMINI_API_KEY: "k" } as Record<string, string | undefined>);
    expect(cfg.apiKey).toBe("k");
    expect(cfg.model).toBe("gemini-2.5-flash");
  });

  it("reads GEMINI_MODEL when set", () => {
    const cfg = resolveGeminiConfig({
      GEMINI_API_KEY: "k",
      GEMINI_MODEL: " gemini-2.5-pro ",
    } as Record<string, string | undefined>);
    expect(cfg.model).toBe("gemini-2.5-pro");
  });

  it("treats blank key as missing", () => {
    const cfg = resolveGeminiConfig({ GEMINI_API_KEY: "  " } as Record<string, string | undefined>);
    expect(cfg.apiKey).toBeUndefined();
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

  it("maps grounding metadata → sources via generateContent", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "Die Minijob-Grenze liegt aktuell bei …" }] },
              groundingMetadata: {
                groundingChunks: [
                  {
                    web: {
                      uri: "https://www.minijob-zentrale.de/",
                      title: "Minijob-Zentrale",
                    },
                  },
                ],
              },
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
    expect(result.sources).toEqual([
      { url: "https://www.minijob-zentrale.de/", title: "Minijob-Zentrale" },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).toContain("gemini-2.5-flash:generateContent");
    expect(init.headers).toMatchObject({ "x-goog-api-key": "test-key-not-real" });
    const body = JSON.parse(String(init.body)) as {
      tools?: unknown[];
      systemInstruction?: unknown;
    };
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.systemInstruction).toBeTruthy();
    // Never leak key in returned payload
    expect(JSON.stringify(result)).not.toContain("test-key-not-real");
  });

  it("malformed grounding in API response → answer without invented sources", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "Du hast 12 Stunden gearbeitet." }] },
              groundingMetadata: { groundingChunks: [{ broken: true }] },
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

  it("maps HTTP 429 → rate_limited AiGuardError", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(
      async () => new Response("quota", { status: 429 }),
    );

    try {
      await new GeminiProvider().ask({ question: "x", context: "{}" });
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AiGuardError);
      expect(e).toMatchObject({ code: "rate_limited" });
      expect((e as Error).message).toMatch(/Kontingent|Anfragen/i);
    }
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
      expect((e as Error).message).toMatch(/Free Tier|Kontingent/i);
    }
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

  it("grounding tool failure → still answers with unavailable note", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "google_search not available" } }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Allgemeine Orientierung." }] } }],
          }),
          { status: 200 },
        ),
      );

    const result = await new GeminiProvider().ask({ question: "Grenze?", context: "{}" });
    expect(result.answer).toContain("Allgemeine Orientierung.");
    expect(result.answer).toContain("Web-Prüfung ist vorübergehend nicht verfügbar");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
