import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ASK_GATEWAY_TIMEOUT_MESSAGE,
  ASK_GATEWAY_TIMEOUT_MS,
  isAbortOrTimeoutError,
} from "@/lib/ai-ask";
import { AiGuardError, parseAskAssistantInput } from "@/lib/ai-guard";
import { createDefaultProvider } from "@/lib/ai/provider";
import type { AskRequest } from "@/lib/ai/types";

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseAskAssistantInput(input))
  .handler(async ({ data, context }) => {
    // Shared DB-backed rate limit: serverless instances no longer keep separate Maps.
    const { data: rate, error: rateError } = await context.supabase.rpc(
      "consume_ai_rate_limit" as never,
      { p_user_id: context.userId } as never,
    );
    if (rateError) {
      // Fail closed when the security control cannot be evaluated.
      throw new AiGuardError("unavailable", "Die KI ist vorübergehend nicht verfügbar.");
    }
    const rateRow = Array.isArray(rate) ? rate[0] : rate;
    if (!rateRow?.allowed) {
      const retry = Number(rateRow?.retry_after_seconds ?? 1);
      throw new AiGuardError(
        "rate_limited",
        `Zu viele KI-Anfragen. Bitte in ${Math.max(1, retry)} Sekunden erneut versuchen.`,
      );
    }

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
