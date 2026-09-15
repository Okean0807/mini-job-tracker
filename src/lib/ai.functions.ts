import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ASK_GATEWAY_TIMEOUT_MESSAGE,
  ASK_GATEWAY_TIMEOUT_MS,
  isAbortOrTimeoutError,
} from "@/lib/ai-ask";
import { AiGuardError, assertRateLimit, parseAskAssistantInput } from "@/lib/ai-guard";
import { createDefaultProvider } from "@/lib/ai/provider";
import type { AskRequest } from "@/lib/ai/types";

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseAskAssistantInput(input))
  .handler(async ({ data, context }) => {
    // Rate-Limit strikt pro authentifiziertem Nutzer (userId stammt aus dem verifizierten Token).
    assertRateLimit(context.userId);

    const provider = createDefaultProvider();
    const signal = AbortSignal.timeout(ASK_GATEWAY_TIMEOUT_MS);

    const req: AskRequest = {
      question: data.question,
      context: data.context,
    };
    if (data.language) req.language = data.language;

    try {
      const result = await provider.ask(req, { signal });
      if (result.sources && result.sources.length > 0) {
        return { answer: result.answer, sources: result.sources };
      }
      return { answer: result.answer };
    } catch (error) {
      if (error instanceof AiGuardError) throw error;
      // Netzwerk-/Timeout-/Provider-Details bleiben serverseitig, nach außen nur eine generische Meldung.
      if (isAbortOrTimeoutError(error)) {
        throw new AiGuardError("unavailable", ASK_GATEWAY_TIMEOUT_MESSAGE);
      }
      throw new AiGuardError("unavailable", "Die KI konnte nicht antworten.");
    }
  });
