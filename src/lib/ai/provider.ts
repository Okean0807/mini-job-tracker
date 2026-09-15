import type { AskRequest, AskResponse } from "@/lib/ai/types";
import { GeminiProvider } from "@/lib/ai/gemini-provider";

export interface AIProvider {
  ask(req: AskRequest, opts?: { signal?: AbortSignal }): Promise<AskResponse>;
}

/** Default KI provider — Gemini 2.5 Flash with Google Search grounding. */
export function createDefaultProvider(): AIProvider {
  return new GeminiProvider();
}
