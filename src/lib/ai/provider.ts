import { OrchestratingAIProvider } from "@/lib/ai/orchestrator";
import type { AIProvider } from "@/lib/ai/types";

export type { AIProvider } from "@/lib/ai/types";

/**
 * Default KI provider:
 * - Tavily Free = primary WebSearchProvider (current-info questions)
 * - Gemini 3.6 Flash = reasoning only (no Google Search grounding)
 */
export function createDefaultProvider(): AIProvider {
  return new OrchestratingAIProvider();
}
