import type { Provider } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { oauthRedirectTo } from "@/lib/minijob/auth-session";

/** Social OAuth providers exposed by the product (Google only). */
export type OAuthProvider = "google";

/** Query param that asks a freshly opened top-level tab to start OAuth. */
export const OAUTH_HANDOFF_PARAM = "oauth";

/**
 * True when the app runs inside an iframe (Lovable editor preview, embeds).
 * Google answers the authorize request with `frame-ancestors 'none'`, so a
 * redirect started here replaces the embedded app with a browser error page
 * and registration dead-ends. A cross-origin `window.top` access throws —
 * that is an embed too.
 */
export function isEmbeddedContext(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

/** Same-origin URL that starts OAuth once it is open as a top-level tab. */
export function oauthHandoffUrl(
  provider: OAuthProvider,
  origin: string = typeof window !== "undefined" ? window.location.origin : "",
): string {
  return `${origin.replace(/\/$/, "")}/?${OAUTH_HANDOFF_PARAM}=${provider}`;
}

/** Was this load opened by the embed handoff above? */
export function readOAuthHandoff(search: string): OAuthProvider | null {
  const value = new URLSearchParams(search).get(OAUTH_HANDOFF_PARAM);
  return value === "google" ? "google" : null;
}

export type OAuthStartResult = {
  error: Error | null;
  /**
   * `redirect` — this document navigates to the provider.
   * `new_tab` — embedded app handed the flow to a top-level tab.
   * `blocked` — embedded app could not open that tab (popup blocker).
   */
  mode: "redirect" | "new_tab" | "blocked";
};

/**
 * Start OAuth via the linked Supabase project (PKCE).
 * Must NOT use Lovable's `/~oauth/initiate` broker — that route only exists on
 * Lovable hosting and 404s on Vercel (app NotFound).
 *
 * redirectTo defaults to the Dashboard so the wizard continues at Work Mode and
 * finishes there. Apple Sign-In has been removed from the product surface.
 */
export async function signInWithOAuthProvider(
  provider: OAuthProvider,
  redirectTo: string = oauthRedirectTo(),
): Promise<OAuthStartResult> {
  // Embedded: the provider refuses to render in a frame. Continue top-level,
  // where the PKCE verifier and the callback share one storage partition.
  if (isEmbeddedContext()) {
    const opened = window.open(oauthHandoffUrl(provider), "_blank", "noopener,noreferrer");
    return { error: null, mode: opened ? "new_tab" : "blocked" };
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: provider as Provider,
    options: {
      redirectTo,
      skipBrowserRedirect: false,
    },
  });
  if (error) return { error, mode: "redirect" };
  return { error: null, mode: "redirect" };
}
