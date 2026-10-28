import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import { handleFeedback, readMailConfig } from "./handler";
import { createRateLimiter } from "./rate-limit";
import { parseFeedbackInput } from "./schema";

/** Pro Serverinstanz (siehe rate-limit.ts: best effort, keine harte Garantie). */
const rateLimiter = createRateLimiter();
const sent = new Set<string>();

/**
 * Feedback als E-Mail an den Betreiber – nur für angemeldete Nutzer.
 *
 * - `requireSupabaseAuth` prüft das JWT serverseitig; Nutzer-ID, E-Mail und Anonym-Flag stammen aus den
 *   verifizierten Claims. Kein service_role-Schlüssel, keine Datenbank.
 * - API-Schlüssel, Empfänger und Absender kommen nur aus Server-Variablen (RESEND_API_KEY,
 *   FEEDBACK_TO_EMAIL, FEEDBACK_FROM_EMAIL) und gelangen nie in den Client-Bundle.
 */
export const submitFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseFeedbackInput(input))
  .handler(async ({ data, context }) => {
    const claims = (context.claims ?? {}) as { email?: unknown; is_anonymous?: unknown };
    return handleFeedback(data, {
      user: {
        id: context.userId,
        email: typeof claims.email === "string" ? claims.email : undefined,
        isAnonymous: claims.is_anonymous === true,
      },
      config: readMailConfig({
        RESEND_API_KEY: process.env["RESEND_API_KEY"],
        FEEDBACK_TO_EMAIL: process.env["FEEDBACK_TO_EMAIL"],
        FEEDBACK_FROM_EMAIL: process.env["FEEDBACK_FROM_EMAIL"],
      }),
      rateLimiter,
      sent,
      log: (event, fields) => console.warn(`[${event}]`, JSON.stringify(fields)),
    });
  });
