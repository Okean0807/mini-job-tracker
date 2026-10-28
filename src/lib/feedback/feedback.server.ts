import { getRequest } from "@tanstack/react-start/server";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { clientKeyFor } from "./client-key";
import { handleFeedback, type FeedbackResult } from "./handler";

/** Nur auf dem Server laden (siehe feedback.functions.ts). */
const log = (event: string, fields: Record<string, unknown>) =>
  console.warn(`[${event}]`, JSON.stringify(fields));

export function submitFeedbackServer(raw: unknown): Promise<FeedbackResult> {
  return handleFeedback(raw, {
    rpc: (fn, args) =>
      (
        supabaseAdmin as unknown as {
          rpc: (
            f: string,
            a: Record<string, unknown>,
          ) => Promise<{ data: unknown; error: unknown }>;
        }
      ).rpc(fn, args),
    // Erst nach der Eingabeprüfung ausgewertet; Secret und Proxy-Vertrauen kommen nur aus Server-Env.
    clientKey: () =>
      clientKeyFor(
        getRequest().headers,
        {
          FEEDBACK_TRUST_PROXY: process.env["FEEDBACK_TRUST_PROXY"],
          FEEDBACK_HASH_SECRET: process.env["FEEDBACK_HASH_SECRET"],
        },
        log,
      ),
    log,
  });
}
