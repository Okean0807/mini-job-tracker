import { z } from "zod";

/**
 * Feedback (Fehler melden / Verbesserung vorschlagen / App bewerten).
 *
 * Gemeinsame Regeln für Client und Server – der Server verlässt sich NIE auf die
 * Client-Prüfung. Bewusst minimal: nur Text, Art, Bewertung und vier technische Felder.
 * `.strict()` lehnt jedes weitere Feld ab (z. B. Schichten, Sicherungen, Tokens).
 */
export const FEEDBACK_KINDS = ["bug", "idea", "rating"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const MAX_FEEDBACK_CHARS = 2000;
/** Fehler/Ideen brauchen einen aussagekräftigen Text; eine reine Bewertung nicht. */
export const MIN_FEEDBACK_CHARS = 3;
export const FEEDBACK_LANGS = ["de", "en", "ru", "tr", "pl"] as const;

/** Nur Pfad, nie Query/Hash (können Kennungen enthalten). */
const ROUTE_RE = /^\/[a-z0-9_\-/]{0,63}$/;
const VERSION_RE = /^[A-Za-z0-9._+-]{1,32}$/;

export const feedbackSchema = z
  .object({
    /** Vom Client pro Formular erzeugt; macht Wiederholungen idempotent. */
    submissionId: z.string().uuid(),
    kind: z.enum(FEEDBACK_KINDS),
    message: z.string().max(MAX_FEEDBACK_CHARS),
    rating: z.number().int().min(1).max(5).optional(),
    appVersion: z.string().regex(VERSION_RE),
    lang: z.enum(FEEDBACK_LANGS),
    route: z.string().regex(ROUTE_RE),
  })
  .strict()
  .superRefine((value, ctx) => {
    const text = value.message.trim();
    if (value.kind === "rating") {
      if (value.rating === undefined) {
        ctx.addIssue({ code: "custom", path: ["rating"], message: "rating-required" });
      }
    } else {
      if (value.rating !== undefined) {
        ctx.addIssue({ code: "custom", path: ["rating"], message: "rating-not-allowed" });
      }
      if (text.length < MIN_FEEDBACK_CHARS) {
        ctx.addIssue({ code: "custom", path: ["message"], message: "message-required" });
      }
    }
  });

export type FeedbackInput = z.infer<typeof feedbackSchema>;

export class FeedbackError extends Error {
  readonly code: "invalid" | "rate_limited" | "unavailable" | "unauthenticated" | "forbidden";
  readonly retryAfterSeconds: number;

  constructor(code: FeedbackError["code"], retryAfterSeconds = 0) {
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
): { code: FeedbackError["code"]; retry: number } | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const m = /feedback:(invalid|rate_limited|unavailable|unauthenticated|forbidden):(\d+)/.exec(
    message,
  );
  return m ? { code: m[1] as FeedbackError["code"], retry: Number(m[2]) } : null;
}
