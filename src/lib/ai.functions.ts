import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ASK_GATEWAY_TIMEOUT_MESSAGE,
  ASK_GATEWAY_TIMEOUT_MS,
  isAbortOrTimeoutError,
} from "@/lib/ai-ask";
import { AiGuardError, parseAskAssistantInput } from "@/lib/ai-guard";
import { type PrivacyGateCode, checkAiPrivacy } from "@/lib/ai/health-privacy-gate";
import { createDefaultProvider } from "@/lib/ai/provider";
import type { AIProvider, AskRequest, AskResponse } from "@/lib/ai/types";

type ParsedAskInput = ReturnType<typeof parseAskAssistantInput>;
type RateLimitRow = { allowed?: boolean | null; retry_after_seconds?: number | null };
type RpcResult = { data: unknown; error: unknown };

/** The slice of the Supabase client askAssistant needs (the rate-limit RPC). */
export type AskRateLimitClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): { abortSignal(signal: AbortSignal): PromiseLike<RpcResult> };
};

export type AskAssistantResult =
  AskResponse | { answer: string; blocked: true; code: PrivacyGateCode };

export type AskDiagStage = "rate_limit" | "provider";

export type AskAssistantDeps = {
  createProvider?: () => AIProvider;
  /** One deadline for the whole server-side ask (rate-limit RPC + provider). */
  createDeadline?: () => AbortSignal;
  now?: () => number;
  /** Receives one privacy-safe line per failed ask: stage, outcome, elapsed ms only. */
  log?: (line: string) => void;
};

function defaultLog(line: string): void {
  console.warn(line);
}

/**
 * Server-side ask. Order: privacy gate -> deadline -> rate-limit RPC -> provider.
 * The deadline starts before the RPC and is passed to it, so the server finishes
 * (answer or a specific error) inside the client's 35 s window instead of
 * spending up to RPC time + 30 s and losing the race to the client timeout.
 */
export async function runAskAssistant(
  data: ParsedAskInput,
  context: { supabase: AskRateLimitClient; userId: string },
  deps: AskAssistantDeps = {},
): Promise<AskAssistantResult> {
  // L1 privacy gate: runs BEFORE the rate-limit RPC and BEFORE any provider
  // (Gemini / Tavily) call. Scans question AND client-built context; the
  // server does not trust the client context (malformed/unknown shape fails
  // closed). On block nothing leaves the server; only the reason code is logged.
  const gate = checkAiPrivacy({ question: data.question, context: data.context });
  if (!gate.allowed) {
    console.warn(`[ai] request blocked by privacy gate: ${gate.code}/${gate.reason}`);
    return { answer: gate.message, blocked: true as const, code: gate.code };
  }

  const now = deps.now ?? (() => performance.now());
  const startedAt = now();
  const signal = deps.createDeadline?.() ?? AbortSignal.timeout(ASK_GATEWAY_TIMEOUT_MS);
  const log = deps.log ?? defaultLog;

  // Only fixed identifiers and a duration — never the question, context, answer, user id or error text.
  const fail = (stage: AskDiagStage, outcome: string, error: AiGuardError): AiGuardError => {
    try {
      log(
        JSON.stringify({
          event: "ai.ask.failed",
          stage,
          outcome,
          elapsedMs: Math.max(0, Math.round(now() - startedAt)),
        }),
      );
    } catch {
      // Diagnostics must never change the response.
    }
    return error;
  };

  // Shared DB-backed rate limit: serverless instances no longer keep separate Maps.
  const { data: rate, error: rateError } = await context.supabase
    .rpc("consume_ai_rate_limit", { p_user_id: context.userId })
    .abortSignal(signal);
  if (rateError) {
    if (signal.aborted) {
      throw fail(
        "rate_limit",
        "timeout",
        new AiGuardError("unavailable", ASK_GATEWAY_TIMEOUT_MESSAGE),
      );
    }
    // Fail closed when the security control cannot be evaluated.
    throw fail(
      "rate_limit",
      "rpc_error",
      new AiGuardError("unavailable", "Die KI ist vorübergehend nicht verfügbar."),
    );
  }
  const rateRows = rate as RateLimitRow[] | RateLimitRow | null | undefined;
  const rateRow = Array.isArray(rateRows) ? rateRows[0] : rateRows;
  if (!rateRow?.allowed) {
    const retry = Number(rateRow?.retry_after_seconds ?? 1);
    throw new AiGuardError(
      "rate_limited",
      `Zu viele KI-Anfragen. Bitte in ${Math.max(1, retry)} Sekunden erneut versuchen.`,
    );
  }

  const provider = (deps.createProvider ?? createDefaultProvider)();
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
    const timedOut =
      isAbortOrTimeoutError(error) ||
      (error instanceof AiGuardError && error.message === ASK_GATEWAY_TIMEOUT_MESSAGE);
    if (error instanceof AiGuardError) {
      throw fail("provider", timedOut ? "timeout" : error.code, error);
    }
    // Netzwerk-/Timeout-/Provider-Details bleiben serverseitig, nach außen nur eine generische Meldung.
    if (timedOut) {
      throw fail(
        "provider",
        "timeout",
        new AiGuardError("unavailable", ASK_GATEWAY_TIMEOUT_MESSAGE),
      );
    }
    throw fail(
      "provider",
      "error",
      new AiGuardError("unavailable", "Die KI konnte nicht antworten."),
    );
  }
}

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseAskAssistantInput(input))
  .handler(async ({ data, context }) =>
    runAskAssistant(data, {
      supabase: context.supabase as unknown as AskRateLimitClient,
      userId: context.userId,
    }),
  );
