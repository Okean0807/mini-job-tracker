/**
 * Runtime accessors for the cloud flags. (Named *-runtime so the bundler never confuses it with
 * the shared parser cloud-flag.mjs.) They use the same parser as the build-time profile
 * check (cloud-flag.mjs), so build and runtime can never disagree about what counts as ON.
 *
 * P1 only introduces the flags; call sites (client guards, server middleware) arrive in P2/P2b/P3.
 */
import { combineCloudFlags, parseCloudFlag } from "./cloud-flag.mjs";

export { classifyCloudFlag, combineCloudFlags, parseCloudFlag } from "./cloud-flag.mjs";
export type { CloudFlagClass } from "./cloud-flag.mjs";

/** Client flag baked at build time (vite.config.ts sets VITE_CLOUD_SYNC_ENABLED from the profile). */
export function isClientCloudSyncEnabled(
  raw: unknown = import.meta.env["VITE_CLOUD_SYNC_ENABLED"],
): boolean {
  return parseCloudFlag(raw);
}

/** Server flag (read from the server environment at runtime). */
export function isServerCloudSyncEnabled(
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
): boolean {
  return parseCloudFlag(env["CLOUD_SYNC_ENABLED"]);
}

/** Cloud is usable only when both sides are exactly "true" (PRT-144). */
export function isCloudSyncEnabled(clientRaw?: unknown, serverRaw?: unknown): boolean {
  const client = clientRaw === undefined ? import.meta.env["VITE_CLOUD_SYNC_ENABLED"] : clientRaw;
  const server =
    serverRaw === undefined
      ? typeof process === "undefined"
        ? undefined
        : process.env["CLOUD_SYNC_ENABLED"]
      : serverRaw;
  return combineCloudFlags(client, server);
}
