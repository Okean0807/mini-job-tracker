// @vitest-environment node
/**
 * Integration test of the real server path with a FAKE PostgREST (local HTTP server):
 * submitFeedbackServer -> real supabase-js admin client -> HTTP request -> fake answer.
 * Needs no secrets and no external infrastructure; all values below are test constants.
 *
 * What it proves: the exact wire format sent to Supabase, which client key is derived from which
 * header, that nothing is sent when configuration is unsafe, and that clients only ever receive
 * safe error codes (no SQL text, no secrets) for every kind of database answer.
 *
 * What it does NOT prove: the real Supabase/PostgREST, RLS, grants (see
 * scripts/db-tests/feedback_run.sh for the local PostgreSQL tests and
 * scripts/feedback-transport-check.mjs for the TanStack HTTP transport).
 */
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let requestHeaders: Record<string, string> = {};
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({ headers: new Headers(requestHeaders) }),
}));

import { FeedbackError, readFeedbackError } from "./schema";
import { submitFeedbackServer } from "./feedback.server";

const SERVICE_KEY = "test-service-role-key-NOT-A-REAL-KEY-0123456789";
const HASH_SECRET = "f3a9c1d27b5e48a09d6c3b1e7a4f8205-feedback-hash-secret";
const SQL_DETAIL = "SECRET-SQL-DETAIL relation public.feedback violates something";

type Seen = { url: string; apikey: string; authorization: string; body: Record<string, unknown> };
let server: Server;
let seen: Seen[] = [];
let answer: (() => { status: number; body: unknown }) | null = null;

const input = () => ({
  submissionId: crypto.randomUUID(),
  kind: "bug",
  message: "Der Export schlägt fehl",
  appVersion: "1.0.0",
  lang: "de",
  route: "/einstellungen",
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({
        url: req.url ?? "",
        apikey: String(req.headers["apikey"] ?? ""),
        authorization: String(req.headers["authorization"] ?? ""),
        body: raw ? JSON.parse(raw) : {},
      });
      const reply = answer?.() ?? {
        status: 200,
        body: [{ status: "created", retry_after_seconds: 0 }],
      };
      res.statusCode = reply.status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  process.env["SUPABASE_URL"] = `http://127.0.0.1:${port}`;
  process.env["VITE_SUPABASE_URL"] = `http://127.0.0.1:${port}`;
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = SERVICE_KEY;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  seen = [];
  answer = null;
  requestHeaders = { "x-forwarded-for": "198.51.100.9" };
  process.env["FEEDBACK_TRUST_PROXY"] = "vercel";
  process.env["FEEDBACK_HASH_SECRET"] = HASH_SECRET;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as FeedbackError;
  }
  throw new Error("expected rejection");
};
const expectedKey = (identity: string) =>
  createHmac("sha256", HASH_SECRET)
    .update(`feedback-client:v1:${identity}`)
    .digest("hex")
    .slice(0, 32);
const logged = () =>
  JSON.stringify(warn.mock.calls) + JSON.stringify(vi.mocked(console.error).mock.calls);

describe("wire format to Supabase", () => {
  it("calls the RPC once with the service key, exactly the 8 documented parameters, and a keyed client hash", async () => {
    await expect(submitFeedbackServer(input())).resolves.toEqual({ ok: true, duplicate: false });
    expect(seen).toHaveLength(1);
    const call = seen[0]!;
    expect(call.url).toBe("/rest/v1/rpc/submit_feedback");
    expect(call.apikey).toBe(SERVICE_KEY);
    expect(Object.keys(call.body).sort()).toEqual(
      [
        "p_app_version",
        "p_client_key",
        "p_kind",
        "p_lang",
        "p_message",
        "p_rating",
        "p_route",
        "p_submission_id",
      ].sort(),
    );
    expect(call.body["p_client_key"]).toBe(expectedKey("v4:198.51.100.9"));
    const wire = JSON.stringify(call.body);
    expect(wire).not.toContain("198.51.100.9");
    expect(wire).not.toContain(HASH_SECRET);
    expect(wire).not.toContain(SERVICE_KEY);
  });

  it("a duplicate answer is a success", async () => {
    answer = () => ({ status: 200, body: [{ status: "duplicate", retry_after_seconds: 0 }] });
    await expect(submitFeedbackServer(input())).resolves.toEqual({ ok: true, duplicate: true });
  });
});

describe("which header decides the client (F1)", () => {
  it("rightmost x-forwarded-for entry; spoofed left entries do not change the key", async () => {
    requestHeaders = { "x-forwarded-for": "198.51.100.9" };
    await submitFeedbackServer(input());
    requestHeaders = { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 198.51.100.9" };
    await submitFeedbackServer(input());
    expect(seen[0]!.body["p_client_key"]).toBe(seen[1]!.body["p_client_key"]);
  });

  it("IPv6 addresses of one /64 are one client", async () => {
    requestHeaders = { "x-forwarded-for": "2001:db8:1:2::1" };
    await submitFeedbackServer(input());
    requestHeaders = { "x-forwarded-for": "2001:db8:1:2:dead:beef:0:7" };
    await submitFeedbackServer(input());
    expect(seen[0]!.body["p_client_key"]).toBe(seen[1]!.body["p_client_key"]);
    expect(seen[0]!.body["p_client_key"]).toBe(expectedKey("v6:2001:db8:1:2"));
  });

  it("proxy trust not configured: refuses and never contacts the database", async () => {
    delete process.env["FEEDBACK_TRUST_PROXY"];
    const e = await fails(submitFeedbackServer(input()));
    expect(e.code).toBe("unavailable");
    expect(seen).toHaveLength(0);
    expect(logged()).toContain("feedback.no-trusted-ip");
  });

  it("trusted proxy but no/garbage address: refuses (no shared 'unknown' bucket)", async () => {
    requestHeaders = {};
    expect((await fails(submitFeedbackServer(input()))).code).toBe("unavailable");
    requestHeaders = { "x-forwarded-for": "not-an-ip" };
    expect((await fails(submitFeedbackServer(input()))).code).toBe("unavailable");
    expect(seen).toHaveLength(0);
  });
});

describe("hash secret (F2)", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["too short", "short-secret"],
    ["low variety", "a".repeat(64)],
  ])("%s secret refuses the submission, contacts nothing and leaks nothing", async (_n, value) => {
    if (value === undefined) delete process.env["FEEDBACK_HASH_SECRET"];
    else process.env["FEEDBACK_HASH_SECRET"] = value;
    const e = await fails(submitFeedbackServer(input()));
    expect(e.code).toBe("unavailable");
    expect(e.message).toBe("feedback:unavailable:0");
    expect(seen).toHaveLength(0);
    expect(logged()).toContain("feedback.secret-invalid");
    if (value) expect(logged()).not.toContain(value);
  });

  it("the service role key is never used as a fallback secret", async () => {
    delete process.env["FEEDBACK_HASH_SECRET"];
    await fails(submitFeedbackServer(input()));
    expect(seen).toHaveLength(0);
  });

  it("a valid secret never appears in logs or in the error text", async () => {
    answer = () => ({ status: 500, body: { message: SQL_DETAIL, code: "XX000" } });
    const e = await fails(submitFeedbackServer(input()));
    expect(JSON.stringify(e.message)).not.toContain(HASH_SECRET);
    expect(logged()).not.toContain(HASH_SECRET);
    expect(logged()).not.toContain(SERVICE_KEY);
  });
});

describe("what a client can ever learn (transport-safe error codes)", () => {
  it.each([
    [
      "SQL error with details",
      { status: 500, body: { message: SQL_DETAIL, code: "XX000", hint: "x", details: SQL_DETAIL } },
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
        status: 401,
        body: { code: "42501", message: "permission denied for function submit_feedback" },
      },
    ],
    ["unexpected status value", { status: 200, body: [{ status: "ok" }] }],
    ["empty result", { status: 200, body: [] }],
    ["html error page", { status: 502, body: "<html>Bad gateway</html>" }],
  ])("%s -> unavailable, nothing internal in message or logs", async (_n, reply) => {
    answer = () => reply;
    const e = await fails(submitFeedbackServer(input()));
    expect(e).toBeInstanceOf(FeedbackError);
    expect(e.code).toBe("unavailable");
    expect(readFeedbackError(e)).toEqual({ code: "unavailable", retry: 0 });
    const text = e.message + logged();
    for (const secret of [
      SQL_DETAIL,
      "PGRST202",
      "42501",
      "submit_feedback",
      "Bad gateway",
      SERVICE_KEY,
      HASH_SECRET,
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("rate limit answer -> rate_limited with a retry-after", async () => {
    answer = () => ({ status: 200, body: [{ status: "rate_limited", retry_after_seconds: 125 }] });
    const e = await fails(submitFeedbackServer(input()));
    expect(readFeedbackError(e)).toEqual({ code: "rate_limited", retry: 125 });
  });

  it("database unreachable -> unavailable, no connection details", async () => {
    const original = process.env["SUPABASE_URL"];
    server.closeAllConnections();
    process.env["SUPABASE_URL"] = "http://127.0.0.1:9"; // nothing listens here
    vi.resetModules();
    const fresh = await import("./feedback.server");
    const e = await fails(fresh.submitFeedbackServer(input()));
    process.env["SUPABASE_URL"] = original;
    expect(e.code).toBe("unavailable");
    expect(e.message).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|fetch failed/);
  });

  it("invalid input is rejected as 'invalid' before any configuration or database use", async () => {
    delete process.env["FEEDBACK_HASH_SECRET"];
    const e = await fails(submitFeedbackServer({ ...input(), shifts: [{ id: "x" }] }));
    expect(e.code).toBe("invalid");
    expect(seen).toHaveLength(0);
  });

  it("honeypot submissions are acknowledged without touching the database", async () => {
    await expect(submitFeedbackServer({ ...input(), website: "http://spam" })).resolves.toEqual({
      ok: true,
      duplicate: false,
    });
    expect(seen).toHaveLength(0);
  });
});
