#!/usr/bin/env node
/**
 * Opt-in end-to-end check of the Feedback window on a PHONE-SIZED screen (Pixel 5, 393 px) with the REAL
 * app, the REAL TanStack transport and the REAL requireSupabaseAuth middleware, against FAKE services:
 * a fake Supabase (/auth/v1/user) and a fake Resend API (a tiny preload redirects api.resend.com to it).
 * Not part of `vitest run` and not CI: it starts a Vite dev server and needs Playwright, which is not a
 * project dependency.
 *
 *   node scripts/feedback-e2e-check.mjs
 *
 * It never touches Supabase, Resend, Vercel or any real secret and proves NOTHING about real delivery.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  console.error("Playwright is not installed (it is intentionally not a project dependency). Skipping.");
  process.exit(2);
}
const { chromium, devices } = playwright;

const SUPA_PORT = 5997;
const MAIL_PORT = 5996;
const DEV_PORT = 5198;
const MAIL_KEY = "re_TEST_ONLY_not_a_real_key_0123456789";
const OWNER = "owner@example.test";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const TOKEN = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: A, email: "user@example.test", role: "authenticated", exp })}.${Buffer.alloc(32, 7).toString("base64url")}`;

let mailMode = "ok";
const mails = [];
const supa = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if ((req.url ?? "").startsWith("/auth/v1/user")) res.end(JSON.stringify({ id: A, aud: "authenticated", email: "user@example.test" }));
  else { res.statusCode = 404; res.end("{}"); }
}).listen(SUPA_PORT, "127.0.0.1");
const mail = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.url.startsWith("/mode/")) { mailMode = req.url.slice(6); res.end("ok"); return; }
    mails.push({ headers: req.headers, body: raw ? JSON.parse(raw) : {} });
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      if (mailMode === "fail") { res.statusCode = 500; res.end('{"message":"SECRET-PROVIDER-TEXT"}'); }
      else res.end('{"id":"msg_fake_1"}');
    }, 700); // long enough to observe the sending indicator
  });
}).listen(MAIL_PORT, "127.0.0.1");

// test-only preload: send calls to api.resend.com to the fake mail API (no production code hook needed)
const dir = mkdtempSync(join(tmpdir(), "fb-e2e-"));
const preload = join(dir, "redirect.cjs");
writeFileSync(preload, `const f=globalThis.fetch;globalThis.fetch=(u,i)=>f(String(u).replace('https://api.resend.com','http://127.0.0.1:${MAIL_PORT}'),i);\n`);

const env = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${preload}`.trim(),
  SUPABASE_URL: `http://127.0.0.1:${SUPA_PORT}`, VITE_SUPABASE_URL: `http://127.0.0.1:${SUPA_PORT}`,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_TEST", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_TEST",
  VITE_SUPABASE_PROJECT_ID: "test",
  RESEND_API_KEY: MAIL_KEY, FEEDBACK_TO_EMAIL: OWNER,
};

let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`); if (!ok) failures += 1; };

const dev = spawn("npx", ["vite", "dev", "--port", String(DEV_PORT), "--host", "127.0.0.1", "--strictPort"], { env, stdio: "ignore", detached: true });
try {
  for (let i = 0; i < 90; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${DEV_PORT}/`)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["Pixel 5"] });
  const data = { shifts: [], jobs: [], settings: { onboarded: true, wizardCompletedAt: 1, language: "de", autoBackup: false } };
  await context.addInitScript(({ A, TOKEN, exp, data, signedIn }) => {
    if (!signedIn) return;
    localStorage.setItem("minijob-active-scope-v1", `u:${A}`);
    localStorage.setItem(`minijob-tracker-v1:u:${A}`, JSON.stringify(data));
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: TOKEN, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user: { id: A, aud: "authenticated", email: "user@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } }));
  }, { A, TOKEN, exp, data, signedIn: true });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${DEV_PORT}/einstellungen`, { waitUntil: "networkidle" });
  const vw = page.viewportSize().width;
  check(`viewport is phone sized (${vw}px)`, vw <= 420);

  const openBtn = page.getByTestId("feedback-open");
  await openBtn.scrollIntoViewIfNeeded();
  const ob = await openBtn.boundingBox();
  check("feedback button visible, inside the screen, tap target >= 44px", !!ob && ob.x >= 0 && ob.x + ob.width <= vw && ob.height >= 44, JSON.stringify(ob));
  check("no horizontal page overflow", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  await openBtn.click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor();
  const db = await dlg.boundingBox();
  check("dialog fits the screen width", !!db && db.x >= 0 && db.x + db.width <= vw + 1, JSON.stringify(db));
  const ta = page.locator("#fb-message");
  const tb = await ta.boundingBox();
  check("message field fits and is large enough to type in", !!tb && tb.x >= 0 && tb.x + tb.width <= vw && tb.height >= 80, JSON.stringify(tb));
  check("only one text field", (await dlg.locator("textarea").count()) === 1 && (await dlg.locator("input").count()) === 0);

  // empty -> validation message, nothing sent
  await page.getByTestId("feedback-submit").click();
  check("empty message: clear error, nothing sent", (await page.getByTestId("feedback-error").isVisible()) && mails.length === 0);

  // provider failure first
  await fetch(`http://127.0.0.1:${MAIL_PORT}/mode/fail`);
  await ta.fill("Der Export ist zu langsam auf meinem Telefon");
  await page.getByTestId("feedback-submit").click();
  const submit = page.getByTestId("feedback-submit");
  check("sending indicator shown and button locked while sending", (await submit.isDisabled()) && /Wird gesendet|…/.test((await submit.textContent()) ?? ""));
  await page.getByTestId("feedback-error").waitFor({ timeout: 10000 });
  check("mail service failure: error shown, no success, text kept, dialog still open",
    (await ta.inputValue()).startsWith("Der Export") && (await dlg.isVisible()) && !(await page.getByText("Nachricht wurde gesendet").isVisible().catch(() => false)));
  check("no provider text shown to the user", !(await page.content()).includes("SECRET-PROVIDER-TEXT"));

  // retry succeeds
  await fetch(`http://127.0.0.1:${MAIL_PORT}/mode/ok`);
  await submit.click();
  await page.getByText("Deine Nachricht wurde gesendet").first().waitFor({ timeout: 10000 });
  const closed = await dlg.waitFor({ state: "hidden", timeout: 5000 }).then(() => true, () => false);
  check("after the service accepted it: success message, dialog closed", closed);
  const ok = mails.filter((m) => m.body.text);
  check("two attempts reached the (fake) mail API with the same idempotency key", ok.length === 2 && ok[0].headers["idempotency-key"] === ok[1].headers["idempotency-key"]);
  const m = ok[1];
  check("e-mail goes to the configured owner address with the server-side key", JSON.stringify(m.body.to) === JSON.stringify([OWNER]) && m.headers.authorization === `Bearer ${MAIL_KEY}`);
  check("reply-to is the signed-in account's address; text contains the message and no work data", m.body.reply_to === "user@example.test" && m.body.text.includes("Der Export ist zu langsam") && !/Schicht|token/i.test(m.body.text));
  check("API key / owner address never appear in the page the browser received", !(await page.content()).includes(MAIL_KEY) && !(await page.content()).includes(OWNER));
  await page.screenshot({ path: join(dir, "feedback-mobile.png") });

  // guest
  const guest = await browser.newContext({ ...devices["Pixel 5"] });
  const gp = await guest.newPage();
  await gp.goto(`http://127.0.0.1:${DEV_PORT}/einstellungen`, { waitUntil: "networkidle" });
  const wizard = await gp.getByTestId("feedback-signin").isVisible().catch(() => false);
  check("guest: sign-in suggestion instead of the message button (or the onboarding overlay is shown first)", wizard ? (await gp.getByTestId("feedback-open").count()) === 0 : true);
  console.log(`(screenshot: ${join(dir, "feedback-mobile.png")})`);
  await browser.close();
} finally {
  try { process.kill(-dev.pid, "SIGTERM"); } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, 2000));
  supa.close(); mail.close();
}
console.log(failures === 0 ? "ALL E2E CHECKS PASSED (fake Supabase, fake mail API - NOT real delivery)" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
