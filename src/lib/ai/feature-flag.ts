/**
 * Server-side kill switch for every external AI provider (Gemini, Tavily).
 *
 * `AI_FEATURES_ENABLED` is the single source of truth. The feature is on only for the exact
 * value "true"; unset, empty, "TRUE", "1" or anything else means off (fail closed).
 * The client never reads this variable — it asks `getAiStatus` (src/lib/ai-status.functions.ts).
 */
export const AI_DISABLED_MESSAGE = "Die KI ist in dieser Version vorübergehend nicht verfügbar.";

export function isAiFeatureEnabled(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return env["AI_FEATURES_ENABLED"] === "true";
}
