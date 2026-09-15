import type { WebSearchOutcome } from "@/lib/ai/web-search/types";

/** Server-side web search for current legal/factual checks. */
export interface WebSearchProvider {
  search(query: string, opts?: { signal?: AbortSignal }): Promise<WebSearchOutcome>;
}
