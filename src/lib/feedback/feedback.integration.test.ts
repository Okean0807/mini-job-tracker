// @vitest-environment node
/**
 * Integration test of the real authentication path (variant C2) against a FAKE Supabase
 * (local HTTP server: /auth/v1/user and PostgREST /rest/v1/rpc/submit_feedback):
 *
 *   real requireSupabaseAuth (getClaims -> fake auth server) -> user-scoped supabase-js client
 *   -> handleFeedback -> HTTP request to the fake PostgREST.
 *
 * Needs no secrets and no external infrastructure; every key and token below is a test constant.
 * It proves what the application sends and how it reacts to answers. It does NOT prove the real
 * Supabase/PostgREST, auth.uid(), RLS or grants (see scripts/db-tests/feedback_run.sh for the SQL
 * behaviour on a temporary local PostgreSQL and docs/FEEDBACK_DEPLOYMENT.md for the real checks).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let requestHeaders: Record<string, string> = {};
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({ headers: new Headers(requestHeaders) }),
}));

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import { handleFeedback } from "./handler";
import { FeedbackError } from "./schema";

const PUBLISHABLE = "sb_publishable_TEST_ONLY_0123456789";
const SERVICE_CANARY = "service-role-CANARY-must-never-be-sent-0123456789";
const SQL_DETAIL = "SECRET-SQL-DETAIL relation public.feedback violates something";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** HS256-style token: getClaims() falls back to GET /auth/v1/user, which the fake answers. */
const jwt = (claims: Record<string, unknown>) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  })}.${Buffer.alloc(32, 7).toString("base64url")}`;
const TOKEN_A = jwt({ sub: A });
const TOKEN_B = jwt({ sub: B });
const TOKEN_ANON = jwt({ sub: "cccccccc-0000-4000-8000-000000000003", is_anonymous: true });
const TOKEN_REVOKED = jwt({ sub: A, jti: "revoked" });

type Seen = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};
let server: Server;
let seen: Seen[] = [];
let rpcAnswer: ((token: string) => { status: number; body: unknown }) | null = null;

const claimsOf = (token: string) =>
  JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, String(v)]),
      );
      const url = req.url ?? "";
      seen.push({ method: req.method ?? "", url, headers, body: raw ? JSON.parse(raw) : {} });
      const token = (headers["authorization"] ?? "").replace(/^Bearer /, "");
      res.setHeader("content-type", "application/json");
      if (url.startsWith("/auth/v1/user")) {
        if (!token || token === TOKEN_REVOKED) {
          res.statusCode = 401;
          res.end(JSON.stringify({ msg: "invalid JWT" }));
        } else {
          res.end(JSON.stringify({ id: claimsOf(token)["sub"], aud: "authenticated" }));
        }
        return;
      }
      const reply = rpcAnswer?.(token) ?? {
        status: 200,
        body: [{ status: "created", retry_after_seconds: 0 }],
      };
      res.statusCode = reply.status;
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env["VITE_SUPABASE_URL"] = url;
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] = PUBLISHABLE;
  process.env["SUPABASE_URL"] = url;
  process.env["SUPABASE_PUBLISHABLE_KEY"] = PUBLISHABLE;
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = SERVICE_CANARY; // present in the environment, must stay unused
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  seen = [];
  rpcAnswer = null;
  requestHeaders = {};
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const input = () => ({
  submissionId: crypto.randomUUID(),
  kind: "bug",
  message: "Der Export schlägt fehl",
  appVersion: "1.0.0",
  lang: "de",
  route: "/einstellungen",
});

type Ctx = {
  supabase: { rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }> };
};
/** Runs the REAL middleware, then the REAL handler with the middleware's client. */
async function submit(token: string | null, data: unknown = input()) {
  requestHeaders = token ? { authorization: `Bearer ${token}` } : {};
  const middleware = requireSupabaseAuth as unknown as {
    options: {
      server: (args: { next: (o: { context: Ctx }) => unknown }) => Promise<{ context: Ctx }>;
    };
  };
  const { context } = await middleware.options.server({ next: (o) => o });
  return handleFeedback(data, {
    rpc: (fn, args) => context.supabase.rpc(fn, args as never),
  });
}
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected rejection");
};
const rpcCalls = () => seen.filter((s) => s.url.startsWith("/rest/v1/rpc/submit_feedback"));
const everything = () => JSON.stringify(seen);

describe("user A and user B (authenticated)", () => {
  it("A's request carries A's token and the publishable key, 7 parameters, no user id", async () => {
    await expect(submit(TOKEN_A)).resolves.toEqual({ ok: true, duplicate: false });
    expect(rpcCalls()).toHaveLength(1);
    const call = rpcCalls()[0]!;
    expect(call.method).toBe("POST");
    expect(call.headers["authorization"]).toBe(`Bearer ${TOKEN_A}`);
    expect(call.headers["apikey"]).toBe(PUBLISHABLE);
    expect(Object.keys(call.body).sort()).toEqual(
      [
        "p_app_version",
        "p_kind",
        "p_lang",
        "p_message",
        "p_rating",
        "p_route",
        "p_submission_id",
      ].sort(),
    );
    expect(everything()).not.toContain(A); // the user id is never sent as data
  });

  it("B's request carries B's token — the author is whoever the token says, never a field", async () => {
    await submit(TOKEN_B);
    expect(rpcCalls()[0]!.headers["authorization"]).toBe(`Bearer ${TOKEN_B}`);
    expect(rpcCalls()[0]!.headers["authorization"]).not.toContain(TOKEN_A);
  });

  it("a user id supplied in the request body is rejected before any database call", async () => {
    const e = await fails(submit(TOKEN_A, { ...input(), userId: B }));
    expect((e as FeedbackError).code).toBe("invalid");
    expect(rpcCalls()).toHaveLength(0);
  });

  it("the service-role key is never sent to anyone", async () => {
    await submit(TOKEN_A);
    expect(everything()).not.toContain(SERVICE_CANARY);
  });
});

describe("no token / bad token (rejected on the server, before the database)", () => {
  it("no Authorization header: Unauthorized, nothing sent to PostgREST", async () => {
    const e = await fails(submit(null));
    expect(e.message).toMatch(/^Unauthorized/);
    expect(seen).toHaveLength(0);
  });

  it.each([
    ["not a JWT", "abc"],
    ["two segments", "a.b"],
    ["empty bearer", ""],
  ])("%s: Unauthorized, nothing sent", async (_n, token) => {
    requestHeaders = { authorization: `Bearer ${token}` };
    const middleware = requireSupabaseAuth as unknown as {
      options: { server: (a: { next: (o: unknown) => unknown }) => Promise<unknown> };
    };
    const e = await fails(middleware.options.server({ next: (o) => o }));
    expect(e.message).toMatch(/^Unauthorized/);
    expect(rpcCalls()).toHaveLength(0);
  });

  it("a token the auth server rejects: Unauthorized, the RPC is never called", async () => {
    const e = await fails(submit(TOKEN_REVOKED));
    expect(e.message).toMatch(/^Unauthorized/);
    expect(rpcCalls()).toHaveLength(0);
  });

  it("non-Bearer schemes are refused", async () => {
    requestHeaders = { authorization: `Basic ${TOKEN_A}` };
    const middleware = requireSupabaseAuth as unknown as {
      options: { server: (a: { next: (o: unknown) => unknown }) => Promise<unknown> };
    };
    expect((await fails(middleware.options.server({ next: (o) => o }))).message).toMatch(
      /^Unauthorized/,
    );
  });
});

describe("anonymous Supabase user (is_anonymous claim)", () => {
  it("the request reaches the database with that token and the 'forbidden' answer becomes a safe code", async () => {
    rpcAnswer = (token) =>
      claimsOf(token)["is_anonymous"] === true
        ? { status: 200, body: [{ status: "forbidden", retry_after_seconds: 0 }] }
        : { status: 200, body: [{ status: "created", retry_after_seconds: 0 }] };
    const e = (await fails(submit(TOKEN_ANON))) as FeedbackError;
    expect(e.code).toBe("forbidden");
    // The refusal itself is decided in SQL (see the local SQL tests); this only proves the mapping.
  });
});

describe("what a client can ever learn", () => {
  it.each([
    [
      "SQL error with details",
      { status: 500, body: { message: SQL_DETAIL, code: "XX000", details: SQL_DETAIL } },
    ],
    [
      "function missing (migration not applied)",
      {
        status: 404,
        body: { code: "PGRST202", message: "Could not find the function public.submit_feedback" },
      },
    ],
    [
      "permission denied",
      {
        status: 403,
        body: { code: "42501", message: "permission denied for function submit_feedback" },
      },
    ],
    [
      "expired JWT at PostgREST",
      { status: 401, body: { code: "PGRST301", message: "JWT expired" } },
    ],
    ["unexpected status value", { status: 200, body: [{ status: "ok" }] }],
    ["empty result", { status: 200, body: [] }],
    ["html error page", { status: 502, body: "<html>Bad gateway</html>" }],
  ])("%s -> unavailable, nothing internal in message or logs", async (_n, reply) => {
    rpcAnswer = () => reply;
    const e = (await fails(submit(TOKEN_A))) as FeedbackError;
    expect(e).toBeInstanceOf(FeedbackError);
    expect(e.code).toBe("unavailable");
    const text =
      e.message +
      JSON.stringify(vi.mocked(console.warn).mock.calls) +
      JSON.stringify(vi.mocked(console.error).mock.calls);
    for (const secret of [
      SQL_DETAIL,
      "PGRST",
      "42501",
      "submit_feedback",
      "Bad gateway",
      SERVICE_CANARY,
      PUBLISHABLE,
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("rate limit answer -> rate_limited with retry-after", async () => {
    rpcAnswer = () => ({
      status: 200,
      body: [{ status: "rate_limited", retry_after_seconds: 125 }],
    });
    const e = (await fails(submit(TOKEN_A))) as FeedbackError;
    expect(e.message).toBe("feedback:rate_limited:125");
  });

  it("'invalid' and 'unauthenticated' answers map to their codes", async () => {
    rpcAnswer = () => ({ status: 200, body: [{ status: "invalid" }] });
    expect(((await fails(submit(TOKEN_A))) as FeedbackError).code).toBe("invalid");
    rpcAnswer = () => ({ status: 200, body: [{ status: "unauthenticated" }] });
    expect(((await fails(submit(TOKEN_A))) as FeedbackError).code).toBe("unauthenticated");
  });
});
