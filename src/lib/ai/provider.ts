import { AiGuardError } from "@/lib/ai-guard";
import { AI_DISABLED_MESSAGE, isAiFeatureEnabled } from "@/lib/ai/feature-flag";
import { OrchestratingAIProvider } from "@/lib/ai/orchestrator";
import type { AIProvider } from "@/lib/ai/types";

export type { AIProvider } from "@/lib/ai/types";

/**
 * Default KI provider:
 * - Tavily Free = primary WebSearchProvider (current-info questions)
 * - Gemini 3.6 Flash = reasoning only (no Google Search grounding)
 */
export function createDefaultProvider(): AIProvider {
  // Second line of defence behind askAssistant: no provider object exists while the AI is off.
  if (!isAiFeatureEnabled()) throw new AiGuardError("unavailable", AI_DISABLED_MESSAGE);
  return new OrchestratingAIProvider();
}
