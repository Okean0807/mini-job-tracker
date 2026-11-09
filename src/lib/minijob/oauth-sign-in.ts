import type { Provider } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { oauthRedirectTo } from "@/lib/minijob/auth-session";
import { clearOAuthLanding, markOAuthLanding } from "@/lib/minijob/post-auth-landing";

/** Social OAuth providers exposed by the product (Google only). */
export type OAuthProvider = "google";

/**
 * Start OAuth via the linked Supabase project (PKCE).
 * Must NOT use Lovable's `/~oauth/initiate` broker — that route only exists on
 * Lovable hosting and 404s on Vercel (app NotFound).
 *
 * redirectTo defaults to `/einstellungen` (the allowed redirect URL). A landing marker is set
 * before leaving the app so the user is moved to `/` after the return (post-auth-landing.ts);
 * it is removed again if the sign-in cannot start.
 * Apple Sign-In has been removed from the product surface.
 */
export async function signInWithOAuthProvider(
  provider: OAuthProvider,
  redirectTo: string = oauthRedirectTo(),
): Promise<{ error: Error | null }> {
  markOAuthLanding();
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: provider as Provider,
      options: {
        redirectTo,
        skipBrowserRedirect: false,
      },
    });
    if (error) {
      clearOAuthLanding();
      return { error };
    }
    return { error: null };
  } catch (error) {
    clearOAuthLanding();
    throw error;
  }
}
