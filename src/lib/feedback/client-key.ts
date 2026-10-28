import { createHmac } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

import { FeedbackError } from "./schema";

/**
 * Client identity for the Feedback rate limit. Server only.
 *
 * Goals: (1) never trust a client-controlled header, (2) never put unrelated users into one
 * shared bucket, (3) never store an IP in clear text, (4) never fall back to an empty secret.
 */

/* ---------------- trusted proxy -> client IP ---------------- */

/**
 * `FEEDBACK_TRUST_PROXY`:
 *  - `vercel`: the app runs behind Vercel's edge, which (per Vercel's documentation, to be
 *    confirmed on the real deployment) sets `x-forwarded-for` itself instead of passing on a
 *    client-supplied value. Exactly one proxy hop is trusted: the RIGHTMOST entry is used, so
 *    anything a client put in front of it is ignored even if a hop appends instead of replaces.
 *  - anything else / unset: no header is trusted. There is then no reliable client identity and
 *    submissions are refused (fail closed) instead of sharing one bucket or trusting a spoofable
 *    header. This is the default.
 */
export type TrustedProxy = "vercel" | "none";

export function readTrustedProxy(value: string | undefined): TrustedProxy {
  return value?.trim().toLowerCase() === "vercel" ? "vercel" : "none";
}

function expandIPv6(ip: string): number[] | null {
  const bare = ip.split("%")[0]!; // drop zone id
  let tail: number[] = [];
  let text = bare;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(bare);
  if (v4) {
    if (!isIPv4(v4[1]!)) return null;
    const o = v4[1]!.split(".").map(Number);
    tail = [(o[0]! << 8) | o[1]!, (o[2]! << 8) | o[3]!];
    text = bare.slice(0, bare.length - v4[1]!.length) + "0:0";
  }
  const parts = text.split("::");
  if (parts.length > 2) return null;
  const toGroups = (s: string) => (s === "" ? [] : s.split(":"));
  const head = toGroups(parts[0]!);
  const rest = parts.length === 2 ? toGroups(parts[1]!) : [];
  const fill = parts.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (parts.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : Number.NaN));
  if (nums.some(Number.isNaN)) return null;
  if (v4) {
    nums[6] = tail[0]!;
    nums[7] = tail[1]!;
  }
  return nums;
}

/**
 * Normalised identity string: IPv4 as is; IPv6 reduced to its /64 network (a single subscriber
 * or site normally owns a whole /64, so per-address limits are trivially evaded by rotating
 * addresses inside it). IPv4-mapped IPv6 (::ffff:a.b.c.d) is treated as that IPv4 address.
 * Returns null for anything that is not a plain IP address.
 */
export function normalizeIp(raw: string): string | null {
  const ip = raw.trim();
  if (ip === "" || ip.length > 64) return null;
  if (isIPv4(ip)) return `v4:${ip}`;
  if (!isIPv6(ip.split("%")[0]!)) return null;
  const groups = expandIPv6(ip);
  if (!groups) return null;
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    return `v4:${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`;
  }
  return `v6:${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}`;
}

export interface HeaderReader {
  get(name: string): string | null;
}

/** Trusted client identity, or null when there is none (caller must then refuse). */
export function resolveClientIdentity(headers: HeaderReader, mode: TrustedProxy): string | null {
  if (mode !== "vercel") return null;
  const header = headers.get("x-forwarded-for");
  if (!header) return null;
  const entries = header.split(",");
  return normalizeIp(entries[entries.length - 1] ?? "");
}

/* ---------------- HMAC secret ---------------- */

export const MIN_SECRET_CHARS = 32;
export const MIN_DISTINCT_SECRET_CHARS = 12;

/**
 * `FEEDBACK_HASH_SECRET` must be at least 32 characters with at least 12 distinct characters
 * (rejects "aaaa…", "1234123412…" style placeholders). Generate with `openssl rand -hex 32`
 * (64 hex characters, 256 bits). No fallback exists: an invalid secret refuses submissions.
 */
export function isAcceptableSecret(value: string | undefined): value is string {
  if (typeof value !== "string") return false;
  const secret = value.trim();
  return secret.length >= MIN_SECRET_CHARS && new Set(secret).size >= MIN_DISTINCT_SECRET_CHARS;
}

export function deriveClientKey(identity: string, secret: string): string {
  return createHmac("sha256", secret.trim())
    .update(`feedback-client:v1:${identity}`)
    .digest("hex")
    .slice(0, 32);
}

export interface ClientKeyEnv {
  FEEDBACK_TRUST_PROXY?: string | undefined;
  FEEDBACK_HASH_SECRET?: string | undefined;
}

/**
 * Throws `FeedbackError("unavailable")` (generic to the client) when the secret is missing or
 * weak, or when no trusted client IP exists. Logs only a reason code, never a value.
 */
export function clientKeyFor(
  headers: HeaderReader,
  env: ClientKeyEnv,
  log?: (event: string, fields: Record<string, unknown>) => void,
): string {
  if (!isAcceptableSecret(env.FEEDBACK_HASH_SECRET)) {
    log?.("feedback.secret-invalid", { reason: env.FEEDBACK_HASH_SECRET ? "weak" : "missing" });
    throw new FeedbackError("unavailable");
  }
  const mode = readTrustedProxy(env.FEEDBACK_TRUST_PROXY);
  const identity = resolveClientIdentity(headers, mode);
  if (!identity) {
    log?.("feedback.no-trusted-ip", { mode });
    throw new FeedbackError("unavailable");
  }
  return deriveClientKey(identity, env.FEEDBACK_HASH_SECRET);
}
