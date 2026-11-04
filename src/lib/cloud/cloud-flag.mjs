/**
 * Cloud flag parsing - the ONE implementation shared by the build-time profile check
 * (scripts/assert-build-profile.mjs, vite.config.ts) and the runtime (src/lib/cloud/cloud-flag.ts).
 *
 * Rules (ENVIRONMENT_SEPARATION section 3.0):
 *  - ON  only for the exact string "true" (no trimming, no case folding).
 *  - OFF for undefined, null, "" and the exact string "false".
 *  - Everything else (TRUE, True, 1, 0, yes, no, on, " true", "true ", garbage, non-strings)
 *    is AMBIGUOUS: the runtime treats it as OFF (fail-closed), the build check rejects it so
 *    nobody believes the cloud is "on".
 *
 * Plain ESM, no dependencies, no environment access - safe to import from Node scripts and the bundle.
 */

export const CLOUD_FLAG_TRUE = "true";

/**
 * @param {unknown} raw
 * @returns {"on" | "off" | "ambiguous"}
 */
export function classifyCloudFlag(raw) {
  if (raw === undefined || raw === null) return "off";
  if (typeof raw !== "string") return "ambiguous";
  if (raw === CLOUD_FLAG_TRUE) return "on";
  if (raw === "" || raw === "false") return "off";
  return "ambiguous";
}

/**
 * Runtime decision: true ONLY for the exact string "true".
 * @param {unknown} raw
 * @returns {boolean}
 */
export function parseCloudFlag(raw) {
  return raw === CLOUD_FLAG_TRUE;
}

/**
 * Defensive layer (PRT-144): the cloud is on only if BOTH the client and the server flag are on.
 * @param {unknown} clientRaw
 * @param {unknown} serverRaw
 * @returns {boolean}
 */
export function combineCloudFlags(clientRaw, serverRaw) {
  return parseCloudFlag(clientRaw) && parseCloudFlag(serverRaw);
}
