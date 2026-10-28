import { describe, expect, it, vi } from "vitest";

import { handleFeedback, type FeedbackDeps } from "./handler";
import { FeedbackError } from "./schema";

const input = {
  submissionId: "11111111-1111-4111-8111-111111111111",
  kind: "idea",
  message: "  Dunkler Modus wäre schön  ",
  appVersion: "1.0.0",
  lang: "de",
  route: "/einstellungen",
};

function deps(result: { data?: unknown; error?: unknown } | Error) {
  const rpc = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return { data: result.data ?? null, error: result.error ?? null };
  });
  const log = vi.fn();
  return { rpc, log, d: { rpc, clientKey: "k".repeat(32), log } satisfies FeedbackDeps };
}
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as FeedbackError;
  }
  throw new Error("expected rejection");
};

describe("handleFeedback", () => {
  it("stores through the RPC with exactly the allowed arguments (no extra data)", async () => {
    const { rpc, d } = deps({ data: [{ status: "created" }] });
    await expect(handleFeedback(input, d)).resolves.toEqual({ ok: true, duplicate: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0]! as unknown as [string, Record<string, unknown>];
    expect(fn).toBe("submit_feedback");
    expect(Object.keys(args).sort()).toEqual(
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
    expect(args["p_message"]).toBe("Dunkler Modus wäre schön"); // trimmed
    expect(args["p_rating"]).toBeNull();
  });

  it("passes the rating only for kind rating", async () => {
    const { rpc, d } = deps({ data: [{ status: "created" }] });
    await handleFeedback({ ...input, kind: "rating", message: "", rating: 4 }, d);
    expect((rpc.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]["p_rating"]).toBe(
      4,
    );
  });

  it("a duplicate (retry of a stored submission) is a success", async () => {
    const { d } = deps({ data: [{ status: "duplicate" }] });
    await expect(handleFeedback(input, d)).resolves.toEqual({ ok: true, duplicate: true });
  });

  it("rate limit -> FeedbackError rate_limited with retry-after (at least 1 s)", async () => {
    const { d } = deps({ data: [{ status: "rate_limited", retry_after_seconds: 120 }] });
    const e = await fails(handleFeedback(input, d));
    expect(e.code).toBe("rate_limited");
    expect(e.retryAfterSeconds).toBe(120);
    const z = await fails(handleFeedback(input, deps({ data: [{ status: "rate_limited" }] }).d));
    expect(z.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ["database error", { error: { message: "SECRET" } }],
    ["no data", { data: null }],
    ["empty rows", { data: [] }],
    ["unknown status", { data: [{ status: "ok" }] }],
    ["truthy non-string status", { data: [{ status: true }] }],
    ["thrown rpc", new Error("SECRET network")],
  ])("fails closed on %s: never confirms, never leaks details", async (_n, result) => {
    const { d, log } = deps(result as never);
    const e = await fails(handleFeedback(input, d));
    expect(e.code).toBe("unavailable");
    expect(e.message).not.toContain("SECRET");
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
  });

  it.each([
    ["too long", { ...input, message: "x".repeat(2001) }],
    ["bad rating", { ...input, kind: "rating", message: "", rating: 6 }],
    ["rating on idea", { ...input, rating: 3 }],
    ["extra field", { ...input, shifts: [] }],
    ["not an object", "hello"],
    ["null", null],
  ])("invalid input (%s) is rejected before any database call", async (_n, raw) => {
    const { rpc, d } = deps({ data: [{ status: "created" }] });
    const e = await fails(handleFeedback(raw, d));
    expect(e.code).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("honeypot: pretends success but stores nothing", async () => {
    const { rpc, d } = deps({ data: [{ status: "created" }] });
    await expect(handleFeedback({ ...input, website: "http://spam" }, d)).resolves.toEqual({
      ok: true,
      duplicate: false,
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
