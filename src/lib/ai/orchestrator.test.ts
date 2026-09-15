import { describe, expect, it, vi } from "vitest";

import {
  formatWebResultsForContext,
  OrchestratingAIProvider,
  sourcesFromWebResults,
  WEB_SEARCH_QUOTA_NOTE,
} from "./orchestrator";
import { GROUNDING_UNAVAILABLE_NOTE } from "./gemini-provider";
import type { AIProvider, AskRequest, AskResponse } from "./types";
import type { WebSearchProvider } from "./web-search/provider";
import type { WebSearchOutcome } from "./web-search/types";

function stubLlm(answer = "LLM Antwort"): AIProvider {
  return {
    ask: vi.fn(async (req: AskRequest): Promise<AskResponse> => ({
      answer: `${answer} | ctx:${req.context.slice(0, 40)}`,
    })),
  };
}

function stubSearch(outcome: WebSearchOutcome): WebSearchProvider {
  return {
    search: vi.fn(async () => outcome),
  };
}

describe("formatWebResultsForContext / sourcesFromWebResults", () => {
  it("formats snippets and maps sources", () => {
    const results = [
      {
        title: "Minijob-Zentrale",
        url: "https://www.minijob-zentrale.de/",
        snippet: "Grenze 556",
      },
    ];
    expect(formatWebResultsForContext(results)).toContain("Suchergebnisse:");
    expect(formatWebResultsForContext(results)).toContain("https://www.minijob-zentrale.de/");
    expect(sourcesFromWebResults(results)).toEqual([
      { url: "https://www.minijob-zentrale.de/", title: "Minijob-Zentrale" },
    ]);
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

  it("searches then injects results and returns Tavily sources", async () => {
    const llm = stubLlm("Geprüft");
    const webSearch = stubSearch({
      ok: true,
      results: [
        {
          title: "BMAS",
          url: "https://www.bmas.de/minijob",
          snippet: "Aktuelle Grenze",
        },
      ],
    });
    const orch = new OrchestratingAIProvider({ llm, webSearch });
    const out = await orch.ask({
      question: "Wie hoch ist die Minijob-Grenze 2026?",
      context: '{"hours":10}',
    });

    expect(webSearch.search).toHaveBeenCalledTimes(1);
    expect(llm.ask).toHaveBeenCalledTimes(1);
    const llmCall = (llm.ask as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(llmCall).toBeDefined();
    const llmReq = llmCall![0] as AskRequest;
    expect(llmReq.context).toContain("Suchergebnisse:");
    expect(llmReq.context).toContain("https://www.bmas.de/minijob");
    expect(out.sources).toEqual([{ url: "https://www.bmas.de/minijob", title: "BMAS" }]);
    expect(out.answer).not.toContain("Web-Prüfung ist vorübergehend nicht verfügbar");
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

  it("missing key / unavailable search → GROUNDING_UNAVAILABLE_NOTE", async () => {
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
    expect(out.answer).toContain(GROUNDING_UNAVAILABLE_NOTE);
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
  });
});
