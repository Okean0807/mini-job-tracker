import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mapTavilyHttpError,
  mapTavilyResults,
  resolveTavilyApiKey,
  TavilyWebSearchProvider,
  WEB_SEARCH_KEY_INVALID_MESSAGE,
  WEB_SEARCH_QUOTA_EXHAUSTED_MESSAGE,
  WEB_SEARCH_RATE_LIMITED_MESSAGE,
} from "./tavily-provider";

describe("resolveTavilyApiKey", () => {
  it("returns undefined for missing/blank", () => {
    expect(resolveTavilyApiKey({})).toBeUndefined();
    expect(resolveTavilyApiKey({ TAVILY_API_KEY: "  " })).toBeUndefined();
  });

  it("strips surrounding quotes", () => {
    expect(resolveTavilyApiKey({ TAVILY_API_KEY: '  "tvly-test"  ' })).toBe("tvly-test");
  });
});

describe("mapTavilyHttpError", () => {
  it("maps 401 → key message", () => {
    const f = mapTavilyHttpError(401);
    expect(f.ok).toBe(false);
    if (!f.ok) {
      expect(f.reason).toBe("unavailable");
      expect(f.message).toBe(WEB_SEARCH_KEY_INVALID_MESSAGE);
    }
  });

  it("maps 429 → rate_limited", () => {
    const f = mapTavilyHttpError(429);
    expect(f.ok).toBe(false);
    if (!f.ok) {
      expect(f.reason).toBe("rate_limited");
      expect(f.message).toBe(WEB_SEARCH_RATE_LIMITED_MESSAGE);
    }
  });

  it("maps 432/433 → quota_exhausted Free Tier message without upgrade hint", () => {
    for (const status of [432, 433]) {
      const f = mapTavilyHttpError(status);
      expect(f.ok).toBe(false);
      if (!f.ok) {
        expect(f.reason).toBe("quota_exhausted");
        expect(f.message).toBe(WEB_SEARCH_QUOTA_EXHAUSTED_MESSAGE);
        expect(f.message).toMatch(/Free Tier/i);
        expect(f.message).not.toMatch(/upgrade|billing|paygo|credit card|bezahlen|aufladen/i);
      }
    }
  });
});

describe("mapTavilyResults", () => {
  it("maps title/url/content and dedupes", () => {
    expect(
      mapTavilyResults({
        results: [
          {
            title: "Minijob-Zentrale",
            url: "https://www.minijob-zentrale.de/",
            content: "Grenze …",
          },
          {
            title: "Dup",
            url: "https://www.minijob-zentrale.de/",
            content: "x",
          },
          { title: "BMAS", url: "https://www.bmas.de/x", content: "Info" },
        ],
      }),
    ).toEqual([
      {
        title: "Minijob-Zentrale",
        url: "https://www.minijob-zentrale.de/",
        snippet: "Grenze …",
      },
      { title: "BMAS", url: "https://www.bmas.de/x", snippet: "Info" },
    ]);
  });

  it("skips malformed entries", () => {
    expect(mapTavilyResults(null)).toEqual([]);
    expect(mapTavilyResults({ results: [{ title: "no url" }, null, 1] })).toEqual([]);
  });
});

describe("TavilyWebSearchProvider.search (mocked fetch)", () => {
  const originalKey = process.env["TAVILY_API_KEY"];

  beforeEach(() => {
    process.env["TAVILY_API_KEY"] = "tvly-test-not-real";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalKey === undefined) delete process.env["TAVILY_API_KEY"];
    else process.env["TAVILY_API_KEY"] = originalKey;
  });

  it("missing key → soft unavailable (no throw)", async () => {
    delete process.env["TAVILY_API_KEY"];
    const out = await new TavilyWebSearchProvider().search("Minijob-Grenze");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("missing_key");
      expect(out.message).toBe(WEB_SEARCH_KEY_INVALID_MESSAGE);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts basic search with domain boost and Bearer auth", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Minijob-Zentrale",
              url: "https://www.minijob-zentrale.de/",
              content: "Verdienstgrenze",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const out = await new TavilyWebSearchProvider().search("Minijob-Grenze 2026");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.results).toHaveLength(1);
      expect(out.results[0]?.url).toBe("https://www.minijob-zentrale.de/");
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.tavily.com/search");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer tvly-test-not-real",
    });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body["search_depth"]).toBe("basic");
    expect(body["include_answer"]).toBe(false);
    expect(body["auto_parameters"]).toBeUndefined();
    expect(body["country"]).toBe("germany");
    expect(body["language"]).toBe("de");
    expect(body["include_domains_mode"]).toBe("boost");
    expect(body["include_domains"]).toContain("minijob-zentrale.de");
    expect(JSON.stringify(out)).not.toContain("tvly-test-not-real");
  });

  it("400 on boost → retries without domain filter", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: { error: "bad boost" } }), { status: 400 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ title: "A", url: "https://a.example/", content: "x" }],
          }),
          { status: 200 },
        ),
      );

    const out = await new TavilyWebSearchProvider().search("Grenze");
    expect(out.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body2 = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body));
    expect(body2.include_domains).toBeUndefined();
    expect(body2.include_domains_mode).toBeUndefined();
  });

  it("432 → quota_exhausted soft failure", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response("limit", { status: 432 }));
    const out = await new TavilyWebSearchProvider().search("Mindestlohn");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("quota_exhausted");
      expect(out.message).not.toMatch(/upgrade|billing/i);
    }
  });

  it("network error → soft failure", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const out = await new TavilyWebSearchProvider().search("Gesetz");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("network");
  });
});
