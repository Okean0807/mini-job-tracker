/** requireSupabaseAuth: unchanged rejection messages, sanitised closed-set diagnostics, no secrets in the log. */
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let currentRequest: { headers: Headers } | undefined;
let claimsResult: { data: unknown; error: unknown } = { data: null, error: { message: "bad" } };

vi.mock("@tanstack/react-start", () => ({
  createMiddleware: () => ({ server: (fn: unknown) => fn }),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => currentRequest }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getClaims: async () => claimsResult } }),
}));

import { requireSupabaseAuth } from "./auth-middleware";

const REASONS = [
  "no_request",
  "no_header",
  "bad_scheme",
  "no_token",
  "bad_token_format",
  "claims_invalid",
  "no_sub",
];
const SECRET_TOKEN = "SECRET.TOKEN.VALUE";

type Handler = (a: { next: (c: unknown) => unknown }) => Promise<unknown>;
async function run(
  headers: Record<string, string> | undefined,
  claims?: { data: unknown; error: unknown },
) {
  currentRequest = headers ? { headers: new Headers(headers) } : undefined;
  if (claims) claimsResult = claims;
  try {
    return { ok: await (requireSupabaseAuth as unknown as Handler)({ next: (c) => c }) };
  } catch (e) {
    return { error: e as Error };
  }
}

let warn: MockInstance<(...args: unknown[]) => void>;
beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://localhost.invalid");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable-not-real");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {}) as unknown as typeof warn;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const logged = () =>
  warn.mock.calls.map((c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>);

describe("rejections keep their message and log exactly one closed-set reason", () => {
  const rows: Array<
    [
      string,
      Record<string, string> | undefined,
      { data: unknown; error: unknown } | undefined,
      string,
      string,
    ]
  > = [
    [
      "no request",
      undefined,
      undefined,
      "Unauthorized: No request headers available",
      "no_request",
    ],
    ["no header", {}, undefined, "Unauthorized: No authorization header provided", "no_header"],
    [
      "basic scheme",
      { authorization: `Basic ${SECRET_TOKEN}` },
      undefined,
      "Unauthorized: Only Bearer tokens are supported",
      "bad_scheme",
    ],
    [
      "empty token",
      { authorization: "Bearer " },
      undefined,
      "Unauthorized: No token provided",
      "no_token",
    ],
    [
      "not a JWT",
      { authorization: `Bearer ${SECRET_TOKEN.replace(/\./g, "")}` },
      undefined,
      "Unauthorized: Invalid token",
      "bad_token_format",
    ],
    [
      "claims rejected",
      { authorization: `Bearer ${SECRET_TOKEN}` },
      { data: null, error: { message: "SECRET-ERR" } },
      "Unauthorized: Invalid token",
      "claims_invalid",
    ],
    [
      "claims without data",
      { authorization: `Bearer ${SECRET_TOKEN}` },
      { data: {}, error: null },
      "Unauthorized: Invalid token",
      "claims_invalid",
    ],
    [
      "no subject",
      { authorization: `Bearer ${SECRET_TOKEN}` },
      { data: { claims: { email: "a@b.c" } }, error: null },
      "Unauthorized: No user ID found in token",
      "no_sub",
    ],
  ];

  it.each(rows)("%s", async (_n, headers, claims, message, reason) => {
    const { error } = await run(headers, claims);
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toBe(message);
    expect(REASONS).toContain(reason);
    const events = logged();
    expect(events).toEqual([
      {
        event: "ai.auth.failed",
        stage: "app_auth",
        outcome: "unauthorized",
        cause: "app_auth",
        reason,
      },
    ]);
    const raw = JSON.stringify(warn.mock.calls);
    for (const secret of [SECRET_TOKEN, "SECRET-ERR", "a@b.c", "authorization", "Bearer"]) {
      expect(raw).not.toContain(secret);
    }
  });
});

describe("accepted requests", () => {
  it("valid claims pass through untouched and log nothing", async () => {
    const { ok } = await run(
      { authorization: `Bearer ${SECRET_TOKEN}` },
      { data: { claims: { sub: "user-1" } }, error: null },
    );
    expect(ok).toMatchObject({ context: { userId: "user-1" } });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("logging failures never hide the authorization error", () => {
  it("a throwing console.warn still yields the original Unauthorized error", async () => {
    warn.mockImplementation(() => {
      throw new Error("console down");
    });
    const { error } = await run({});
    expect(error!.message).toBe("Unauthorized: No authorization header provided");
  });
});
