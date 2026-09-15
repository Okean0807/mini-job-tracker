/** Provider-neutral web search types (Tavily Free primary). */

export type WebSearchResultItem = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchFailureReason =
  | "missing_key"
  | "unavailable"
  | "rate_limited"
  | "quota_exhausted"
  | "network";

export type WebSearchSuccess = {
  ok: true;
  results: WebSearchResultItem[];
};

export type WebSearchFailure = {
  ok: false;
  reason: WebSearchFailureReason;
  /** Clear German user-facing message — never suggest billing/upgrade. */
  message: string;
};

export type WebSearchOutcome = WebSearchSuccess | WebSearchFailure;
