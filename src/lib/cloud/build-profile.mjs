/**
 * Build profile validation (P1) - pure functions, no I/O, no console, no dependencies except
 * the shared flag parser. Used by scripts/assert-build-profile.mjs (build gate), vite.config.ts
 * (defence in depth) and the unit tests.
 *
 * SECURITY CONTRACT: results carry variable NAMES and fixed codes only - never values.
 *
 * Profiles (ENVIRONMENT_SEPARATION section 1-4):
 *  - public-local : no cloud, no Supabase, no AI. Cloud flags must be OFF (unset / "" / "false").
 *  - cloud-enabled: cloud on explicitly. Supabase URL + publishable key + MJC_EXPECTED_SUPABASE_REF,
 *                   both cloud flags exactly "true", URL ref == expected ref.
 *  - d41-pilot    : cloud-enabled rules + isolated pilot: denied-ref list required, no service-role
 *                   key, no AI variables.
 * MJC_BUILD_PROFILE missing or unknown -> failure (no implicit default).
 */
import { classifyCloudFlag } from "./cloud-flag.mjs";

export const BUILD_PROFILES = Object.freeze(["public-local", "cloud-enabled", "d41-pilot"]);

const SUPABASE_REF_PATTERN = /^[a-z0-9]{8,40}$/;

/** Names (prefixes) that must not exist in the public-local build environment. */
const PUBLIC_LOCAL_FORBIDDEN_PREFIXES = Object.freeze([
  "VITE_SUPABASE_",
  "SUPABASE_",
  "GEMINI_",
  "VITE_GEMINI_",
  "TAVILY_",
  "VITE_TAVILY_",
]);
const PUBLIC_LOCAL_FORBIDDEN_EXACT = Object.freeze([
  "MJC_EXPECTED_SUPABASE_REF",
  "MJC_DENIED_SUPABASE_REFS",
]);
const D41_FORBIDDEN_PREFIXES = Object.freeze([
  "GEMINI_",
  "VITE_GEMINI_",
  "TAVILY_",
  "VITE_TAVILY_",
]);

/** Names with the VITE_ prefix that look like secrets (they would be baked into the bundle). */
const VITE_SECRET_NAME = /(SERVICE_ROLE|SECRET|PRIVATE|API_KEY)/i;

/** @param {Record<string, unknown>} env @param {string} name */
function has(env, name) {
  const v = env[name];
  return typeof v === "string" && v.trim().length > 0;
}

/** @param {Record<string, unknown>} env @param {string[]} prefixes @param {readonly string[]} exact */
function presentNames(env, prefixes, exact = []) {
  return Object.keys(env)
    .filter((n) => has(env, n) && (prefixes.some((p) => n.startsWith(p)) || exact.includes(n)))
    .sort();
}

/** @param {unknown} value */
function isSecretLikeValue(value) {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v.startsWith("sb_secret_")) return true;
  const parts = v.split(".");
  if (parts.length === 3 && parts[0].startsWith("eyJ")) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      return payload && payload.role === "service_role";
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Project ref from a Supabase URL (https://<ref>.supabase.co). null when it cannot be determined.
 * @param {string} url
 */
export function supabaseRefFromUrl(url) {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    if (!host.endsWith(".supabase.co")) return null;
    const ref = host.slice(0, -".supabase.co".length);
    return SUPABASE_REF_PATTERN.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {{ code: string, names: string[] }} BuildProfileError
 * @typedef {{
 *   ok: boolean,
 *   profile: string | null,
 *   errors: BuildProfileError[],
 *   notes: string[],
 *   viteEnv: Record<string, string>,
 *   bridgeSupabase: boolean
 * }} BuildProfileResult
 */

/**
 * Validate a build environment. `env` is a plain object of string values (process.env merged with
 * the .env files Vite would load).
 * @param {Record<string, unknown>} env
 * @returns {BuildProfileResult}
 */
export function validateBuildEnv(env) {
  /** @type {BuildProfileError[]} */
  const errors = [];
  /** @type {string[]} */
  const notes = [];
  const fail = (code, names) => errors.push({ code, names: [...names] });

  const rawProfile = env["MJC_BUILD_PROFILE"];
  let profile = null;
  if (typeof rawProfile !== "string" || rawProfile === "") {
    fail("PROFILE_MISSING", ["MJC_BUILD_PROFILE"]);
  } else if (BUILD_PROFILES.includes(rawProfile)) {
    profile = rawProfile;
  } else {
    fail("PROFILE_UNKNOWN", ["MJC_BUILD_PROFILE"]);
  }

  // --- all profiles: no secrets in public (VITE_*) variables, no secret-like publishable key values
  const leakNames = Object.keys(env)
    .filter((n) => n.startsWith("VITE_") && has(env, n) && VITE_SECRET_NAME.test(n))
    .sort();
  if (leakNames.length) fail("SECRET_IN_PUBLIC_VARIABLE_NAME", leakNames);
  const leakValues = [
    ...Object.keys(env).filter((n) => n.startsWith("VITE_") && isSecretLikeValue(env[n])),
    ...["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_URL"].filter((n) => isSecretLikeValue(env[n])),
  ];
  if (leakValues.length) fail("SECRET_VALUE_IN_PUBLIC_VARIABLE", [...new Set(leakValues)].sort());

  const clientRaw = env["VITE_CLOUD_SYNC_ENABLED"];
  const serverRaw = env["CLOUD_SYNC_ENABLED"];
  const clientClass = classifyCloudFlag(clientRaw);
  const serverClass = classifyCloudFlag(serverRaw);
  const aiRaw = env["AI_FEATURES_ENABLED"];
  const aiClass = classifyCloudFlag(aiRaw);

  /** @type {Record<string, string>} */
  const viteEnv = {};
  let bridgeSupabase = false;

  if (profile === "public-local") {
    const forbidden = presentNames(
      env,
      [...PUBLIC_LOCAL_FORBIDDEN_PREFIXES],
      PUBLIC_LOCAL_FORBIDDEN_EXACT,
    );
    if (forbidden.length) fail("FORBIDDEN_VARIABLE_FOR_PUBLIC_LOCAL", forbidden);
    const flagsOn = [];
    const flagsAmbiguous = [];
    if (serverClass === "on") flagsOn.push("CLOUD_SYNC_ENABLED");
    if (clientClass === "on") flagsOn.push("VITE_CLOUD_SYNC_ENABLED");
    if (serverClass === "ambiguous") flagsAmbiguous.push("CLOUD_SYNC_ENABLED");
    if (clientClass === "ambiguous") flagsAmbiguous.push("VITE_CLOUD_SYNC_ENABLED");
    if (flagsOn.length) fail("CLOUD_FLAG_ON_FORBIDDEN_IN_PUBLIC_LOCAL", flagsOn);
    if (flagsAmbiguous.length) fail("CLOUD_FLAG_AMBIGUOUS", flagsAmbiguous);
    if (aiClass === "on") fail("AI_ENABLED_FORBIDDEN_IN_PUBLIC_LOCAL", ["AI_FEATURES_ENABLED"]);
    if (aiClass === "ambiguous") fail("AI_FLAG_AMBIGUOUS", ["AI_FEATURES_ENABLED"]);
    viteEnv["VITE_CLOUD_SYNC_ENABLED"] = "false";
    notes.push("cloud=OFF; Supabase bridge disabled; AI forbidden");
  } else if (profile === "cloud-enabled" || profile === "d41-pilot") {
    // flags: both exactly "true"; classes must agree; ambiguous values rejected
    const ambiguous = [];
    if (serverClass === "ambiguous") ambiguous.push("CLOUD_SYNC_ENABLED");
    if (clientClass === "ambiguous") ambiguous.push("VITE_CLOUD_SYNC_ENABLED");
    if (ambiguous.length) {
      fail("CLOUD_FLAG_AMBIGUOUS", ambiguous);
    } else if (serverClass !== clientClass) {
      fail("CLOUD_FLAG_CLASS_MISMATCH", ["CLOUD_SYNC_ENABLED", "VITE_CLOUD_SYNC_ENABLED"]);
    } else if (serverClass !== "on") {
      fail("CLOUD_FLAG_NOT_ON", ["CLOUD_SYNC_ENABLED", "VITE_CLOUD_SYNC_ENABLED"]);
    }

    // required Supabase values (same sources as the vite.config.ts bridge)
    const urlName = has(env, "VITE_SUPABASE_URL")
      ? "VITE_SUPABASE_URL"
      : has(env, "SUPABASE_URL")
        ? "SUPABASE_URL"
        : null;
    const keyName = has(env, "VITE_SUPABASE_PUBLISHABLE_KEY")
      ? "VITE_SUPABASE_PUBLISHABLE_KEY"
      : has(env, "SUPABASE_PUBLISHABLE_KEY")
        ? "SUPABASE_PUBLISHABLE_KEY"
        : null;
    const missing = [];
    if (!urlName) missing.push("VITE_SUPABASE_URL or SUPABASE_URL");
    if (!keyName) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY or SUPABASE_PUBLISHABLE_KEY");
    if (!has(env, "MJC_EXPECTED_SUPABASE_REF")) missing.push("MJC_EXPECTED_SUPABASE_REF");
    if (profile === "d41-pilot" && !has(env, "MJC_DENIED_SUPABASE_REFS"))
      missing.push("MJC_DENIED_SUPABASE_REFS");
    if (missing.length) fail("MISSING_REQUIRED_VARIABLE", missing);

    // ref checks (names only)
    const expected = has(env, "MJC_EXPECTED_SUPABASE_REF")
      ? String(env["MJC_EXPECTED_SUPABASE_REF"]).trim()
      : null;
    if (expected !== null && !SUPABASE_REF_PATTERN.test(expected))
      fail("EXPECTED_REF_INVALID", ["MJC_EXPECTED_SUPABASE_REF"]);
    if (expected !== null && SUPABASE_REF_PATTERN.test(expected)) {
      const urlVars = ["VITE_SUPABASE_URL", "SUPABASE_URL"].filter((n) => has(env, n));
      const undetermined = urlVars.filter((n) => supabaseRefFromUrl(String(env[n])) === null);
      if (undetermined.length) fail("SUPABASE_URL_REF_UNDETERMINED", undetermined);
      const mismatched = urlVars.filter((n) => {
        const r = supabaseRefFromUrl(String(env[n]));
        return r !== null && r !== expected;
      });
      if (mismatched.length)
        fail("SUPABASE_REF_MISMATCH", [...mismatched, "MJC_EXPECTED_SUPABASE_REF"]);
      if (has(env, "MJC_DENIED_SUPABASE_REFS")) {
        const denied = String(env["MJC_DENIED_SUPABASE_REFS"])
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        if (denied.includes(expected))
          fail("SUPABASE_REF_DENIED", ["MJC_EXPECTED_SUPABASE_REF", "MJC_DENIED_SUPABASE_REFS"]);
      }
    }

    if (profile === "d41-pilot") {
      if (has(env, "SUPABASE_SERVICE_ROLE_KEY"))
        fail("SERVICE_ROLE_FORBIDDEN_IN_PILOT_BUILD", ["SUPABASE_SERVICE_ROLE_KEY"]);
      const ai = presentNames(env, [...D41_FORBIDDEN_PREFIXES]);
      if (ai.length) fail("AI_VARIABLE_FORBIDDEN_IN_PILOT", ai);
      if (aiClass === "on") fail("AI_ENABLED_FORBIDDEN_IN_PILOT", ["AI_FEATURES_ENABLED"]);
      if (aiClass === "ambiguous") fail("AI_FLAG_AMBIGUOUS", ["AI_FEATURES_ENABLED"]);
    }

    viteEnv["VITE_CLOUD_SYNC_ENABLED"] = "true";
    bridgeSupabase = true;
    if (urlName)
      notes.push(`supabase url source=${urlName} length=${String(env[urlName]).trim().length}`);
    if (keyName)
      notes.push(`supabase key source=${keyName} length=${String(env[keyName]).trim().length}`);
    notes.push("cloud=ON (flags exact); ref check applied");
  }

  return { ok: errors.length === 0, profile, errors, notes, viteEnv, bridgeSupabase };
}

/**
 * Validate process.env together with the .env file views (see env-files.mjs). process.env wins over
 * files (Vite precedence). For public-local EVERY file layered under process.env must be clean on
 * its own, so a risky value hidden by a higher-priority file in one Vite mode is still rejected.
 * @param {Record<string, unknown>} processEnv
 * @param {Record<string, unknown>[]} fileViews
 * @returns {BuildProfileResult}
 */
export function validateBuildEnvAcrossViews(processEnv, fileViews) {
  const merged = Object.assign({}, ...fileViews, processEnv);
  const main = validateBuildEnv(merged);
  if (main.profile !== "public-local") return main;
  const errors = [...main.errors];
  for (const view of fileViews) {
    const r = validateBuildEnv({
      ...view,
      ...processEnv,
      MJC_BUILD_PROFILE: merged["MJC_BUILD_PROFILE"],
    });
    for (const e of r.errors) {
      if (!errors.some((x) => x.code === e.code && x.names.join("|") === e.names.join("|")))
        errors.push(e);
    }
  }
  return { ...main, ok: errors.length === 0, errors };
}

/**
 * Values for process.env that vite.config.ts must set for a VALID result (flag from the profile;
 * SUPABASE_* -> VITE_* bridge only for cloud profiles, exactly as before for empty VITE_*).
 * @param {Record<string, unknown>} env
 * @param {BuildProfileResult} result
 * @returns {Record<string, string>}
 */
export function computeViteEnvOverrides(env, result) {
  if (!result.ok) return {};
  /** @type {Record<string, string>} */
  const out = { ...result.viteEnv };
  if (result.bridgeSupabase) {
    if (!has(env, "VITE_SUPABASE_URL") && has(env, "SUPABASE_URL"))
      out["VITE_SUPABASE_URL"] = String(env["SUPABASE_URL"]).trim();
    if (!has(env, "VITE_SUPABASE_PUBLISHABLE_KEY") && has(env, "SUPABASE_PUBLISHABLE_KEY")) {
      out["VITE_SUPABASE_PUBLISHABLE_KEY"] = String(env["SUPABASE_PUBLISHABLE_KEY"]).trim();
    }
  }
  return out;
}

/**
 * Decision used by vite.config.ts. With an explicit MJC_BUILD_PROFILE (process.env or any .env
 * file) the full validation runs and an invalid configuration THROWS (names only); the result
 * carries the process.env overrides to apply. Without a profile (editor `vite dev`) nothing is
 * enforced here (the `build` script's gate stops builds without a profile) and the legacy
 * SUPABASE_* -> VITE_* bridge applies.
 * @param {Record<string, unknown>} processEnv
 * @param {Record<string, unknown>[]} fileViews
 * @returns {{ kind: "legacy" } | { kind: "profile", profile: string, overrides: Record<string, string> }}
 */
export function resolveViteBuildProfile(processEnv, fileViews) {
  const merged = Object.assign({}, ...fileViews, processEnv);
  const declared = merged["MJC_BUILD_PROFILE"];
  if (typeof declared !== "string" || declared.trim() === "") return { kind: "legacy" };
  const result = validateBuildEnvAcrossViews(processEnv, fileViews);
  if (!result.ok) {
    throw new Error(
      `vite.config: build profile check failed (names only): ${formatBuildProfileFailure(result).join("; ")}`,
    );
  }
  return {
    kind: "profile",
    profile: String(result.profile),
    overrides: computeViteEnvOverrides(merged, result),
  };
}

/**
 * Human-readable failure text: codes and variable NAMES only.
 * @param {BuildProfileResult} result
 * @returns {string[]}
 */
export function formatBuildProfileFailure(result) {
  return result.errors.map((e) => `${e.code}: ${e.names.join(", ")}`);
}
