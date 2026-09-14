import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";

/** Map GoTrue auth events to the session the UI should show. */
export function sessionAfterAuthEvent(
  event: AuthChangeEvent,
  session: Session | null,
): Session | null {
  switch (event) {
    case "SIGNED_OUT":
      return null;
    case "SIGNED_IN":
    case "TOKEN_REFRESHED":
    case "USER_UPDATED":
    case "PASSWORD_RECOVERY":
    case "INITIAL_SESSION":
    case "MFA_CHALLENGE_VERIFIED":
      return session;
    default:
      return session;
  }
}

export type AuthSessionListener = (session: Session | null) => void;

/**
 * Subscribe first (so URL PKCE/implicit SIGNED_IN is not missed), then hydrate
 * from getSession for the current store.
 */
export function bindAuthSession(
  client: Pick<SupabaseClient, "auth">,
  onSession: AuthSessionListener,
): () => void {
  const { data } = client.auth.onAuthStateChange((event, session) => {
    onSession(sessionAfterAuthEvent(event, session));
  });
  void client.auth
    .getSession()
    .then(({ data: { session } }) => onSession(session))
    .catch(() => onSession(null));
  return () => data.subscription.unsubscribe();
}

/** Prefer Account after OAuth so Settings remounts with callback params present. */
export function oauthRedirectTo(origin: string = typeof window !== "undefined" ? window.location.origin : ""): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/einstellungen`;
}
