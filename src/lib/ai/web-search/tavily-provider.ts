import type { WebSearchProvider } from "@/lib/ai/web-search/provider";
import type {
  WebSearchFailure,
  WebSearchOutcome,
  WebSearchResultItem,
} from "@/lib/ai/web-search/types";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

/** Preferred DE official / government domains — boost only (never hard-filter). */
export const TAVILY_PREFERRED_DOMAINS = [
  "minijob-zentrale.de",
  "bmas.de",
  "gesetze-im-internet.de",
  "bundesregierung.de",
  "destatis.de",
] as const;

export const WEB_SEARCH_QUOTA_EXHAUSTED_MESSAGE =
  "Web-Suche-Kontingent (Free Tier) aufgebraucht. Eine aktuelle Web-Prüfung ist derzeit nicht verfügbar.";

export const WEB_SEARCH_KEY_INVALID_MESSAGE =
  "Web-Suche-Schlüssel ungültig oder nicht konfiguriert. Eine aktuelle Web-Prüfung ist derzeit nicht verfügbar.";

export const WEB_SEARCH_RATE_LIMITED_MESSAGE =
  "Web-Suche vorübergehend rate-begrenzt. Eine aktuelle Web-Prüfung ist derzeit nicht verfügbar.";

export const WEB_SEARCH_UNAVAILABLE_MESSAGE =
  "Web-Suche vorübergehend nicht verfügbar. Eine aktuelle Web-Prüfung ist derzeit nicht möglich.";

/** Strip surrounding quotes often introduced by env paste mistakes. */
function normalizeEnvSecret(raw: string): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

/** Resolve TAVILY_API_KEY (server-only). Never log the key. */
export function resolveTavilyApiKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env["TAVILY_API_KEY"];
  if (typeof raw !== "string") return undefined;
  const normalized = normalizeEnvSecret(raw);
  return normalized ? normalized : undefined;
}

type TavilyApiResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
};

type TavilySearchResponse = {
  results?: TavilyApiResult[];
};

function failure(reason: WebSearchFailure["reason"], message: string): WebSearchFailure {
  return { ok: false, reason, message };
}

/** Map Tavily HTTP status → soft failure (never suggest upgrade/billing). */
export function mapTavilyHttpError(status: number): WebSearchFailure {
  if (status === 401) {
    return failure("unavailable", WEB_SEARCH_KEY_INVALID_MESSAGE);
  }
  if (status === 429) {
    return failure("rate_limited", WEB_SEARCH_RATE_LIMITED_MESSAGE);
  }
  // 432 = plan/key limit, 433 = paygo — treat as Free-tier exhausted; never mention upgrade.
  if (status === 432 || status === 433) {
    return failure("quota_exhausted", WEB_SEARCH_QUOTA_EXHAUSTED_MESSAGE);
  }
  return failure("unavailable", WEB_SEARCH_UNAVAILABLE_MESSAGE);
}

export function mapTavilyResults(raw: unknown): WebSearchResultItem[] {
  if (!raw || typeof raw !== "object") return [];
  const results = (raw as TavilySearchResponse).results;
  if (!Array.isArray(results)) return [];

  const seen = new Set<string>();
  const out: WebSearchResultItem[] = [];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const snippet = typeof item.content === "string" ? item.content.trim() : "";
    out.push({ title: title || url, url, snippet });
  }
  return out;
}

type SearchBodyOptions = {
  withDomainBoost: boolean;
};

function buildSearchBody(query: string, opts: SearchBodyOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    query,
    search_depth: "basic", // 1 credit — never auto_parameters (can force advanced)
    max_results: 5,
    include_answer: false,
    include_raw_content: false,
    country: "germany",
    language: "de",
  };
  if (opts.withDomainBoost) {
    body["include_domains"] = [...TAVILY_PREFERRED_DOMAINS];
    body["include_domains_mode"] = "boost";
  }
  return body;
}

export class TavilyWebSearchProvider implements WebSearchProvider {
  async search(query: string, opts?: { signal?: AbortSignal }): Promise<WebSearchOutcome> {
    const apiKey = resolveTavilyApiKey();
    if (!apiKey) {
      return failure("missing_key", WEB_SEARCH_KEY_INVALID_MESSAGE);
    }

    const q = query.trim();
    if (!q) {
      return failure("unavailable", WEB_SEARCH_UNAVAILABLE_MESSAGE);
    }

    // Prefer boost of DE official domains; on 400 (unsupported/invalid) retry without filter.
    const first = await this.postSearch(apiKey, buildSearchBody(q, { withDomainBoost: true }), opts?.signal);
    if (first.kind === "http" && first.status === 400) {
      return this.finalize(
        await this.postSearch(apiKey, buildSearchBody(q, { withDomainBoost: false }), opts?.signal),
      );
    }
    return this.finalize(first);
  }

  private finalize(
    result:
      | { kind: "ok"; json: unknown }
      | { kind: "http"; status: number }
      | { kind: "network" }
      | { kind: "abort"; error: unknown },
  ): WebSearchOutcome {
    if (result.kind === "abort") throw result.error;
    if (result.kind === "network") {
      return failure("network", WEB_SEARCH_UNAVAILABLE_MESSAGE);
    }
    if (result.kind === "http") {
      return mapTavilyHttpError(result.status);
    }
    const items = mapTavilyResults(result.json);
    return { ok: true, results: items };
  }

  private async postSearch(
    apiKey: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<
    | { kind: "ok"; json: unknown }
    | { kind: "http"; status: number }
    | { kind: "network" }
    | { kind: "abort"; error: unknown }
  > {
    let response: Response;
    try {
      const init: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      };
      if (signal) init.signal = signal;
      response = await fetch(TAVILY_SEARCH_URL, init);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        return { kind: "abort", error };
      }
      return { kind: "network" };
    }

    if (!response.ok) {
      // Drain body without leaking secrets into logs/UI.
      try {
        await response.text();
      } catch {
        /* ignore */
      }
      return { kind: "http", status: response.status };
    }

    try {
      const json: unknown = await response.json();
      return { kind: "ok", json };
    } catch {
      return { kind: "network" };
    }
  }
}
