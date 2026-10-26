import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ASK_GATEWAY_TIMEOUT_MESSAGE,
  ASK_GATEWAY_TIMEOUT_MS,
  isAbortOrTimeoutError,
} from "@/lib/ai-ask";
import { AiGuardError, parseAskAssistantInput, safeAiDiagFields } from "@/lib/ai-guard";
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

/**
 * Closed list of `outcome` values that may appear in a diagnostics line: the AiGuardError codes,
 * the three fixed failure outcomes and the degraded markers. Nothing derived from provider or
 * user data can reach the log through this field.
 */
export const ASK_OUTCOMES = [
  "invalid_payload",
  "payload_too_large",
  "rate_limited",
  "unavailable",
  "timeout",
  "rpc_error",
  "error",
  "truncated",
  "unexpected_finish",
] as const;
export type AskOutcome = (typeof ASK_OUTCOMES)[number];

export type AskAssistantDeps = {
  createProvider?: () => AIProvider;
  /** One deadline for the whole server-side ask (rate-limit RPC + provider). */
  createDeadline?: () => AbortSignal;
  now?: () => number;
  /**
   * Receives one privacy-safe line per failed ask. Allowlisted fields only: event, stage,
   * outcome, cause, httpStatus, providerStatus, elapsedMs.
   */
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

  // Only fixed identifiers, allowlisted diagnostics and a duration — never the question, context,
  // answer, user id, provider response body or error text. A failed ask is logged only by
  // fail() and a degraded success only by the success branch below, so one request produces at
  // most one event.
  const emit = (
    event: "ai.ask.failed" | "ai.ask.degraded",
    stage: AskDiagStage,
    outcome: AskOutcome,
    diagSource: unknown,
  ): void => {
    try {
      const diag = safeAiDiagFields(diagSource);
      log(
        JSON.stringify({
          event,
          stage,
          outcome: (ASK_OUTCOMES as readonly string[]).includes(outcome) ? outcome : "error",
          ...(diag.cause ? { cause: diag.cause } : {}),
          ...(diag.httpStatus !== undefined ? { httpStatus: diag.httpStatus } : {}),
          ...(diag.providerStatus ? { providerStatus: diag.providerStatus } : {}),
          elapsedMs: Math.max(0, Math.round(now() - startedAt)),
        }),
      );
    } catch {
      // Diagnostics must never change the response.
    }
  };
  const fail = (stage: AskDiagStage, outcome: AskOutcome, error: AiGuardError): AiGuardError => {
    emit("ai.ask.failed", stage, outcome, (error as { diag?: unknown }).diag);
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
        new AiGuardError("unavailable", ASK_GATEWAY_TIMEOUT_MESSAGE, {
          cause: "rate_limit_timeout",
        }),
      );
    }
    // Fail closed when the security control cannot be evaluated.
    throw fail(
      "rate_limit",
      "rpc_error",
      new AiGuardError("unavailable", "Die KI ist vorübergehend nicht verfügbar.", {
        cause: "rate_limit_rpc_error",
      }),
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
    if (result.degraded) {
      // The user-visible wording is already part of `result.answer`; this is diagnostics only.
      emit("ai.ask.degraded", "provider", result.degraded, {
        cause:
          result.degraded === "truncated" ? "provider_truncated" : "provider_unexpected_finish",
        httpStatus: 200,
      });
    }
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
        new AiGuardError("unavailable", ASK_GATEWAY_TIMEOUT_MESSAGE, {
          cause: "provider_timeout",
        }),
      );
    }
    throw fail(
      "provider",
      "error",
      new AiGuardError("unavailable", "Die KI konnte nicht antworten.", {
        cause: "provider_error",
      }),
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
