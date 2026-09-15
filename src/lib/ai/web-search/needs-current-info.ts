/**
 * Heuristic: does this question need a live web check (limits, law, current rates)?
 * German Minijob / Arbeitsrecht assistant context.
 */

const CURRENT_INFO_RE =
  /grenze|minijob[- ]?grenze|verdienstgrenze|gesetz|aktuell|mindestlohn|sozialversicherung|\brecht\b|paragraph|§|änderung|aenderung|midijob|midi[- ]?job|geringfügig|geringfuegig|beitrag|sv[- ]?pflicht|versicher|bmas|minijob[- ]?zentrale|2024|2025|2026|jahresverdienst|entgeltgrenze|steuerfrei|pauschal/i;

const ARITHMETIC_RE =
  /berechne|summe|stunden?\s*[×x*·]\s*|[\d.,]+\s*(?:€|eur|euro)\s*[×x*·]|[×x*·]\s*[\d.,]+\s*(?:€|eur|euro)|wochenstunden|monatsverdienst\s*[:=]|gesamtverdienst|hochrechnen/i;

/**
 * Returns true when the question likely needs current legal/factual web verification.
 * Pure arithmetic (Stunden × Euro, berechne, Summe) without legal-current keywords → false.
 */
export function needsCurrentInfo(question: string): boolean {
  const q = question.trim();
  if (!q) return false;

  if (CURRENT_INFO_RE.test(q)) return true;

  // Explicit calc-only phrasing without legal keywords → no web search.
  if (ARITHMETIC_RE.test(q)) return false;

  return false;
}
