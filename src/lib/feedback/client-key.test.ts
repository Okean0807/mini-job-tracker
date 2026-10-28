import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  clientKeyFor,
  deriveClientKey,
  isAcceptableSecret,
  normalizeIp,
  readTrustedProxy,
  resolveClientIdentity,
} from "./client-key";
import { FeedbackError } from "./schema";

const SECRET = "0123456789abcdef0123456789abcdef-feedback-secret";
const headers = (h: Record<string, string>) => ({
  get: (name: string) => h[name.toLowerCase()] ?? null,
});

describe("trusted proxy configuration", () => {
  it("only an explicit 'vercel' enables trust; everything else is untrusted", () => {
    expect(readTrustedProxy("vercel")).toBe("vercel");
    expect(readTrustedProxy(" Vercel ")).toBe("vercel");
    for (const v of [undefined, "", "none", "true", "1", "cloudflare", "*"]) {
      expect(readTrustedProxy(v)).toBe("none");
    }
  });

  it("untrusted mode ignores every header, however plausible", () => {
    const h = headers({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.7" });
    expect(resolveClientIdentity(h, "none")).toBeNull();
  });
});

describe("header spoofing (trusted vercel mode)", () => {
  it("uses the rightmost entry: client-supplied entries in front of it are ignored", () => {
    const real = resolveClientIdentity(headers({ "x-forwarded-for": "198.51.100.9" }), "vercel");
    const spoofed = resolveClientIdentity(
      headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 198.51.100.9" }),
      "vercel",
    );
    expect(real).toBe("v4:198.51.100.9");
    expect(spoofed).toBe(real);
  });

  it("other headers (x-real-ip, forwarded, cf-connecting-ip) are never consulted", () => {
    const h = headers({
      "x-real-ip": "9.9.9.9",
      forwarded: "for=8.8.8.8",
      "cf-connecting-ip": "7.7.7.7",
    });
    expect(resolveClientIdentity(h, "vercel")).toBeNull();
  });

  it.each([
    "",
    "unknown",
    "not-an-ip",
    "1.2.3",
    "999.1.1.1",
    "01.2.3.4",
    "1.2.3.4:8080",
    "a".repeat(100),
    "1.2.3.4, ",
  ])("an unusable rightmost entry (%j) gives no identity", (value) => {
    expect(resolveClientIdentity(headers({ "x-forwarded-for": value }), "vercel")).toBeNull();
  });

  it("missing header gives no identity (no shared 'unknown' bucket)", () => {
    expect(resolveClientIdentity(headers({}), "vercel")).toBeNull();
  });
});

describe("IP normalisation", () => {
  it("IPv4 stays as is", () => {
    expect(normalizeIp("203.0.113.7")).toBe("v4:203.0.113.7");
  });

  it("IPv6 addresses inside one /64 share an identity; other /64s differ", () => {
    const a = normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    const b = normalizeIp("2001:0db8:0001:0002:0:0:0:1");
    const c = normalizeIp("2001:db8:1:2::ffff");
    const other = normalizeIp("2001:db8:1:3::1");
    expect(a).toBe("v6:2001:db8:1:2");
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(other).not.toBe(a);
  });

  it("handles compressed forms, case and zone ids", () => {
    expect(normalizeIp("::1")).toBe("v6:0:0:0:0");
    expect(normalizeIp("2001:DB8::1")).toBe("v6:2001:db8:0:0");
    expect(normalizeIp("fe80::1%eth0")).toBe("v6:fe80:0:0:0");
    expect(normalizeIp("::")).toBe("v6:0:0:0:0");
  });

  it("IPv4-mapped IPv6 is the IPv4 address (no second identity for the same client)", () => {
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("v4:203.0.113.7");
    expect(normalizeIp("::ffff:cb00:7107")).toBe("v4:203.0.113.7");
  });

  it.each([
    "2001:db8::1::2",
    "2001:db8:::1",
    "12345::1",
    "g::1",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7",
  ])("rejects malformed IPv6 %j", (value) => {
    expect(normalizeIp(value)).toBeNull();
  });
});

describe("HMAC secret", () => {
  it("accepts a long, varied secret (e.g. openssl rand -hex 32)", () => {
    expect(
      isAcceptableSecret("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"),
    ).toBe(true);
    expect(isAcceptableSecret(SECRET)).toBe(true);
  });

  it.each([
    undefined,
    "",
    "   ",
    "short",
    "x".repeat(31),
    "a".repeat(64),
    "ab".repeat(32),
    "1234".repeat(16),
    " ".repeat(40),
  ])("rejects missing, short or low-variety secret %j", (value) => {
    expect(isAcceptableSecret(value as string | undefined)).toBe(false);
  });

  it("does not fall back to any other variable", () => {
    expect(() =>
      clientKeyFor(headers({ "x-forwarded-for": "203.0.113.7" }), {
        FEEDBACK_TRUST_PROXY: "vercel",
        // @ts-expect-error unrelated variables must be ignored
        SUPABASE_SERVICE_ROLE_KEY: SECRET,
      }),
    ).toThrow(FeedbackError);
  });
});

describe("client key", () => {
  const env = { FEEDBACK_TRUST_PROXY: "vercel", FEEDBACK_HASH_SECRET: SECRET };
  const h = headers({ "x-forwarded-for": "203.0.113.7" });

  it("is a keyed, domain-separated HMAC of the normalised identity (no IP in the key)", () => {
    const key = clientKeyFor(h, env);
    const expected = createHmac("sha256", SECRET)
      .update("feedback-client:v1:v4:203.0.113.7")
      .digest("hex")
      .slice(0, 32);
    expect(key).toBe(expected);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain("203");
  });

  it("depends on the secret and on the client", () => {
    const other = clientKeyFor(h, { ...env, FEEDBACK_HASH_SECRET: SECRET + "x" });
    expect(other).not.toBe(clientKeyFor(h, env));
    expect(clientKeyFor(headers({ "x-forwarded-for": "203.0.113.8" }), env)).not.toBe(
      clientKeyFor(h, env),
    );
    expect(deriveClientKey("v4:203.0.113.7", SECRET)).toBe(clientKeyFor(h, env));
  });

  it.each([
    ["missing secret", { FEEDBACK_TRUST_PROXY: "vercel" }, "missing"],
    [
      "weak secret",
      { FEEDBACK_TRUST_PROXY: "vercel", FEEDBACK_HASH_SECRET: "a".repeat(40) },
      "weak",
    ],
  ])("%s refuses with a generic error and logs only a reason", (_n, e, reason) => {
    const log = vi.fn();
    expect(() => clientKeyFor(h, e, log)).toThrow(FeedbackError);
    expect(log).toHaveBeenCalledWith("feedback.secret-invalid", { reason });
    expect(JSON.stringify(log.mock.calls)).not.toContain("aaaa");
  });

  it("no trusted proxy configured: refuses, logs the mode only", () => {
    const log = vi.fn();
    try {
      clientKeyFor(h, { FEEDBACK_HASH_SECRET: SECRET }, log);
      throw new Error("should refuse");
    } catch (error) {
      expect((error as FeedbackError).code).toBe("unavailable");
      expect((error as Error).message).not.toContain(SECRET);
    }
    expect(log).toHaveBeenCalledWith("feedback.no-trusted-ip", { mode: "none" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
  });

  it("trusted proxy but no usable address: refuses instead of using a shared bucket", () => {
    expect(() => clientKeyFor(headers({}), env)).toThrow(FeedbackError);
    expect(() => clientKeyFor(headers({ "x-forwarded-for": "garbage" }), env)).toThrow(
      FeedbackError,
    );
  });
});
