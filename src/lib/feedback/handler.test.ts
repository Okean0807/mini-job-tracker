import { describe, expect, it, vi } from "vitest";

import { handleFeedback, isPlainEmail, readMailConfig, type FeedbackDeps } from "./handler";
import type { MailMessage } from "./mailer";
import { createRateLimiter } from "./rate-limit";
import { FeedbackError } from "./schema";

const input = {
  submissionId: "11111111-1111-4111-8111-111111111111",
  message: "  Der Export ist zu langsam  ",
  appVersion: "1.0.0",
  lang: "de",
  route: "/einstellungen",
};
const config = {
  apiKey: "re_test",
  to: "owner@example.test",
  from: "MiniJob Companion <onboarding@resend.dev>",
};

function setup(over: Partial<FeedbackDeps> = {}, sendResult: unknown = { ok: true, id: "msg_1" }) {
  const send = vi.fn(async (_m: MailMessage) => sendResult as never);
  const log = vi.fn();
  const deps: FeedbackDeps = {
    user: { id: "user-a", email: "a@example.test" },
    config,
    rateLimiter: createRateLimiter(),
    send: send as never,
    now: () => new Date("2026-10-28T12:00:00.000Z"),
    sent: new Set(),
    log,
    ...over,
  };
  return { send, log, deps };
}
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as FeedbackError;
  }
  throw new Error("expected rejection");
};

describe("a valid message", () => {
  it("is sent to the configured recipient only, as plain text with context, and confirmed", async () => {
    const { send, deps } = setup();
    await expect(handleFeedback(input, deps)).resolves.toEqual({ ok: true, duplicate: false });
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0]![0];
    expect(mail.to).toBe("owner@example.test");
    expect(mail.from).toBe(config.from);
    expect(mail.subject).toBe("MiniJob Companion – Feedback");
    expect(mail.replyTo).toBe("a@example.test");
    expect(mail.idempotencyKey).toBe(`feedback-${input.submissionId}`);
    expect(mail.text).toContain("Der Export ist zu langsam");
    expect(mail.text).toContain("Antwort an: a@example.test");
    expect(mail.text).toContain("App-Version: 1.0.0");
    expect(mail.text).toContain("Sprache: de");
    expect(mail.text).toContain("Seite: /einstellungen");
    expect(mail.text).toContain("Zeit: 2026-10-28T12:00:00.000Z");
  });

  it("contains nothing else about the user: no id, no token, no work data", async () => {
    const { send, deps } = setup();
    await handleFeedback(input, deps);
    const mail = send.mock.calls[0]![0];
    expect(JSON.stringify(mail)).not.toContain("user-a");
    expect(mail.text).not.toMatch(/token|Schicht|Lohn|shift/i);
  });

  it("the subject never contains user text (no header injection)", async () => {
    const { send, deps } = setup();
    await handleFeedback(
      { ...input, message: "Hallo\r\nBcc: evil@example.com\r\nSubject: x" },
      deps,
    );
    const mail = send.mock.calls[0]![0];
    expect(mail.subject).toBe("MiniJob Companion – Feedback");
    expect(mail.to).toBe("owner@example.test");
    expect(mail.text).toContain("Bcc: evil@example.com"); // harmless inside the body
  });

  it("control characters are stripped from the body", async () => {
    const { send, deps } = setup();
    await handleFeedback({ ...input, message: "Eins\u0000Zwei\u0007" }, deps);
    expect(send.mock.calls[0]![0].text).toContain("EinsZwei");
  });

  it("works without an e-mail address in the account (no reply-to)", async () => {
    const { send, deps } = setup({ user: { id: "user-a" } });
    await handleFeedback(input, deps);
    const mail = send.mock.calls[0]![0];
    expect(mail.replyTo).toBeUndefined();
    expect(mail.text).toContain("(keine E-Mail-Adresse im Konto)");
  });

  it("an implausible account e-mail is not used as reply-to", async () => {
    const { send, deps } = setup({ user: { id: "user-a", email: "a@b.de\r\nBcc: x@y.z" } });
    await handleFeedback(input, deps);
    expect(send.mock.calls[0]![0].replyTo).toBeUndefined();
  });
});

describe("invalid input never reaches the mail service", () => {
  it.each([
    ["empty", { ...input, message: "" }],
    ["whitespace", { ...input, message: "   \n  " }],
    ["too short", { ...input, message: "ab" }],
    ["too long", { ...input, message: "x".repeat(2001) }],
    ["recipient from the request", { ...input, to: "evil@example.com" }],
    ["reply-to from the request", { ...input, replyTo: "evil@example.com" }],
    ["user id from the request", { ...input, userId: "other" }],
    ["not an object", "hello"],
    ["null", null],
  ])("%s", async (_n, raw) => {
    const { send, deps } = setup();
    expect((await fails(handleFeedback(raw, deps))).code).toBe("invalid");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("who may send", () => {
  it("no user id -> unauthenticated; anonymous session -> forbidden; nothing is sent", async () => {
    const a = setup({ user: { id: "" } });
    expect((await fails(handleFeedback(input, a.deps))).code).toBe("unauthenticated");
    const b = setup({ user: { id: "anon-1", isAnonymous: true } });
    expect((await fails(handleFeedback(input, b.deps))).code).toBe("forbidden");
    expect(a.send).not.toHaveBeenCalled();
    expect(b.send).not.toHaveBeenCalled();
  });
});

describe("rate limit", () => {
  it("the 6th message of a user within the hour is refused with a retry-after; others still work", async () => {
    const rateLimiter = createRateLimiter();
    const { send, deps } = setup({ rateLimiter });
    for (let i = 0; i < 5; i += 1) {
      await handleFeedback({ ...input, submissionId: crypto.randomUUID() }, deps);
    }
    const e = await fails(handleFeedback({ ...input, submissionId: crypto.randomUUID() }, deps));
    expect(e.code).toBe("rate_limited");
    expect(e.retryAfterSeconds).toBeGreaterThan(0);
    expect(send).toHaveBeenCalledTimes(5);
    const other = setup({ rateLimiter, user: { id: "user-b" } });
    await expect(
      handleFeedback({ ...input, submissionId: crypto.randomUUID() }, other.deps),
    ).resolves.toMatchObject({ ok: true });
  });

  it("failed attempts count towards the limit (protects the mail API from retry storms)", async () => {
    const { deps } = setup({}, { ok: false, reason: "http-500" });
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await fails(handleFeedback({ ...input, submissionId: crypto.randomUUID() }, deps))).code,
      ).toBe("unavailable");
    }
    expect(
      (await fails(handleFeedback({ ...input, submissionId: crypto.randomUUID() }, deps))).code,
    ).toBe("rate_limited");
  });
});

describe("mail service problems: never a false success, never details", () => {
  it.each([
    ["not accepted", { ok: false, reason: "http-403" }],
    ["timeout", { ok: false, reason: "timeout" }],
    ["network", { ok: false, reason: "network" }],
  ])("%s -> unavailable", async (_n, result) => {
    const { deps, log } = setup({}, result);
    const e = await fails(handleFeedback(input, deps));
    expect(e.code).toBe("unavailable");
    expect(e.message).toBe("feedback:unavailable:0");
    expect(JSON.stringify(log.mock.calls)).not.toContain("owner@example.test");
    expect(JSON.stringify(log.mock.calls)).not.toContain("re_test");
    expect(JSON.stringify(log.mock.calls)).not.toContain("Export"); // no message text in logs
  });

  it("a thrown send error -> unavailable", async () => {
    const { deps } = setup({
      send: vi.fn(async () => {
        throw new Error("SECRET");
      }) as never,
    });
    const e = await fails(handleFeedback(input, deps));
    expect(e.code).toBe("unavailable");
    expect(e.message).not.toContain("SECRET");
  });

  it("not configured (no key / recipient) -> unavailable without any send attempt", async () => {
    const { send, deps } = setup({ config: null });
    expect((await fails(handleFeedback(input, deps))).code).toBe("unavailable");
    expect(send).not.toHaveBeenCalled();
  });

  it("a failed attempt can be retried with the same form id and then succeeds once", async () => {
    const sent = new Set<string>();
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "timeout" })
      .mockResolvedValueOnce({ ok: true, id: "msg_2" });
    const { deps } = setup({ send: send as never, sent });
    expect((await fails(handleFeedback(input, deps))).code).toBe("unavailable");
    await expect(handleFeedback(input, deps)).resolves.toEqual({ ok: true, duplicate: false });
    // a third try with the same id is reported as already sent and does not send again
    await expect(handleFeedback(input, deps)).resolves.toEqual({ ok: true, duplicate: true });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("mail configuration", () => {
  const good = { RESEND_API_KEY: "re_x", FEEDBACK_TO_EMAIL: "owner@example.test" };

  it("needs an API key and a plain recipient address; the sender defaults to the service's test sender", () => {
    expect(readMailConfig(good)).toEqual({
      apiKey: "re_x",
      to: "owner@example.test",
      from: "MiniJob Companion <onboarding@resend.dev>",
    });
  });

  it.each([
    [{ ...good, RESEND_API_KEY: "" }],
    [{ ...good, RESEND_API_KEY: undefined }],
    [{ ...good, FEEDBACK_TO_EMAIL: "" }],
    [{ ...good, FEEDBACK_TO_EMAIL: "a@b.de, c@d.de" }],
    [{ ...good, FEEDBACK_TO_EMAIL: "Owner <a@b.de>" }],
    [{ ...good, FEEDBACK_TO_EMAIL: "no-at-sign" }],
    [{ ...good, FEEDBACK_FROM_EMAIL: "bad sender" }],
    [{ ...good, FEEDBACK_FROM_EMAIL: "Name <a@b.de>\r\nBcc: x@y.z" }],
  ])("is null (fail closed) for %j", (env) => {
    expect(readMailConfig(env as never)).toBeNull();
  });

  it("accepts a custom sender", () => {
    expect(
      readMailConfig({ ...good, FEEDBACK_FROM_EMAIL: "App <noreply@mail.example.test>" })?.from,
    ).toBe("App <noreply@mail.example.test>");
  });

  it("isPlainEmail", () => {
    expect(isPlainEmail("a@b.de")).toBe(true);
    for (const v of ["", "a", "a@", "@b.de", "a b@c.de", "a@b.de,c@d.de", "a@b.de\n", "<a@b.de>"])
      expect(isPlainEmail(v), v).toBe(false);
  });
});
