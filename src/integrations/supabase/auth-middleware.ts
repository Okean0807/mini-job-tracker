// Server auth middleware for TanStack Start server functions (e.g. KI askAssistant).
// Env resolution accepts VITE_SUPABASE_* (independent Vercel) or SUPABASE_* (Lovable / SSR).
import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'
import { resolveSupabasePublicEnv } from './public-env'



/** Closed set of reasons for the sanitised auth-failure log line (never tokens, headers or user ids). */
export type AuthFailureReason =
  | "no_request"
  | "no_header"
  | "bad_scheme"
  | "no_token"
  | "bad_token_format"
  | "claims_invalid"
  | "no_sub";

/**
 * Logs one allowlisted event, then returns the unchanged error to throw. Logging can never
 * replace or hide the original error.
 */
function unauthorized(reason: AuthFailureReason, message: string): Error {
  try {
    console.warn(
      JSON.stringify({
        event: "ai.auth.failed",
        stage: "app_auth",
        outcome: "unauthorized",
        cause: "app_auth",
        reason,
      }),
    );
  } catch {
    // Diagnostics must never change the response.
  }
  return new Error(message);
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_');
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    // New Supabase API keys are opaque strings, not bearer JWTs.
    if (isNewSupabaseApiKey(supabaseKey) && headers.get('Authorization') === `Bearer ${supabaseKey}`) {
      headers.delete('Authorization');
    }

    headers.set('apikey', supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

export const requireSupabaseAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    // Same public env chain as the browser client — VITE_* alone is enough on Vercel.
    const { url: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY } =
      resolveSupabasePublicEnv();
    
    const request = getRequest();

    if (!request?.headers) {
      throw unauthorized("no_request", "Unauthorized: No request headers available");
    }

    const authHeader = request.headers.get('authorization');

    if (!authHeader) {
      throw unauthorized("no_header", "Unauthorized: No authorization header provided");
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw unauthorized("bad_scheme", "Unauthorized: Only Bearer tokens are supported");
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      throw unauthorized("no_token", "Unauthorized: No token provided");
    }

    if (token.split('.').length !== 3) {
      throw unauthorized("bad_token_format", "Unauthorized: Invalid token");
    }

    const supabase = createClient<Database>(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        global: {
          fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        auth: {
          storage: undefined,
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims) {
      throw unauthorized("claims_invalid", "Unauthorized: Invalid token");
    }

    if (!data.claims.sub) {
      throw unauthorized("no_sub", "Unauthorized: No user ID found in token");
    }

    return next({
      context: {
        supabase,
        userId: data.claims.sub,
        claims: data.claims,
      },
    });
  },
);
