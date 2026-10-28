import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import { handleFeedback } from "./handler";
import { parseFeedbackInput } from "./schema";

/**
 * Feedback nur für angemeldete Nutzer (Variante C2).
 *
 * - `requireSupabaseAuth` prüft das JWT serverseitig (`getClaims`) und liefert einen Supabase-Client
 *   mit publishable Key + JWT des Nutzers. Es wird KEIN service_role-Schlüssel verwendet.
 * - Der RPC `submit_feedback` bestimmt den Autor über `auth.uid()`; das Feld kommt nie aus der Anfrage.
 * - Der Client-Schutz (CSRF-Middleware, Bearer-Token) kommt aus `src/start.ts`.
 */
export const submitFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseFeedbackInput(input))
  .handler(async ({ data, context }) =>
    handleFeedback(data, {
      rpc: (fn, args) =>
        context.supabase.rpc(fn as never, args as never) as unknown as Promise<{
          data: unknown;
          error: unknown;
        }>,
      log: (event, fields) => console.warn(`[${event}]`, JSON.stringify(fields)),
    }),
  );
