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

/** Fehler mit bewusst generischer, nutzersichtbarer Meldung (keine Stacks/Secrets). */
export class AiGuardError extends Error {
  readonly code: AiGuardCode;

  constructor(code: AiGuardCode, message: string) {
    super(message);
    this.name = "AiGuardError";
    this.code = code;
  }
}

export function parseAskAssistantInput(input: unknown): AskAssistantInput {
  const parsed = askAssistantSchema.safeParse(input);
  if (!parsed.success) {
    // Keine Zod-Details nach außen geben.
    throw new AiGuardError("invalid_payload", "Ungültige Anfrage.");
  }
  const data = parsed.data;
  const total = data.question.length + data.context.length + (data.language?.length ?? 0);
  if (total > MAX_TOTAL_CHARS) {
    throw new AiGuardError("payload_too_large", "Anfrage zu groß – bitte Zeitraum einschränken.");
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
