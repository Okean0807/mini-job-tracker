import {
  GeminiProvider,
  GROUNDING_UNAVAILABLE_NOTE,
  withGroundingUnavailableNote,
} from "@/lib/ai/gemini-provider";
import type { AIProvider, AskRequest, AskResponse, AskSource } from "@/lib/ai/types";
import { needsCurrentInfo } from "@/lib/ai/web-search/needs-current-info";
import type { WebSearchProvider } from "@/lib/ai/web-search/provider";
import {
  TavilyWebSearchProvider,
  WEB_SEARCH_QUOTA_EXHAUSTED_MESSAGE,
} from "@/lib/ai/web-search/tavily-provider";
import type { WebSearchResultItem } from "@/lib/ai/web-search/types";

/** Explicit Free-tier quota note — never mentions upgrade/billing. */
export const WEB_SEARCH_QUOTA_NOTE =
  `Hinweis: ${WEB_SEARCH_QUOTA_EXHAUSTED_MESSAGE} ` +
  "Behandle Angaben zu gesetzlichen Grenzen und aktuellem Recht als allgemeine Orientierung, nicht als verbindliche Auskunft.";

/** Format Tavily hits for Gemini context injection. */
export function formatWebResultsForContext(results: WebSearchResultItem[]): string {
  if (results.length === 0) return "";
  const lines = results.map((r, i) => {
    const title = r.title.trim() || r.url;
    const snippet = r.snippet.trim();
    return `${i + 1}. ${title}\n${r.url}${snippet ? `\n${snippet}` : ""}`;
  });
  return `Suchergebnisse:\n${lines.join("\n\n")}`;
}

export function sourcesFromWebResults(results: WebSearchResultItem[]): AskSource[] {
  const seen = new Set<string>();
  const sources: AskSource[] = [];
  for (const r of results) {
    const url = r.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = r.title.trim();
    if (title && title !== url) {
      sources.push({ url, title });
    } else {
      sources.push({ url });
    }
  }
  return sources;
}

function withSearchUnavailableNote(response: AskResponse, note: string): AskResponse {
  if (
    response.answer.includes("Web-Prüfung ist vorübergehend nicht verfügbar") ||
    response.answer.includes("Web-Suche-Kontingent (Free Tier) aufgebraucht")
  ) {
    return response;
  }
  const answer = `${response.answer.trim()}\n\n${note}`;
  if (response.sources && response.sources.length > 0) {
    return { answer, sources: response.sources };
  }
  return { answer };
}

/**
 * Thin orchestrator: Tavily Free for current-info search → Gemini reasoning only.
 * Never uses Google Search grounding, Lovable AI, OpenAI, or paid auto-fallback.
 */
export class OrchestratingAIProvider implements AIProvider {
  private readonly llm: AIProvider;
  private readonly webSearch: WebSearchProvider;

  constructor(deps?: { llm?: AIProvider; webSearch?: WebSearchProvider }) {
    this.llm = deps?.llm ?? new GeminiProvider();
    this.webSearch = deps?.webSearch ?? new TavilyWebSearchProvider();
  }

  async ask(req: AskRequest, opts?: { signal?: AbortSignal }): Promise<AskResponse> {
    if (!needsCurrentInfo(req.question)) {
      return this.llm.ask(req, opts);
    }

    let searchOutcome;
    try {
      searchOutcome = await this.webSearch.search(req.question, opts);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw error;
      }
      const response = await this.llm.ask(req, opts);
      return withGroundingUnavailableNote(response);
    }

    if (!searchOutcome.ok) {
      const response = await this.llm.ask(req, opts);
      const note =
        searchOutcome.reason === "quota_exhausted"
          ? WEB_SEARCH_QUOTA_NOTE
          : GROUNDING_UNAVAILABLE_NOTE;
      return withSearchUnavailableNote(response, note);
    }

    const formatted = formatWebResultsForContext(searchOutcome.results);
    const enrichedContext = formatted ? `${req.context}\n\n${formatted}` : req.context;

    const response = await this.llm.ask(
      {
        question: req.question,
        context: enrichedContext,
        ...(req.language ? { language: req.language } : {}),
      },
      opts,
    );

    const sources = sourcesFromWebResults(searchOutcome.results);
    if (sources.length === 0) {
      return withGroundingUnavailableNote(response);
    }

    return { answer: response.answer, sources };
  }
}
