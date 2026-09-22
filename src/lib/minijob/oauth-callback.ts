/**
 * OAuth callback inspection.
 *
 * supabase-js exchanges `?code=` itself (detectSessionInUrl) and cleans the URL
 * on success. When the exchange fails — lost PKCE verifier (other browser app,
 * cleared storage, partitioned embed) or a provider error — nothing happens at
 * all: no session, no message, `?code=` stays in the address bar and a reload
 * retries the same dead code. These helpers let the UI report that instead.
 */

/** Params belonging to the OAuth round trip; removed once it is settled. */
export const OAUTH_CALLBACK_PARAMS = [
  "code",
  "state",
  "error",
  "error_code",
  "error_description",
  "sb_flow_id",
] as const;

export type OAuthCallbackInfo = {
  /** Provider sent an authorization code that supabase-js has to exchange. */
  hasCode: boolean;
  /** Provider reported a failure (access_denied, …). */
  error: string | null;
  description: string | null;
};

export function readOAuthCallback(search: string): OAuthCallbackInfo {
  const params = new URLSearchParams(search);
  const error = params.get("error") ?? params.get("error_code");
  return {
    hasCode: params.has("code"),
    error: error && error.length > 0 ? error : null,
    description: params.get("error_description"),
  };
}

/** Same URL without the OAuth round-trip params (keeps every other param). */
export function stripOAuthParams(href: string): string {
  const url = new URL(href);
  for (const param of OAUTH_CALLBACK_PARAMS) url.searchParams.delete(param);
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

/**
 * After the grace period: a code that produced no session is a failed sign-in.
 * `loading` is not a verdict — the exchange may still be in flight.
 */
export function isFailedOAuthCallback(
  info: OAuthCallbackInfo,
  authStatus: "loading" | "signed_in" | "signed_out",
): boolean {
  if (info.error) return true;
  if (!info.hasCode) return false;
  return authStatus === "signed_out";
}

/** How long supabase-js may take to exchange the code before we report failure. */
export const OAUTH_EXCHANGE_GRACE_MS = 8000;
