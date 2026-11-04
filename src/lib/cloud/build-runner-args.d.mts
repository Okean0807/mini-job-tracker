export type BuildRunnerArgs = { ok: true; mode: string | null } | { ok: false; code: string };
export function parseBuildRunnerArgs(argv: readonly string[]): BuildRunnerArgs;
