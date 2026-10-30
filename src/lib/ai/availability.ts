/**
 * Client-side view of the server flag. Anything that is not an explicit `{ enabled: true }`
 * answer (loading, network error, malformed response) is treated as "AI unavailable".
 */
export type AiAvailability = "loading" | "enabled" | "disabled";

export function resolveAiAvailability(result: unknown): "enabled" | "disabled" {
  if (
    typeof result === "object" &&
    result !== null &&
    (result as { enabled?: unknown }).enabled === true
  ) {
    return "enabled";
  }
  return "disabled";
}

/** The AI entry in the bottom navigation is shown only once the server confirmed the feature. */
export function isNavItemAvailable(to: string, availability: AiAvailability): boolean {
  return to !== "/assistent" || availability === "enabled";
}
