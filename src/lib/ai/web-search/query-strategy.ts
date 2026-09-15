/**
 * Rewrite DE legal questions into clearer Tavily search strings
 * and pick topic-based preferred domain boosts (never hard filters).
 */

import { TAVILY_PREFERRED_DOMAINS } from "@/lib/ai/web-search/tavily-provider";

export type TavilyQueryPlan = {
  /** Rewritten search string for Tavily. */
  query: string;
  /** Domain boost list (include_domains + boost mode). */
  includeDomains: string[];
};

const MINIJOB_DOMAINS = [
  "minijob-zentrale.de",
  "bmas.de",
  "deutsche-rentenversicherung.de",
  "gkv-spitzenverband.de",
  "gesetze-im-internet.de",
] as const;

const MINDESTLOHN_DOMAINS = [
  "mindestlohnkommission.de",
  "bmas.de",
  "bundesregierung.de",
  "gesetze-im-internet.de",
] as const;

const STEUER_DOMAINS = [
  "bundesfinanzministerium.de",
  "bmas.de",
  "gesetze-im-internet.de",
  "minijob-zentrale.de",
] as const;

const SV_DOMAINS = [
  "deutsche-rentenversicherung.de",
  "gkv-spitzenverband.de",
  "bmas.de",
  "minijob-zentrale.de",
] as const;

const YEAR_RE = /\b(20\d{2})\b/;

function uniqueDomains(domains: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of domains) {
    const key = d.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

function detectTopicDomains(question: string): string[] {
  const q = question.toLowerCase();

  if (
    /mindestlohn|lohnuntergrenze|mindest\-?lohnkommission/.test(q)
  ) {
    return [...MINDESTLOHN_DOMAINS];
  }
  if (
    /steuer|pauschal|finanzamt|lohnsteuer|umsatzsteuer|einkommensteuer/.test(q)
  ) {
    return [...STEUER_DOMAINS];
  }
  if (
    /sozialversicherung|\bsv\b|krankenversicherung|rentenversicherung|beitragssatz|gkv|drv/.test(
      q,
    )
  ) {
    return [...SV_DOMAINS];
  }
  if (
    /minijob|midi[- ]?job|verdienstgrenze|entgeltgrenze|geringfügig|geringfuegig|450|520|538|556/.test(
      q,
    )
  ) {
    return [...MINIJOB_DOMAINS];
  }

  return [...TAVILY_PREFERRED_DOMAINS];
}

/**
 * Build a clearer Tavily query + topic-based include_domains boost list.
 * Boost only — caller must keep include_domains_mode=boost (never hard filter).
 */
export function buildTavilyQuery(question: string): TavilyQueryPlan {
  let q = question.trim().replace(/\s+/g, " ");
  if (!q) {
    return { query: "", includeDomains: [...TAVILY_PREFERRED_DOMAINS] };
  }

  const yearMatch = q.match(YEAR_RE);
  const year = yearMatch?.[1];

  // Append Deutschland when missing (DE legal context).
  if (!/deutschland|germany|\bde\b/i.test(q)) {
    q = `${q} Deutschland`;
  }

  // Ensure year token is present when the question mentioned one
  // (already in q if matched; no-op) — if none, leave as-is.
  void year;

  // Light rewrite: strip conversational fluff that hurts search.
  q = q
    .replace(/^(hallo|hi|hey|bitte|kannst du|könntest du|sag mir|erkläre|erkläre mir)\s+/gi, "")
    .replace(/\?+$/g, "")
    .trim();

  if (year && !q.includes(year)) {
    q = `${q} ${year}`;
  }

  const includeDomains = uniqueDomains(detectTopicDomains(question));
  return { query: q || question.trim(), includeDomains };
}
