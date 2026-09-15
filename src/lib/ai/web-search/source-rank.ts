import type { WebSearchResultItem } from "@/lib/ai/web-search/types";

/** Official / government primary sources (substring match on hostname). */
export const TIER1_HOST_FRAGMENTS = [
  "bmas.de",
  "minijob-zentrale.de",
  "deutsche-rentenversicherung.de",
  "gesetze-im-internet.de",
  "bundesregierung.de",
  "bundesfinanzministerium.de",
  "bundesagentur-fuer-arbeit.de",
  "arbeitsagentur.de",
  "destatis.de",
  "mindestlohnkommission.de",
  "gkv-spitzenverband.de",
  "eur-lex.europa.eu",
  "europa.eu",
] as const;

/** Trusted secondary institutions — small explicit list. */
export const TIER2_HOST_FRAGMENTS = [
  "ihk.de",
  "handwerkskammer",
  "verbraucherzentrale.de",
  "test.de", // Stiftung Warentest
] as const;

/** Low-trust social / UGC — never primary legal evidence. */
export const TIER4_HOST_FRAGMENTS = [
  "facebook.com",
  "twitter.com",
  "x.com",
  "reddit.com",
  "tiktok.com",
  "instagram.com",
  "youtube.com",
  "quora.com",
  "pinterest.com",
  "linkedin.com",
] as const;

export type SourceTier = 1 | 2 | 3 | 4;

const TIER_SCORE: Record<SourceTier, number> = {
  1: 100,
  2: 70,
  3: 40,
  4: 5,
};

/** Prefer ~3 curated hits; hard cap 4. */
export const RANKED_RESULT_LIMIT = 3;
export const RANKED_RESULT_MAX = 4;

function hostMatches(hostname: string, fragment: string): boolean {
  const h = hostname.toLowerCase();
  const f = fragment.toLowerCase();
  // Domain-like fragments (contain a dot): exact host or subdomain suffix only.
  if (f.includes(".")) {
    return h === f || h.endsWith(`.${f}`);
  }
  // Bare tokens (e.g. handwerkskammer): substring match.
  return h === f || h.includes(f);
}

/**
 * Classify a hostname into source trust tiers (1 = official … 4 = social/UGC).
 * Substring match on hostname; Tier 1 checked before Tier 4.
 */
export function classifyHostTier(hostname: string): SourceTier {
  const host = hostname.trim().toLowerCase().replace(/^www\./, "");
  if (!host) return 3;

  for (const frag of TIER1_HOST_FRAGMENTS) {
    if (hostMatches(host, frag)) return 1;
  }
  for (const frag of TIER2_HOST_FRAGMENTS) {
    if (hostMatches(host, frag)) return 2;
  }
  for (const frag of TIER4_HOST_FRAGMENTS) {
    if (hostMatches(host, frag)) return 4;
  }
  return 3;
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Split query into meaningful tokens (≥2 chars), lowercase. */
export function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function relevanceScore(item: WebSearchResultItem, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const hay = `${item.title}\n${item.snippet}\n${item.url}`.toLowerCase();
  let hits = 0;
  for (const t of tokens) {
    if (hay.includes(t)) hits += 1;
  }
  // Scale: up to ~30 for full overlap
  return Math.round((hits / tokens.length) * 30);
}

function httpsBonus(url: string): number {
  try {
    return new URL(url).protocol === "https:" ? 5 : 0;
  } catch {
    return 0;
  }
}

export type RankedWebSearchResult = WebSearchResultItem & {
  tier: SourceTier;
  score: number;
};

function scoreItem(item: WebSearchResultItem, tokens: string[]): RankedWebSearchResult {
  const hostname = hostnameFromUrl(item.url);
  const tier = classifyHostTier(hostname);
  const score = TIER_SCORE[tier] + relevanceScore(item, tokens) + httpsBonus(item.url);
  return { ...item, tier, score };
}

/**
 * Rank Tavily hits by trust tier + relevance. Returns top 2–4 (prefer 3).
 * Drops Tier-4 social results whenever any Tier 1–3 result exists.
 */
export function rankWebSearchResults(
  results: WebSearchResultItem[],
  query: string,
): RankedWebSearchResult[] {
  if (!results.length) return [];

  const tokens = queryTokens(query);
  const scored = results.map((r) => scoreItem(r, tokens));
  scored.sort((a, b) => b.score - a.score || a.tier - b.tier);

  const hasBetter = scored.some((r) => r.tier <= 3);
  const filtered = hasBetter ? scored.filter((r) => r.tier <= 3) : scored;

  // Prefer 3, never more than MAX (4), never invent extras.
  const take = Math.min(filtered.length, RANKED_RESULT_LIMIT, RANKED_RESULT_MAX);
  return filtered.slice(0, take);
}

/** Human-readable tier label for Gemini context. */
export function tierLabel(tier: SourceTier): string {
  switch (tier) {
    case 1:
      return "Tier1-offiziell";
    case 2:
      return "Tier2-vertrauenswürdig";
    case 3:
      return "Tier3-sekundär";
    case 4:
      return "Tier4-sozial/UGC";
  }
}
