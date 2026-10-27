/**
 * Heuristic: does this question need a live web check (limits, law, current rates)?
 * German Minijob / Arbeitsrecht assistant context.
 */

/** Legal / regulatory topics: a live check is useful whoever asks and however it is phrased. */
const LEGAL_TOPIC_RE =
  /grenze|minijob[- ]?grenze|verdienstgrenze|gesetz|mindestlohn|sozialversicherung|\brecht\b|paragraph|§|änderung|aenderung|midijob|midi[- ]?job|geringfügig|geringfuegig|beitrag|sv[- ]?pflicht|versicher|bmas|minijob[- ]?zentrale|entgeltgrenze|steuerfrei|pauschal|welche.*grenze/i;

/**
 * Time words that only say "current". Alone they are not a legal topic: "heute", "2026" or
 * "aktuell" appear in everyday questions about the user's own entries.
 */
const TIME_WORD_RE =
  /aktuell|derzeit|heute|momentan|\bneu\b|gültig|\b(?:2024|2025|2026)\b|wie hoch ist/i;

/** The question is about the user's own recorded data (first person / own hours and earnings). */
const OWN_DATA_RE =
  /\b(?:ich|mich|mir|mein\w*|unser\w*)\b|\bverdien\w*|gearbeitet|\bstunden\b|\bschicht\w*|einträge|eintraege|arbeitszeit/i;

const ARITHMETIC_RE =
  /berechne|summe|stunden?\s*[×x*·]\s*|[\d.,]+\s*(?:€|eur|euro)\s*[×x*·]|[×x*·]\s*[\d.,]+\s*(?:€|eur|euro)|wochenstunden|monatsverdienst\s*[:=]|gesamtverdienst|hochrechnen/i;

/**
 * Returns true when the question likely needs current legal/factual web verification.
 * - A legal topic (Grenze, Gesetz, Mindestlohn, …) always does, even mixed with own-data phrasing.
 * - Pure arithmetic (Stunden × Euro, berechne, Summe) without a legal topic → false.
 * - Time words (aktuell, heute, 2026, …) count only when the question is not about the user's own
 *   data ("Wie viel habe ich im Oktober 2026 verdient?" → false).
 */
export function needsCurrentInfo(question: string): boolean {
  const q = question.trim();
  if (!q) return false;

  if (LEGAL_TOPIC_RE.test(q)) return true;
  if (ARITHMETIC_RE.test(q)) return false;
  if (OWN_DATA_RE.test(q)) return false;

  return TIME_WORD_RE.test(q);
}
