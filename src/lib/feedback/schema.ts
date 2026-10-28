import { z } from "zod";

/**
 * Feedback = eine Textnachricht an den Betreiber (E-Mail). Gemeinsame Regeln für Client und Server;
 * der Server verlässt sich NIE auf die Client-Prüfung. `.strict()` lehnt jedes weitere Feld ab
 * (z. B. Empfänger, Schichten, Sicherungen, Tokens) – der Empfänger kommt ausschließlich aus der
 * Server-Konfiguration.
 */
export const MAX_FEEDBACK_CHARS = 2000;
export const MIN_FEEDBACK_CHARS = 3;
export const FEEDBACK_LANGS = ["de", "en", "ru", "tr", "pl"] as const;

/** Nur Pfad, nie Query/Hash (können Kennungen enthalten). */
const ROUTE_RE = /^\/[a-z0-9_\-/]{0,63}$/;
const VERSION_RE = /^[A-Za-z0-9._+-]{1,32}$/;

/** Steuerzeichen außer Zeilenumbruch/Tab entfernen, CRLF vereinheitlichen. */
export function cleanMessage(value: string): string {
  return (
    value
      .replace(/\r\n?/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .trim()
  );
}

export const feedbackSchema = z
  .object({
    /** Vom Client pro Formular erzeugt; dient als Idempotenzschlüssel bei Wiederholungen. */
    submissionId: z.string().uuid(),
    message: z
      .string()
      .max(MAX_FEEDBACK_CHARS)
      .refine((m) => cleanMessage(m).length >= MIN_FEEDBACK_CHARS, "message-required"),
    appVersion: z.string().regex(VERSION_RE),
    lang: z.enum(FEEDBACK_LANGS),
    route: z.string().regex(ROUTE_RE),
  })
  .strict();

export type FeedbackInput = z.infer<typeof feedbackSchema>;

export type FeedbackErrorCode =
  "invalid" | "rate_limited" | "unavailable" | "unauthenticated" | "forbidden";

export class FeedbackError extends Error {
  readonly code: FeedbackErrorCode;
  readonly retryAfterSeconds: number;

  constructor(code: FeedbackErrorCode, retryAfterSeconds = 0) {
    // Maschinenlesbar, ohne interne Details; der Client übersetzt in Nutzertexte.
    super(`feedback:${code}:${retryAfterSeconds}`);
    this.name = "FeedbackError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function parseFeedbackInput(input: unknown): FeedbackInput {
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) throw new FeedbackError("invalid");
  return parsed.data;
}

/** Fehlercode aus einer (ggf. über das Netz rekonstruierten) Fehlermeldung lesen. */
export function readFeedbackError(
  error: unknown,
): { code: FeedbackErrorCode; retry: number } | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const m = /feedback:(invalid|rate_limited|unavailable|unauthenticated|forbidden):(\d+)/.exec(
    message,
  );
  return m ? { code: m[1] as FeedbackErrorCode, retry: Number(m[2]) } : null;
}
