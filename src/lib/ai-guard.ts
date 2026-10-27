import { z } from "zod";

/**
 * Sicherheits-Guards für den KI-Endpoint:
 * - harte Payload-/Kontext-Budgets (Zod + Gesamtgröße)
 * - per-Nutzer Rate-Limit (Sliding Window, In-Memory pro Server-Instanz)
 * - kontrollierte, nutzersichere Fehlermeldungen ohne interne Details
 */

export const MAX_QUESTION_CHARS = 2000;
export const MAX_CONTEXT_CHARS = 20000;
export const MAX_LANGUAGE_CHARS = 50;
/** Gesamtbudget über alle Felder – verhindert Kosten-/Token-Missbrauch. */
export const MAX_TOTAL_CHARS = 22000;

/** Kurzfenster gegen Bursts. */
export const RATE_LIMIT_PER_MINUTE = 8;
/** Langfenster gegen Dauerlast eines einzelnen Nutzers. */
export const RATE_LIMIT_PER_HOUR = 60;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;

export const askAssistantSchema = z.object({
  question: z.string().min(1).max(MAX_QUESTION_CHARS),
  context: z.string().max(MAX_CONTEXT_CHARS),
  language: z.string().max(MAX_LANGUAGE_CHARS).optional(),
});

export type AskAssistantInput = z.infer<typeof askAssistantSchema>;

export type AiGuardCode = "invalid_payload" | "payload_too_large" | "rate_limited" | "unavailable";

/**
 * Closed set of normalised failure causes for server-side diagnostics. Never shown to
 * users; written to the structured failure log only (see ai.functions.ts).
 */
export const AI_FAILURE_CAUSES = [
  "app_auth",
  "provider_auth",
  "provider_forbidden",
  "provider_quota",
  "provider_model_not_found",
  "provider_rate_limited",
  "provider_bad_request",
  "provider_server_error",
  "provider_http_error",
  "provider_timeout",
  "provider_network",
  "provider_parse_error",
  "provider_empty",
  "provider_blocked",
  "provider_other_finish",
  "provider_truncated",
  "provider_unexpected_finish",
  "provider_error",
  "no_api_key",
  "rate_limit_rpc_error",
  "rate_limit_timeout",
  "search_missing_key",
  "search_rate_limited",
  "search_network",
  "search_unavailable",
  "search_quota_exhausted",
] as const;
export type AiFailureCause = (typeof AI_FAILURE_CAUSES)[number];

/** Provider `error.status` tokens that may be logged; anything else is reported as OTHER. */
export const AI_PROVIDER_STATUSES = [
  "INVALID_ARGUMENT",
  "FAILED_PRECONDITION",
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "RESOURCE_EXHAUSTED",
  "INTERNAL",
  "UNAVAILABLE",
  "DEADLINE_EXCEEDED",
  "OTHER",
] as const;
export type AiProviderStatus = (typeof AI_PROVIDER_STATUSES)[number];

/** Sanitised diagnostics carried by an error; every field is optional and allowlisted. */
export type AiErrorDiag = {
  cause: AiFailureCause;
  httpStatus?: number;
  providerStatus?: AiProviderStatus;
};

/**
 * Re-validates diagnostics against the allowlists (defence in depth: also protects the log
 * against duck-typed errors from another bundle). Unknown or malformed fields are dropped.
 */
export function safeAiDiagFields(diag: unknown): {
  cause?: AiFailureCause;
  httpStatus?: number;
  providerStatus?: AiProviderStatus;
} {
  if (!diag || typeof diag !== "object") return {};
  const d = diag as { cause?: unknown; httpStatus?: unknown; providerStatus?: unknown };
  const out: { cause?: AiFailureCause; httpStatus?: number; providerStatus?: AiProviderStatus } =
    {};
  if (typeof d.cause === "string" && (AI_FAILURE_CAUSES as readonly string[]).includes(d.cause)) {
    out.cause = d.cause as AiFailureCause;
  }
  if (
    typeof d.httpStatus === "number" &&
    Number.isInteger(d.httpStatus) &&
    d.httpStatus >= 100 &&
    d.httpStatus <= 599
  ) {
    out.httpStatus = d.httpStatus;
  }
  if (
    typeof d.providerStatus === "string" &&
    (AI_PROVIDER_STATUSES as readonly string[]).includes(d.providerStatus)
  ) {
    out.providerStatus = d.providerStatus as AiProviderStatus;
  }
  return out;
}

/** Fehler mit bewusst generischer, nutzersichtbarer Meldung (keine Stacks/Secrets). */
export class AiGuardError extends Error {
  readonly code: AiGuardCode;
  /** Server-side diagnostics only; never part of the user-visible message. */
  readonly diag?: AiErrorDiag;

  constructor(code: AiGuardCode, message: string, diag?: AiErrorDiag) {
    super(message);
    this.name = "AiGuardError";
    this.code = code;
    if (diag) this.diag = diag;
  }
}

/** Frage länger als MAX_QUESTION_CHARS – der Nutzer kann das selbst beheben. */
export const QUESTION_TOO_LONG_MESSAGE = `Die Frage ist zu lang (höchstens ${MAX_QUESTION_CHARS} Zeichen). Bitte kürzer formulieren.`;
/** App-Kontext bzw. Gesamtanfrage über dem Budget. */
export const PAYLOAD_TOO_LARGE_MESSAGE =
  "Anfrage zu groß – die App-Daten sind für eine KI-Anfrage zu umfangreich.";

/** Nur reine Längenüberschreitungen gelten als „zu groß“; alles andere ist ungültig. */
function sizeViolation(issues: z.ZodIssue[]): "question" | "payload" | null {
  if (issues.length === 0 || !issues.every((i) => i.code === "too_big")) return null;
  return issues.every((i) => i.path[0] === "question") ? "question" : "payload";
}

export function parseAskAssistantInput(input: unknown): AskAssistantInput {
  const parsed = askAssistantSchema.safeParse(input);
  if (!parsed.success) {
    // Keine Zod-Details nach außen geben.
    const size = sizeViolation(parsed.error.issues);
    if (size === "question") throw new AiGuardError("payload_too_large", QUESTION_TOO_LONG_MESSAGE);
    if (size === "payload") throw new AiGuardError("payload_too_large", PAYLOAD_TOO_LARGE_MESSAGE);
    throw new AiGuardError("invalid_payload", "Ungültige Anfrage.");
  }
  const data = parsed.data;
  const total = data.question.length + data.context.length + (data.language?.length ?? 0);
  if (total > MAX_TOTAL_CHARS) {
    throw new AiGuardError("payload_too_large", PAYLOAD_TOO_LARGE_MESSAGE);
  }
  return data;
}

const buckets = new Map<string, number[]>();

/** Nur für Tests: Zähler zurücksetzen. */
export function resetRateLimits(): void {
  buckets.clear();
}

export function rateLimitStatus(
  userId: string,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const recent = (buckets.get(userId) ?? []).filter((t) => now - t < HOUR_MS);

  const lastMinute = recent.filter((t) => now - t < MINUTE_MS);
  if (lastMinute.length >= RATE_LIMIT_PER_MINUTE) {
    const oldest = lastMinute[0] ?? now;
    return { allowed: false, retryAfterSeconds: retryIn(oldest, now, MINUTE_MS) };
  }
  if (recent.length >= RATE_LIMIT_PER_HOUR) {
    const oldest = recent[0] ?? now;
    return { allowed: false, retryAfterSeconds: retryIn(oldest, now, HOUR_MS) };
  }

  recent.push(now);
  buckets.set(userId, recent);
  if (buckets.size > 5000) pruneBuckets(now);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function assertRateLimit(userId: string, now: number = Date.now()): void {
  const status = rateLimitStatus(userId, now);
  if (!status.allowed) {
    throw new AiGuardError(
      "rate_limited",
      `Zu viele KI-Anfragen. Bitte in ${status.retryAfterSeconds} Sekunden erneut versuchen.`,
    );
  }
}

function retryIn(oldest: number, now: number, windowMs: number): number {
  return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
}

function pruneBuckets(now: number): void {
  for (const [key, stamps] of buckets) {
    const kept = stamps.filter((t) => now - t < HOUR_MS);
    if (kept.length === 0) buckets.delete(key);
    else buckets.set(key, kept);
  }
}
