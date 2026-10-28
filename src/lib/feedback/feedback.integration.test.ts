// @vitest-environment node
/**
 * Integration test of the real authentication path against FAKE services (local HTTP servers):
 *
 *   real requireSupabaseAuth (getClaims -> fake Supabase /auth/v1/user)
 *   -> handleFeedback -> real Resend adapter -> fake mail API.
 *
 * Needs no secrets and no external infrastructure; every key and token below is a test constant.
 * It proves what the application sends and how it reacts. It does NOT prove that Supabase accepts real
 * tokens or that Resend delivers real e-mail.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let requestHeaders: Record<string, string> = {};
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({ headers: new Headers(requestHeaders) }),
}));

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import { handleFeedback, readMailConfig } from "./handler";
import { sendMail } from "./mailer";
import { createRateLimiter } from "./rate-limit";
import { FeedbackError } from "./schema";

const PUBLISHABLE = "sb_publishable_TEST_ONLY_0123456789";
const SERVICE_CANARY = "service-role-CANARY-must-never-be-used-0123456789";
const MAIL_KEY = "re_TEST_ONLY_not_a_real_key_0123456789";
const OWNER = "owner@example.test";
const PROVIDER_TEXT = "SECRET-PROVIDER-TEXT";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: Record<string, unknown>) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  })}.${Buffer.alloc(32, 7).toString("base64url")}`;
const TOKEN_A = jwt({ sub: "aaaaaaaa-0000-4000-8000-000000000001", email: "a@example.test" });
const TOKEN_B = jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000002", email: "b@example.test" });
const TOKEN_ANON = jwt({ sub: "cccccccc-0000-4000-8000-000000000003", is_anonymous: true });
const TOKEN_REVOKED = jwt({ sub: "aaaaaaaa-0000-4000-8000-000000000001", jti: "revoked" });

const claimsOf = (t: string) =>
  JSON.parse(Buffer.from(t.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;

type Mail = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
let supabase: Server;
let mailApi: Server;
let mails: Mail[] = [];
let authCalls = 0;
let mailAnswer: () => { status: number; body: string } = () => ({
  status: 200,
  body: '{"id":"msg_1"}',
});
let mailBase = "";

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );

beforeAll(async () => {
  supabase = createServer((req, res) => {
    const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    res.setHeader("content-type", "application/json");
    if ((req.url ?? "").startsWith("/auth/v1/user")) {
      authCalls += 1;
      if (!token || token === TOKEN_REVOKED) {
        res.statusCode = 401;
        res.end(JSON.stringify({ msg: "invalid JWT" }));
      } else res.end(JSON.stringify({ id: claimsOf(token)["sub"], aud: "authenticated" }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  mailApi = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      mails.push({
        url: req.url ?? "",
        headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
        body: raw ? JSON.parse(raw) : {},
      });
      const a = mailAnswer();
      res.statusCode = a.status;
      res.setHeader("content-type", "application/json");
      res.end(a.body);
    });
  });
  const url = await listen(supabase);
  mailBase = await listen(mailApi);
  for (const name of ["VITE_SUPABASE_URL", "SUPABASE_URL"]) process.env[name] = url;
  for (const name of ["VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY"])
    process.env[name] = PUBLISHABLE;
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = SERVICE_CANARY; // present, must stay unused
});
afterAll(async () => {
  supabase.closeAllConnections();
  mailApi.closeAllConnections();
  await Promise.all([new Promise((r) => supabase.close(r)), new Promise((r) => mailApi.close(r))]);
});

beforeEach(() => {
  mails = [];
  authCalls = 0;
  requestHeaders = {};
  mailAnswer = () => ({ status: 200, body: '{"id":"msg_1"}' });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const input = () => ({
  submissionId: crypto.randomUUID(),
  message: "Der Export schlägt fehl",
  appVersion: "1.0.0",
  lang: "de",
  route: "/einstellungen",
});

type Ctx = { userId: string; claims: Record<string, unknown> };
const mw = requireSupabaseAuth as unknown as {
  options: {
    server: (args: { next: (o: { context: Ctx }) => unknown }) => Promise<{ context: Ctx }>;
  };
};
const rateLimiter = createRateLimiter();
const config = () => readMailConfig({ RESEND_API_KEY: MAIL_KEY, FEEDBACK_TO_EMAIL: OWNER })!;

/** Runs the REAL middleware, then the REAL handler with the REAL mail adapter (pointed at the fake API). */
async function submit(token: string | null, data: unknown = input(), limiter = rateLimiter) {
  requestHeaders = token ? { authorization: `Bearer ${token}` } : {};
  const { context } = await mw.options.server({ next: (o) => o });
  const claims = context.claims as { email?: unknown; is_anonymous?: unknown };
  return handleFeedback(data, {
    user: {
      id: context.userId,
      email: typeof claims.email === "string" ? claims.email : undefined,
      isAnonymous: claims.is_anonymous === true,
    },
    config: config(),
    rateLimiter: limiter,
    send: (m, c) => sendMail(m, { apiKey: c.apiKey, baseUrl: mailBase }),
    log: (e, f) => console.warn(e, JSON.stringify(f)),
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

describe("user A and user B (authenticated)", () => {
  it("A's message becomes one e-mail to the owner, reply-to A's verified address, and is confirmed", async () => {
    await expect(submit(TOKEN_A)).resolves.toEqual({ ok: true, duplicate: false });
    expect(mails).toHaveLength(1);
    const m = mails[0]!;
    expect(m.url).toBe("/emails");
    expect(m.headers["authorization"]).toBe(`Bearer ${MAIL_KEY}`);
    expect(m.body["to"]).toEqual([OWNER]);
    expect(m.body["reply_to"]).toBe("a@example.test");
    expect(String(m.body["text"])).toContain("Der Export schlägt fehl");
  });

  it("B's message carries B's address — the sender identity comes from the token, never the request", async () => {
    await submit(TOKEN_B);
    expect(mails[0]!.body["reply_to"]).toBe("b@example.test");
    expect(JSON.stringify(mails[0])).not.toContain("a@example.test");
  });

  it("a recipient or reply-to supplied in the request is rejected; nothing is sent", async () => {
    for (const extra of [
      { to: "evil@example.com" },
      { replyTo: "evil@example.com" },
      { cc: "evil@example.com" },
    ]) {
      const e = await fails(submit(TOKEN_A, { ...input(), ...extra }));
      expect((e as FeedbackError).code).toBe("invalid");
    }
    expect(mails).toHaveLength(0);
  });

  it("the service-role key and the Supabase publishable key are never sent to the mail service", async () => {
    await submit(TOKEN_A);
    const wire = JSON.stringify(mails);
    expect(wire).not.toContain(SERVICE_CANARY);
    expect(wire).not.toContain(PUBLISHABLE);
    expect(wire).not.toContain(TOKEN_A);
  });
});

describe("no token / bad token / anonymous", () => {
  it("no Authorization header: Unauthorized from the server, no mail", async () => {
    expect((await fails(submit(null))).message).toMatch(/^Unauthorized/);
    expect(mails).toHaveLength(0);
  });

  it.each([
    ["garbage", "abc"],
    ["two segments", "a.b"],
  ])("%s token: Unauthorized, no mail", async (_n, token) => {
    expect((await fails(submit(token))).message).toMatch(/^Unauthorized/);
    expect(mails).toHaveLength(0);
  });

  it("a token the auth server rejects: Unauthorized, no mail", async () => {
    expect((await fails(submit(TOKEN_REVOKED))).message).toMatch(/^Unauthorized/);
    expect(authCalls).toBeGreaterThan(0);
    expect(mails).toHaveLength(0);
  });

  it("an anonymous Supabase session is refused ('forbidden'), no mail", async () => {
    expect(((await fails(submit(TOKEN_ANON))) as FeedbackError).code).toBe("forbidden");
    expect(mails).toHaveLength(0);
  });
});

describe("rate limit", () => {
  it("the 6th message of user A within the hour is refused (retry-after), B can still send", async () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 5; i += 1) await submit(TOKEN_A, input(), limiter);
    const e = (await fails(submit(TOKEN_A, input(), limiter))) as FeedbackError;
    expect(e.code).toBe("rate_limited");
    expect(e.retryAfterSeconds).toBeGreaterThan(0);
    expect(mails).toHaveLength(5);
    await expect(submit(TOKEN_B, input(), limiter)).resolves.toMatchObject({ ok: true });
    expect(mails).toHaveLength(6);
  });
});

describe("mail service problems", () => {
  it.each([
    ["rejected key", { status: 401, body: `{"message":"${PROVIDER_TEXT}"}` }],
    ["sandbox sender restriction", { status: 403, body: `{"message":"${PROVIDER_TEXT}"}` }],
    ["provider rate limit", { status: 429, body: "{}" }],
    ["server error", { status: 500, body: PROVIDER_TEXT }],
    ["answer without a message id", { status: 200, body: "{}" }],
  ])(
    "%s -> unavailable; the text is kept for a retry; no internal text leaks",
    async (_n, reply) => {
      mailAnswer = () => reply;
      const e = (await fails(submit(TOKEN_A, input(), createRateLimiter()))) as FeedbackError;
      expect(e.code).toBe("unavailable");
      const text = e.message + JSON.stringify(vi.mocked(console.warn).mock.calls);
      for (const secret of [PROVIDER_TEXT, MAIL_KEY, OWNER, SERVICE_CANARY, TOKEN_A, "Export"]) {
        expect(text).not.toContain(secret);
      }
    },
  );

  it("mail API unreachable -> unavailable", async () => {
    requestHeaders = { authorization: `Bearer ${TOKEN_A}` };
    const { context } = await mw.options.server({ next: (o) => o });
    const e = await fails(
      handleFeedback(input(), {
        user: { id: context.userId },
        config: config(),
        rateLimiter: createRateLimiter(),
        send: (m, c) => sendMail(m, { apiKey: c.apiKey, baseUrl: "http://127.0.0.1:9" }),
      }),
    );
    expect((e as FeedbackError).code).toBe("unavailable");
  });
});
