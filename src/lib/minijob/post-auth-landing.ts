import { OAUTH_RETURN_PATH, type AuthSessionStatus } from "./auth-session";

/**
 * Where the user lands after Google sign-in.
 *
 * The OAuth provider returns to OAUTH_RETURN_PATH (`/einstellungen`, the redirect URL
 * that is known to be allowed). Before leaving the app the sign-in helper leaves a short
 * lived marker in sessionStorage; once the session and the first profile restore are
 * settled, the app moves the user to `/`. The marker is removed first, so the move
 * happens at most once and can never loop.
 */
export const OAUTH_LANDING_KEY = "minijob-oauth-landing-v1";

/** A marker older than this belongs to an abandoned sign-in and is ignored. */
export const OAUTH_LANDING_MAX_AGE_MS = 15 * 60 * 1000;

export function markOAuthLanding(now: number = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(OAUTH_LANDING_KEY, String(now));
  } catch {
    /* private mode: the user then stays on the return page (old behaviour) */
  }
}

export function clearOAuthLanding(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(OAUTH_LANDING_KEY);
  } catch {
    /* ignore */
  }
}

/** True while a sign-in started in this tab and has not been settled yet. */
export function isOAuthLandingPending(now: number = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(OAUTH_LANDING_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at) || now - at > OAUTH_LANDING_MAX_AGE_MS || at > now + 60_000) {
      window.sessionStorage.removeItem(OAUTH_LANDING_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export type PostAuthLandingDecision = "wait" | "go-home" | "clear";

/**
 * Pure decision for a pending marker.
 * - auth unknown or first profile restore still running → wait (no early redirect)
 * - signed out (sign-in cancelled or failed) → clear the marker, stay
 * - signed in on the OAuth return page → go home; on any other page → just clear
 */
export function resolvePostAuthLanding(input: {
  authStatus: AuthSessionStatus;
  pathname: string;
  restorePending: boolean;
}): PostAuthLandingDecision {
  if (input.authStatus === "loading") return "wait";
  if (input.authStatus === "signed_out") return "clear";
  if (input.restorePending) return "wait";
  return input.pathname === OAUTH_RETURN_PATH ? "go-home" : "clear";
}
