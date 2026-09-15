import type { WebSearchOutcome } from "@/lib/ai/web-search/types";

export type WebSearchOptions = {
  signal?: AbortSignal;
  /** Optional domain boost list (never hard filter). */
  includeDomains?: string[];
};

/** Server-side web search for current legal/factual checks. */
export interface WebSearchProvider {
  search(query: string, opts?: WebSearchOptions): Promise<WebSearchOutcome>;
}
