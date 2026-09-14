import type { SupabaseClientOptions } from "@supabase/supabase-js";

import { brokeredPreviewStorage } from "./previewAuthStorage";

/**
 * Browser auth options for the SPA client.
 *
 * Must use PKCE: default auth-js `flowType` is `implicit` (hash tokens). Modern
 * Supabase OAuth callbacks return `?code=…`. Without a stored PKCE verifier,
 * `_isPKCECallback` is false and the session is never established.
 *
 * `appendPkceFlowIdToRedirects` keeps overlapping OAuth starts from overwriting
 * the wrong verifier (official Supabase PKCE "Overlapping flows" guidance).
 */
export function createBrowserAuthOptions(): NonNullable<
  SupabaseClientOptions<"public">["auth"]
> {
  return {
    storage: brokeredPreviewStorage(),
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
    experimental: {
      appendPkceFlowIdToRedirects: true,
    },
  };
}
