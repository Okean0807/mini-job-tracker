export const BUILD_PROFILES: readonly ["public-local", "cloud-enabled", "d41-pilot"];
export interface BuildProfileError {
  code: string;
  names: string[];
}
export interface BuildProfileResult {
  ok: boolean;
  profile: string | null;
  errors: BuildProfileError[];
  notes: string[];
  viteEnv: Record<string, string>;
  bridgeSupabase: boolean;
}
export function supabaseRefFromUrl(url: string): string | null;
export function validateBuildEnv(env: Record<string, unknown>): BuildProfileResult;
export function computeViteEnvOverrides(
  env: Record<string, unknown>,
  result: BuildProfileResult,
): Record<string, string>;
export function formatBuildProfileFailure(result: BuildProfileResult): string[];
