/**
 * Resolve public Supabase URL + publishable key for the browser client bake.
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

/**
 * Prefer static Vite `import.meta.env.VITE_*` (build-time bake), then
 * `process.env.VITE_*`, then `process.env.SUPABASE_*` (SSR / bridge).
 * Literal keys (dot or bracket) so Vite can replace them at build time.
 */
export function resolveSupabasePublicEnv(): SupabasePublicEnv {
  const url =
    envString(import.meta.env['VITE_SUPABASE_URL']) ||
    envString(typeof process !== "undefined" ? process.env["VITE_SUPABASE_URL"] : undefined) ||
    envString(typeof process !== "undefined" ? process.env["SUPABASE_URL"] : undefined);

  const publishableKey =
    envString(import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY']) ||
    envString(
      typeof process !== "undefined" ? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] : undefined,
    ) ||
    envString(
      typeof process !== "undefined" ? process.env["SUPABASE_PUBLISHABLE_KEY"] : undefined,
    );

  if (!url || !publishableKey) {
    const missing = [
      ...(!url ? ["SUPABASE_URL"] : []),
      ...(!publishableKey ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(", ")}. Connect Supabase in Lovable Cloud.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return { url, publishableKey };
}
