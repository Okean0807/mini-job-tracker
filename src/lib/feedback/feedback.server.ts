import { createHmac } from "node:crypto";

import { getRequest } from "@tanstack/react-start/server";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { handleFeedback, type FeedbackResult } from "./handler";

/** Nur auf dem Server laden (siehe feedback.functions.ts). */
function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  // HMAC mit dem serverseitigen Schlüssel: die IP wird nicht im Klartext gespeichert
  // und lässt sich aus dem Schlüssel nicht zurückrechnen.
  const secret = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
  return createHmac("sha256", secret).update(`feedback:${ip}`).digest("hex").slice(0, 32);
}

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
    clientKey: clientKey(getRequest()),
    log: (event, fields) => console.warn(`[${event}]`, JSON.stringify(fields)),
  });
}
