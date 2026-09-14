import type { SupabaseClientOptions } from "@supabase/supabase-js";

import { brokeredPreviewStorage } from "./previewAuthStorage";

/**
 * Browser auth options for the SPA client.
 *
 * Must use PKCE: default auth-js `flowType` is `implicit` (hash tokens). Modern
 * Supabase OAuth callbacks commonly return `?code=…`. Without a stored PKCE
 * verifier, `_isPKCECallback` is false and the session is never established —
 * Settings stays on «Sign in» after a successful Google round-trip.
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
  };
}
