import {
  GeminiProvider,
  GROUNDING_UNAVAILABLE_NOTE,
  withGroundingUnavailableNote,
} from "@/lib/ai/gemini-provider";
import { sourceDisplayLabel } from "@/lib/ai/sources";
import type { AIProvider, AskRequest, AskResponse, AskSource } from "@/lib/ai/types";
import { needsCurrentInfo } from "@/lib/ai/web-search/needs-current-info";
import type { WebSearchProvider } from "@/lib/ai/web-search/provider";
import { buildTavilyQuery } from "@/lib/ai/web-search/query-strategy";
import {
  rankWebSearchResults,
  tierLabel,
  type RankedWebSearchResult,
} from "@/lib/ai/web-search/source-rank";
import {
  TavilyWebSearchProvider,
  WEB_SEARCH_QUOTA_EXHAUSTED_MESSAGE,
} from "@/lib/ai/web-search/tavily-provider";
import type { WebSearchResultItem } from "@/lib/ai/web-search/types";

/** Explicit Free-tier quota note — never mentions upgrade/billing. */
export const WEB_SEARCH_QUOTA_NOTE =
  `Hinweis: ${WEB_SEARCH_QUOTA_EXHAUSTED_MESSAGE} ` +
  "Behandle Angaben zu gesetzlichen Grenzen und aktuellem Recht als allgemeine Orientierung, nicht als verbindliche Auskunft.";

/** Context preface for Gemini when ranked web results are present. */
export const WEB_RESULTS_CONTEXT_PREFACE =
  "WEB-PRÜFUNG (verifiziert):\n" +
  "- Bevorzuge Tier1-offizielle Quellen; bei Widersprüchen zuerst offizielle Behördenquellen, dann die frischere Angabe.\n" +
  "- Nutze Social/UGC (Tier4) niemals als primäre Rechtsgrundlage.\n" +
  "- Erfinde keine URLs; nenne nur URLs aus den Suchergebnissen unten.\n" +
  "- Kennzeichne web-geprüfte Aussagen klar. Strukturiere die Antwort idealerweise so:\n" +
  "  🌐 Aktuell geprüft (oder 🔎 Aktuelle Information)\n" +
  "  📊 Deine Daten (wenn Nutzer-Stunden/Verdienst in der Datenbasis vorkommen)\n" +
  "  📈 Einschätzung\n";

/** Heuristic: context likely contains user hours/earnings JSON. */
export function contextHasUserData(context: string): boolean {
  return /hours|earnings|verdienst|stunden|entries|shifts|monthTotal|hourlyRate/i.test(
    context,
  );
}

/** Format ranked Tavily hits for Gemini context injection (with tier labels). */
export function formatWebResultsForContext(
  results: RankedWebSearchResult[] | WebSearchResultItem[],
): string {
  if (results.length === 0) return "";
  const lines = results.map((r, i) => {
    const title = r.title.trim() || r.url;
    const snippet = r.snippet.trim();
    const tier =
      "tier" in r && typeof r.tier === "number"
        ? tierLabel(r.tier as RankedWebSearchResult["tier"])
        : "Tier3-sekundär";
    return `${i + 1}. [${tier}] ${title}\n${r.url}${snippet ? `\n${snippet}` : ""}`;
  });
  return `Suchergebnisse:\n${lines.join("\n\n")}`;
}

export function sourcesFromWebResults(
  results: WebSearchResultItem[] | RankedWebSearchResult[],
): AskSource[] {
  const seen = new Set<string>();
  const sources: AskSource[] = [];
  for (const r of results) {
    const url = r.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const rawTitle = r.title.trim();
    const title =
      rawTitle && rawTitle !== url
        ? rawTitle
        : sourceDisplayLabel(rawTitle ? { url, title: rawTitle } : { url });
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
    response.answer.includes("Web-Prüfung ist momentan nicht verfügbar") ||
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
 * Thin orchestrator: Tavily Free for current-info search → rank → Gemini reasoning only.
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

    const plan = buildTavilyQuery(req.question);

    let searchOutcome;
    try {
      searchOutcome = await this.webSearch.search(plan.query, {
        ...(opts?.signal ? { signal: opts.signal } : {}),
        includeDomains: plan.includeDomains,
      });
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

    const ranked = rankWebSearchResults(searchOutcome.results, plan.query);
    if (ranked.length === 0) {
      const response = await this.llm.ask(req, opts);
      return withGroundingUnavailableNote(response);
    }

    const formatted = formatWebResultsForContext(ranked);
    const userDataHint = contextHasUserData(req.context)
      ? "\n(Nutzerdaten vorhanden — Abschnitt 📊 Deine Daten einbeziehen.)\n"
      : "\n";
    const enrichedContext = `${req.context}\n\n${WEB_RESULTS_CONTEXT_PREFACE}${userDataHint}${formatted}`;

    const response = await this.llm.ask(
      {
        question: req.question,
        context: enrichedContext,
        ...(req.language ? { language: req.language } : {}),
      },
      opts,
    );

    const sources = sourcesFromWebResults(ranked);
    if (sources.length === 0) {
      return withGroundingUnavailableNote(response);
    }

    return { answer: response.answer, sources };
  }
}
