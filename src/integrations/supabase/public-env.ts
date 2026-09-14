/**
 * Resolve public Supabase URL + publishable key for the browser client bake
 * and SSR / server-fn auth (KI middleware).
 * Empty strings are treated as missing (common when Vercel lists the var but
 * the build-time value is blank).
 */

/** Trim; empty / whitespace-only → undefined. */
export function envString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export type SupabasePublicEnv = {
  url: string;
  publishableKey: string;
};

/** Accurate missing-config message (deployment-agnostic). */
export function missingSupabasePublicEnvMessage(missing: string[]): string {
  return (
    `Missing Supabase environment variable(s): ${missing.join(", ")}. ` +
    `Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY ` +
    `(or SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY) in your deployment environment.`
  );
}

/**
 * Prefer static Vite `import.meta.env.VITE_*` (build-time bake), then
 * `process.env.VITE_*`, then `process.env.SUPABASE_*` (SSR / bridge).
 * Literal keys (dot or bracket) so Vite can replace them at build time.
 */
export function resolveSupabasePublicEnv(): SupabasePublicEnv {
  const url =
    envString(import.meta.env["VITE_SUPABASE_URL"]) ||
    envString(typeof process !== "undefined" ? process.env["VITE_SUPABASE_URL"] : undefined) ||
    envString(typeof process !== "undefined" ? process.env["SUPABASE_URL"] : undefined);

  const publishableKey =
    envString(import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]) ||
    envString(
      typeof process !== "undefined" ? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] : undefined,
    ) ||
    envString(
      typeof process !== "undefined" ? process.env["SUPABASE_PUBLISHABLE_KEY"] : undefined,
    );

  if (!url || !publishableKey) {
    const missing = [
      ...(!url ? ["VITE_SUPABASE_URL (or SUPABASE_URL)"] : []),
      ...(!publishableKey ? ["VITE_SUPABASE_PUBLISHABLE_KEY (or SUPABASE_PUBLISHABLE_KEY)"] : []),
    ];
    const message = missingSupabasePublicEnvMessage(missing);
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return { url, publishableKey };
}
