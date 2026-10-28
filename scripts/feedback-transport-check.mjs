#!/usr/bin/env node
/**
 * Opt-in check of the REAL TanStack Start transport + the REAL requireSupabaseAuth middleware for
 * Feedback (variant C2). Not part of `vitest run` and not CI: it starts a Vite dev server and needs
 * Playwright, which is not a project dependency.
 *
 *   node scripts/feedback-transport-check.mjs
 *
 * It starts a FAKE Supabase on 127.0.0.1 (/auth/v1/user + PostgREST rpc) and a dev server pointed at it
 * with test-only constants, calls the server function from a real browser page and checks that:
 *  - no token / bad token / rejected token / non-Bearer are refused by the server before the database;
 *  - the request to PostgREST carries the user's token and the publishable key, never a service-role key;
 *  - clients only ever receive safe error codes (no SQL text, no secrets);
 *  - user A and user B are told apart only by their tokens (no user id is ever sent as data).
 * It never touches Supabase, Vercel or any real secret, and proves nothing about the real Supabase.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is not installed (it is intentionally not a project dependency). Skipping.");
  process.exit(2);
}

const STUB_PORT = 5997;
const DEV_PORT = 5198;
const PUBLISHABLE = "sb_publishable_TEST_ONLY_0123456789";
const SERVICE_CANARY = "service-role-CANARY-must-never-be-sent-0123456789";
const SQL_DETAIL = "SECRET-SQL-DETAIL relation public.feedback violates something";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}.${Buffer.alloc(32, 7).toString("base64url")}`;
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const TOKEN_A = jwt({ sub: A });
const TOKEN_B = jwt({ sub: B });
const TOKEN_ANON = jwt({ sub: "cccccccc-0000-4000-8000-000000000003", is_anonymous: true });
const TOKEN_REVOKED = jwt({ sub: A, jti: "revoked" });
const claimsOf = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());

let mode = "created";
const seen = [];
const stub = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.url.startsWith("/mode/")) {
      mode = req.url.slice(6);
      res.end("ok");
      return;
    }
    const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/auth/v1/user")) {
      if (!token || token === TOKEN_REVOKED) {
        res.statusCode = 401;
        res.end(JSON.stringify({ msg: "invalid JWT" }));
      } else res.end(JSON.stringify({ id: claimsOf(token).sub, aud: "authenticated" }));
      return;
    }
    seen.push({ authorization: req.headers.authorization, apikey: req.headers.apikey, body: raw ? JSON.parse(raw) : {} });
    if (mode === "error") {
      res.statusCode = 500;
      res.end(JSON.stringify({ message: SQL_DETAIL, code: "XX000" }));
    } else if (mode === "limited") {
      res.end(JSON.stringify([{ status: "rate_limited", retry_after_seconds: 125 }]));
    } else if (claimsOf(token).is_anonymous === true) {
      res.end(JSON.stringify([{ status: "forbidden", retry_after_seconds: 0 }]));
    } else {
      res.end(JSON.stringify([{ status: "created", retry_after_seconds: 0 }]));
    }
  });
}).listen(STUB_PORT, "127.0.0.1");

const env = {
  ...process.env,
  SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
  VITE_SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
  SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  VITE_SUPABASE_PROJECT_ID: "test",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_CANARY, // present in the environment, must never be used by Feedback
};

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`);
  if (!ok) failures += 1;
};
const base = () => ({ submissionId: crypto.randomUUID(), kind: "bug", message: "Transport-Test", appVersion: "check", lang: "de", route: "/einstellungen" });
const setMode = (m) => fetch(`http://127.0.0.1:${STUB_PORT}/mode/${m}`);

const dev = spawn("npx", ["vite", "dev", "--port", String(DEV_PORT), "--host", "127.0.0.1", "--strictPort"], { env, stdio: "ignore", detached: true });
try {
  for (let i = 0; i < 90; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${DEV_PORT}/`)).ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${DEV_PORT}/einstellungen`, { waitUntil: "networkidle" });
  const call = (data, headers) =>
    page.evaluate(
      async ({ data, headers }) => {
        const mod = await import("/src/lib/feedback/feedback.functions.ts");
        try {
          return { ok: true, value: await mod.submitFeedback({ data, ...(headers ? { headers } : {}) }) };
        } catch (e) {
          return { ok: false, message: String(e && e.message ? e.message : e).slice(0, 300) };
        }
      },
      { data, headers },
    );
  const as = (token) => ({ Authorization: `Bearer ${token}` });

  await setMode("created");
  seen.length = 0;
  const a = await call(base(), as(TOKEN_A));
  check("user A: confirmed", a.ok && a.value?.ok === true, JSON.stringify(a));
  const b = await call(base(), as(TOKEN_B));
  check("user B: confirmed", b.ok && b.value?.ok === true, JSON.stringify(b));
  check("PostgREST received A's token and B's token respectively", seen[0]?.authorization === `Bearer ${TOKEN_A}` && seen[1]?.authorization === `Bearer ${TOKEN_B}`);
  check("publishable key as apikey, never the service-role key", seen.every((s) => s.apikey === PUBLISHABLE) && !JSON.stringify(seen).includes(SERVICE_CANARY));
  check("7 parameters, no user id anywhere in the data", seen.every((s) => Object.keys(s.body).length === 7) && !JSON.stringify(seen.map((s) => s.body)).includes(A));

  seen.length = 0;
  const none = await call(base());
  check("no token: refused by the server", !none.ok && /^Unauthorized/.test(none.message), JSON.stringify(none));
  const junk = await call(base(), as("abc"));
  check("garbage token: refused", !junk.ok && /^Unauthorized/.test(junk.message), JSON.stringify(junk));
  const revoked = await call(base(), as(TOKEN_REVOKED));
  check("token rejected by the auth server: refused", !revoked.ok && /^Unauthorized/.test(revoked.message), JSON.stringify(revoked));
  const basic = await call(base(), { Authorization: `Basic ${TOKEN_A}` });
  check("non-Bearer scheme: refused", !basic.ok && /^Unauthorized/.test(basic.message), JSON.stringify(basic));
  check("none of the refused requests reached PostgREST", seen.length === 0, String(seen.length));

  const extra = await call({ ...base(), userId: B }, as(TOKEN_A));
  check("a user id in the request body is rejected as invalid", !extra.ok && extra.message === "feedback:invalid:0", JSON.stringify(extra));
  check("(and never reached PostgREST)", seen.length === 0);

  const anon = await call(base(), as(TOKEN_ANON));
  check("anonymous Supabase JWT: 'forbidden' code (decided in SQL, mapped here)", !anon.ok && anon.message === "feedback:forbidden:0", JSON.stringify(anon));

  await setMode("limited");
  const lim = await call(base(), as(TOKEN_A));
  check("rate limit -> code with retry-after", !lim.ok && lim.message === "feedback:rate_limited:125", JSON.stringify(lim));
  await setMode("error");
  const err = await call(base(), as(TOKEN_A));
  check("database 500 with SQL text -> unavailable code only", !err.ok && err.message === "feedback:unavailable:0", JSON.stringify(err));
  check("no internal text reaches the client", ![SQL_DETAIL, "XX000", SERVICE_CANARY, PUBLISHABLE].some((s) => JSON.stringify(err).includes(s)));
  await browser.close();
} finally {
  try { process.kill(-dev.pid, "SIGTERM"); } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, 2000));
  stub.close();
}
console.log(failures === 0 ? "ALL TRANSPORT CHECKS PASSED (fake Supabase, not the real one)" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
