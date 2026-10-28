// @vitest-environment node
/** Resend adapter against a FAKE mail API (local HTTP server). It proves the request we send and how we
 * react to answers; it does NOT prove that real e-mail is delivered by Resend. */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { sendMail, type MailMessage } from "./mailer";

const KEY = "re_TEST_ONLY_not_a_real_key_0123456789";
const message: MailMessage = {
  from: "MiniJob Companion <onboarding@resend.dev>",
  to: "owner@example.test",
  subject: "MiniJob Companion – Feedback",
  text: "Hallo\nWelt",
  replyTo: "user@example.test",
  idempotencyKey: "feedback-1111",
};

let server: Server;
let baseUrl = "";
let seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
let answer: () => { status: number; body: string; delayMs?: number } = () => ({
  status: 200,
  body: '{"id":"msg_123"}',
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({
        url: req.url ?? "",
        headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
        body: raw ? JSON.parse(raw) : {},
      });
      const a = answer();
      setTimeout(() => {
        res.statusCode = a.status;
        res.setHeader("content-type", "application/json");
        res.end(a.body);
      }, a.delayMs ?? 0);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.closeAllConnections() ?? server.close(() => r())));
beforeEach(() => {
  seen = [];
  answer = () => ({ status: 200, body: '{"id":"msg_123"}' });
});

describe("request", () => {
  it("POST /emails with bearer key, idempotency key, one recipient, text only, reply_to", async () => {
    const r = await sendMail(message, { apiKey: KEY, baseUrl });
    expect(r).toEqual({ ok: true, id: "msg_123" });
    expect(seen).toHaveLength(1);
    const call = seen[0]!;
    expect(call.url).toBe("/emails");
    expect(call.headers["authorization"]).toBe(`Bearer ${KEY}`);
    expect(call.headers["idempotency-key"]).toBe("feedback-1111");
    expect(call.body).toEqual({
      from: message.from,
      to: ["owner@example.test"],
      subject: message.subject,
      text: message.text,
      reply_to: "user@example.test",
    });
    expect(call.body).not.toHaveProperty("html");
    expect(call.body).not.toHaveProperty("cc");
    expect(call.body).not.toHaveProperty("bcc");
  });

  it("omits reply_to when there is none", async () => {
    await sendMail({ ...message, replyTo: undefined }, { apiKey: KEY, baseUrl });
    expect(seen[0]!.body).not.toHaveProperty("reply_to");
  });
});

describe("only a confirmed acceptance counts as sent", () => {
  it.each([
    ["200 without id", { status: 200, body: "{}" }, "no-id"],
    ["200 with empty id", { status: 200, body: '{"id":""}' }, "no-id"],
    ["200 with numeric id", { status: 200, body: '{"id":5}' }, "no-id"],
    ["200 with html", { status: 200, body: "<html>ok</html>" }, "bad-response"],
    ["401 bad key", { status: 401, body: '{"message":"API key is invalid"}' }, "http-401"],
    [
      "403 sandbox sender",
      {
        status: 403,
        body: '{"message":"You can only send testing emails to your own email address"}',
      },
      "http-403",
    ],
    ["409 idempotency conflict", { status: 409, body: "{}" }, "http-409"],
    ["429 provider rate limit", { status: 429, body: "{}" }, "http-429"],
    ["500", { status: 500, body: "boom" }, "http-500"],
  ])("%s -> not ok (%s)", async (_n, reply, reason) => {
    answer = () => reply;
    const r = await sendMail(message, { apiKey: KEY, baseUrl });
    expect(r).toEqual({ ok: false, reason });
  });

  it("a timeout is reported as such", async () => {
    answer = () => ({ status: 200, body: '{"id":"x"}', delayMs: 400 });
    expect(await sendMail(message, { apiKey: KEY, baseUrl, timeoutMs: 50 })).toEqual({
      ok: false,
      reason: "timeout",
    });
  });

  it("an unreachable service is reported as network", async () => {
    expect(await sendMail(message, { apiKey: KEY, baseUrl: "http://127.0.0.1:9" })).toEqual({
      ok: false,
      reason: "network",
    });
  });

  it("failure reasons never contain the key, the recipient or provider text", async () => {
    answer = () => ({ status: 403, body: `{"message":"${KEY} owner@example.test"}` });
    const r = await sendMail(message, { apiKey: KEY, baseUrl });
    const text = JSON.stringify(r);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("owner@example.test");
  });
});
