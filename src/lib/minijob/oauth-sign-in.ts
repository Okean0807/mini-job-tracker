import type { Provider } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { oauthRedirectTo } from "@/lib/minijob/auth-session";

/** Social OAuth providers exposed by the product (Google only). */
export type OAuthProvider = "google";

/**
 * Start OAuth via the linked Supabase project (PKCE).
 * Must NOT use Lovable's `/~oauth/initiate` broker — that route only exists on
 * Lovable hosting and 404s on Vercel (app NotFound).
 *
 * redirectTo defaults to `/einstellungen` so Account remounts with callback params.
 * Apple Sign-In has been removed from the product surface.
 */
export async function signInWithOAuthProvider(
  provider: OAuthProvider,
  redirectTo: string = oauthRedirectTo(),
): Promise<{ error: Error | null }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: provider as Provider,
    options: {
      redirectTo,
      skipBrowserRedirect: false,
    },
  });
  if (error) return { error };
  return { error: null };
}
