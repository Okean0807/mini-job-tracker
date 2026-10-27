import { describe, expect, it, vi } from "vitest";

import {
  formatWebResultsForContext,
  OrchestratingAIProvider,
  sourcesFromWebResults,
  WEB_RESULTS_CONTEXT_PREFACE,
  WEB_SEARCH_NOT_CONFIGURED_NOTE,
  WEB_SEARCH_QUOTA_NOTE,
} from "./orchestrator";
import { GROUNDING_UNAVAILABLE_NOTE } from "./gemini-provider";
import type { AIProvider, AskRequest, AskResponse } from "./types";
import type { WebSearchProvider } from "./web-search/provider";
import type { WebSearchOutcome } from "./web-search/types";

function stubLlm(answer = "LLM Antwort"): AIProvider {
  return {
    ask: vi.fn(async (req: AskRequest): Promise<AskResponse> => ({
      answer: `${answer} | ctx:${req.context.slice(0, 80)}`,
    })),
  };
}

function stubSearch(outcome: WebSearchOutcome): WebSearchProvider {
  return {
    search: vi.fn(async () => outcome),
  };
}

describe("formatWebResultsForContext / sourcesFromWebResults", () => {
  it("formats snippets with tier labels and maps sources", () => {
    const results = [
      {
        title: "Minijob-Zentrale",
        url: "https://www.minijob-zentrale.de/",
        snippet: "Grenze 556",
        tier: 1 as const,
        score: 135,
      },
    ];
    const formatted = formatWebResultsForContext(results);
    expect(formatted).toContain("Suchergebnisse:");
    expect(formatted).toContain("Tier1-offiziell");
    expect(formatted).toContain("https://www.minijob-zentrale.de/");
    expect(sourcesFromWebResults(results)).toEqual([
      { url: "https://www.minijob-zentrale.de/", title: "Minijob-Zentrale" },
    ]);
  });

  it("uses sourceDisplayLabel fallback when title empty", () => {
    const results = [
      {
        title: "",
        url: "https://www.bmas.de/minijob",
        snippet: "x",
      },
    ];
    expect(sourcesFromWebResults(results)[0]?.title).toBe("www.bmas.de");
  });
});

describe("OrchestratingAIProvider", () => {
  it("skips web search for pure arithmetic", async () => {
    const llm = stubLlm();
    const webSearch = stubSearch({ ok: true, results: [] });
    const orch = new OrchestratingAIProvider({ llm, webSearch });
    const out = await orch.ask({
      question: "Berechne 10 Stunden × 12 Euro",
      context: "{}",
    });
    expect(webSearch.search).not.toHaveBeenCalled();
    expect(llm.ask).toHaveBeenCalledTimes(1);
    expect(out.answer).toContain("LLM Antwort");
    expect(out.answer).not.toContain("Web-Prüfung");
  });

  it("searches with rewritten query, ranks results, prefers official sources", async () => {
    const llm = stubLlm("Geprüft");
    const webSearch = stubSearch({
      ok: true,
      results: [
        {
          title: "Facebook Post",
          url: "https://www.facebook.com/minijob",
          snippet: "Grenze angeblich 700",
        },
        {
          title: "BMAS",
          url: "https://www.bmas.de/minijob",
          snippet: "Aktuelle Grenze Minijob",
        },
        {
          title: "Minijob-Zentrale",
          url: "https://www.minijob-zentrale.de/",
          snippet: "Verdienstgrenze offiziell",
        },
      ],
    });
    const orch = new OrchestratingAIProvider({ llm, webSearch });
    const out = await orch.ask({
      question: "Wie hoch ist die Minijob-Grenze 2026?",
      context: '{"hours":10,"earnings":120}',
    });

    expect(webSearch.search).toHaveBeenCalledTimes(1);
    const searchCall = (webSearch.search as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(searchCall).toBeDefined();
    const searchQuery = searchCall![0] as string;
    expect(searchQuery).toMatch(/Deutschland/i);
    expect(searchCall![1]).toMatchObject({
      includeDomains: expect.arrayContaining(["minijob-zentrale.de"]),
    });

    expect(llm.ask).toHaveBeenCalledTimes(1);
    const llmCall = (llm.ask as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(llmCall).toBeDefined();
    const llmReq = llmCall![0] as AskRequest;
    expect(llmReq.context).toContain("Suchergebnisse:");
    expect(llmReq.context).toContain(WEB_RESULTS_CONTEXT_PREFACE);
    expect(llmReq.context).toContain("Tier1-offiziell");
    expect(llmReq.context).toContain("https://www.bmas.de/minijob");
    expect(llmReq.context).not.toContain("facebook.com");
    expect(out.sources?.some((s) => s.url.includes("bmas.de") || s.url.includes("minijob-zentrale"))).toBe(
      true,
    );
    expect(out.sources?.every((s) => !s.url.includes("facebook.com"))).toBe(true);
    expect(out.answer).not.toContain("Web-Prüfung ist momentan nicht verfügbar");
  });

  it("quota exhaustion → Gemini without web + Free Tier note (no upgrade)", async () => {
    const llm = stubLlm("Ohne Web");
    const webSearch = stubSearch({
      ok: false,
      reason: "quota_exhausted",
      message: "Web-Suche-Kontingent (Free Tier) aufgebraucht.",
    });
    const orch = new OrchestratingAIProvider({ llm, webSearch });
    const out = await orch.ask({
      question: "Aktuelle Minijob-Grenze?",
      context: "{}",
    });
    expect(out.answer).toContain("Ohne Web");
    expect(out.answer).toContain(WEB_SEARCH_QUOTA_NOTE);
    expect(out.answer).not.toMatch(/upgrade|billing|paygo/i);
    expect(out.sources).toBeUndefined();
    const llmCall = (llm.ask as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(llmCall).toBeDefined();
    const llmReq = llmCall![0] as AskRequest;
    expect(llmReq.context).not.toContain("Suchergebnisse:");
  });

  it("missing key → separate 'not configured' note, no secret or variable names, marker set", async () => {
    const llm = stubLlm("Allgemein");
    const webSearch = stubSearch({
      ok: false,
      reason: "missing_key",
      message: "key missing",
    });
    const orch = new OrchestratingAIProvider({ llm, webSearch });
    const out = await orch.ask({
      question: "Was gilt gesetzlich für Minijobs?",
      context: "{}",
    });
    expect(out.answer).toContain(WEB_SEARCH_NOT_CONFIGURED_NOTE);
    expect(out.answer).not.toContain(GROUNDING_UNAVAILABLE_NOTE);
    expect(WEB_SEARCH_NOT_CONFIGURED_NOTE).toMatch(/nicht konfiguriert/);
    expect(WEB_SEARCH_NOT_CONFIGURED_NOTE).toMatch(/gespeicherten Daten und dem Modellwissen/);
    expect(WEB_SEARCH_NOT_CONFIGURED_NOTE).not.toMatch(/TAVILY|KEY|API|secret/i);
    expect(out.searchUnavailable).toBe("missing_key");
    expect(out.sources).toBeUndefined();
  });

  it.each(["rate_limited", "network", "unavailable"] as const)(
    "%s → generic grounding note + marker",
    async (reason) => {
      const llm = stubLlm("Allgemein");
      const webSearch = stubSearch({ ok: false, reason, message: "x" });
      const orch = new OrchestratingAIProvider({ llm, webSearch });
      const out = await orch.ask({ question: "Was gilt gesetzlich für Minijobs?", context: "{}" });
      expect(out.answer).toContain(GROUNDING_UNAVAILABLE_NOTE);
      expect(out.answer).not.toContain(WEB_SEARCH_NOT_CONFIGURED_NOTE);
      expect(out.searchUnavailable).toBe(reason);
    },
  );

  it("quota exhaustion carries the marker", async () => {
    const webSearch = stubSearch({ ok: false, reason: "quota_exhausted", message: "x" });
    const orch = new OrchestratingAIProvider({ llm: stubLlm(), webSearch });
    const out = await orch.ask({ question: "Aktuelle Minijob-Grenze?", context: "{}" });
    expect(out.answer).toContain(WEB_SEARCH_QUOTA_NOTE);
    expect(out.searchUnavailable).toBe("quota_exhausted");
  });

  it("non-abort error thrown by the search → generic note + marker 'unavailable'", async () => {
    const webSearch: WebSearchProvider = {
      search: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const orch = new OrchestratingAIProvider({ llm: stubLlm("Antwort"), webSearch });
    const out = await orch.ask({ question: "Aktuelle Minijob-Grenze?", context: "{}" });
    expect(out.answer).toContain("Antwort");
    expect(out.answer).toContain(GROUNDING_UNAVAILABLE_NOTE);
    expect(out.searchUnavailable).toBe("unavailable");
  });

  it("abort errors from the search are still rethrown", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const webSearch: WebSearchProvider = {
      search: vi.fn(async () => {
        throw abort;
      }),
    };
    const llm = stubLlm();
    const orch = new OrchestratingAIProvider({ llm, webSearch });
    await expect(
      orch.ask({ question: "Aktuelle Minijob-Grenze?", context: "{}" }),
    ).rejects.toBe(abort);
    expect(llm.ask).not.toHaveBeenCalled();
  });

  it("own-data question never touches the search provider", async () => {
    const webSearch = stubSearch({ ok: false, reason: "missing_key", message: "x" });
    const orch = new OrchestratingAIProvider({ llm: stubLlm(), webSearch });
    const out = await orch.ask({ question: "Wie viel habe ich diesen Monat verdient?", context: "{}" });
    expect(webSearch.search).not.toHaveBeenCalled();
    expect(out.searchUnavailable).toBeUndefined();
    expect(out.answer).not.toContain("Web-Prüfung");
  });

  it("empty search results → unavailable note (never pretend current-checked)", async () => {
    const llm = stubLlm("Leer");
    const webSearch = stubSearch({ ok: true, results: [] });
    const orch = new OrchestratingAIProvider({ llm, webSearch });
    const out = await orch.ask({
      question: "Mindestlohn aktuell?",
      context: "{}",
    });
    expect(out.answer).toContain(GROUNDING_UNAVAILABLE_NOTE);
    expect(out.sources).toBeUndefined();
    expect(out.searchUnavailable).toBeUndefined();
  });
});
