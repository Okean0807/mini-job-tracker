#!/usr/bin/env node
/**
 * Opt-in check of the REAL TanStack Start transport for Feedback (not part of `vitest run` and not CI:
 * it starts a Vite dev server and needs Playwright, which is not a project dependency).
 *
 *   node scripts/feedback-transport-check.mjs
 *
 * It starts a FAKE PostgREST on 127.0.0.1, a dev server pointed at it with test-only constants,
 * calls the server function from a real browser page, and checks that:
 *  - clients only receive safe error codes (no SQL text, no secrets) for every database answer;
 *  - the server contacts the database only with the documented 8 parameters;
 *  - a spoofed left-hand x-forwarded-for entry does not change the client key (trusted mode "vercel"),
 *    and that without FEEDBACK_TRUST_PROXY the submission is refused before any database call.
 * It never touches Supabase, Vercel or any real secret.
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
const SERVICE_KEY = "test-service-role-key-NOT-A-REAL-KEY-0123456789";
const HASH_SECRET = "f3a9c1d27b5e48a09d6c3b1e7a4f8205-feedback-hash-secret";
const SQL_DETAIL = "SECRET-SQL-DETAIL relation public.feedback violates something";

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
    seen.push(raw ? JSON.parse(raw) : {});
    res.setHeader("content-type", "application/json");
    if (mode === "error") {
      res.statusCode = 500;
      res.end(JSON.stringify({ message: SQL_DETAIL, code: "XX000" }));
    } else if (mode === "limited") {
      res.end(JSON.stringify([{ status: "rate_limited", retry_after_seconds: 125 }]));
    } else {
      res.end(JSON.stringify([{ status: "created", retry_after_seconds: 0 }]));
    }
  });
}).listen(STUB_PORT, "127.0.0.1");

const baseEnv = {
  ...process.env,
  SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
  VITE_SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  VITE_SUPABASE_PROJECT_ID: "test",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  FEEDBACK_HASH_SECRET: HASH_SECRET,
};

async function withDevServer(extraEnv, run) {
  const env = { ...baseEnv, ...extraEnv };
  if (!extraEnv.FEEDBACK_TRUST_PROXY) delete env.FEEDBACK_TRUST_PROXY;
  const dev = spawn("npx", ["vite", "dev", "--port", String(DEV_PORT), "--host", "127.0.0.1", "--strictPort"], {
    env,
    stdio: "ignore",
    detached: true, // own process group: npx spawns vite as a child
  });
  try {
    for (let i = 0; i < 90; i += 1) {
      try {
        if ((await fetch(`http://127.0.0.1:${DEV_PORT}/`)).ok) break;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    await run();
  } finally {
    try {
      process.kill(-dev.pid, "SIGTERM"); // the whole group, otherwise the old server keeps running
    } catch {
      /* already gone */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`);
  if (!ok) failures += 1;
};

async function session(fn) {
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
  try {
    await fn(call);
  } finally {
    await browser.close();
  }
}
const base = () => ({
  submissionId: crypto.randomUUID(),
  kind: "bug",
  message: "Transport-Test",
  appVersion: "check",
  lang: "de",
  route: "/einstellungen",
});
const setMode = (m) => fetch(`http://127.0.0.1:${STUB_PORT}/mode/${m}`);

try {
  console.log("== trusted proxy = vercel");
  await withDevServer({ FEEDBACK_TRUST_PROXY: "vercel" }, () =>
    session(async (call) => {
      const h = { "x-forwarded-for": "198.51.100.9" };
      await setMode("created");
      const ok = await call(base(), h);
      check("valid submission is confirmed", ok.ok && ok.value?.ok === true, JSON.stringify(ok));
      const bad = await call({ ...base(), shifts: [{ id: "x" }] }, h);
      check("extra field -> invalid code only", !bad.ok && bad.message === "feedback:invalid:0", JSON.stringify(bad));
      await setMode("limited");
      const lim = await call(base(), h);
      check("rate limit -> code with retry-after", !lim.ok && lim.message === "feedback:rate_limited:125", JSON.stringify(lim));
      await setMode("error");
      const err = await call(base(), h);
      check("database 500 with SQL text -> unavailable code only", !err.ok && err.message === "feedback:unavailable:0", JSON.stringify(err));
      check("no internal text reaches the client", ![SQL_DETAIL, "XX000", SERVICE_KEY, HASH_SECRET].some((s) => JSON.stringify(err).includes(s)));
      await setMode("created");
      seen.length = 0;
      await call(base(), { "x-forwarded-for": "198.51.100.9" });
      await call(base(), { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 198.51.100.9" });
      await call(base(), { "x-forwarded-for": "203.0.113.5" });
      check("3 database calls, 8 parameters each", seen.length === 3 && seen.every((b) => Object.keys(b).length === 8), String(seen.length));
      check("spoofed left-hand entries do not change the client key", seen[0]?.p_client_key === seen[1]?.p_client_key);
      check("a different client gets a different key", seen[0]?.p_client_key !== seen[2]?.p_client_key);
      check("no raw IP in what is sent to the database", !JSON.stringify(seen).includes("198.51.100.9"));
    }),
  );

  console.log("== no trusted proxy configured (default)");
  await withDevServer({}, () =>
    session(async (call) => {
      await setMode("created");
      seen.length = 0;
      const r = await call(base(), { "x-forwarded-for": "198.51.100.9" });
      check("refused with unavailable code", !r.ok && r.message === "feedback:unavailable:0", JSON.stringify(r));
      check("database never contacted", seen.length === 0, String(seen.length));
    }),
  );
} finally {
  stub.close();
}
console.log(failures === 0 ? "ALL TRANSPORT CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
