import { createServerFn } from "@tanstack/react-start";

import { isAiFeatureEnabled } from "@/lib/ai/feature-flag";

/**
 * Public, unauthenticated, read-only: tells the UI whether the AI feature is switched on.
 * Returns a single boolean and nothing else (no keys, no config, no provider names).
 */
export const getAiStatus = createServerFn({ method: "GET" }).handler(async () => ({
  enabled: isAiFeatureEnabled(),
}));
