import { afterEach, describe, expect, it, vi } from "vitest";

import { sendFeedback } from "./client";
import { FeedbackError, type FeedbackInput } from "./schema";

const input: FeedbackInput = {
  submissionId: "11111111-1111-4111-8111-111111111111",
  kind: "bug",
  message: "Fehler",
  appVersion: "1.0.0",
  lang: "de",
  route: "/",
};
afterEach(() => vi.restoreAllMocks());

describe("sendFeedback", () => {
  it("reports sent only when the server confirmed ok:true", async () => {
    expect(await sendFeedback(input, async () => ({ ok: true, duplicate: false }))).toEqual({
      status: "sent",
      duplicate: false,
    });
    expect(await sendFeedback(input, async () => ({ ok: true, duplicate: true }))).toEqual({
      status: "sent",
      duplicate: true,
    });
  });

  it.each([undefined, null, {}, { ok: false }, { ok: "true" }, "ok"])(
    "an unconfirmed response (%j) is a failure, not a success",
    async (response) => {
      expect((await sendFeedback(input, async () => response)).status).toBe("failed");
    },
  );

  it("offline: does not even call the server", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const submit = vi.fn();
    expect(await sendFeedback(input, submit)).toEqual({ status: "offline" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("network error, HTML error page and unknown errors -> failed (no details)", async () => {
    for (const error of [new TypeError("Failed to fetch"), "<html>502</html>", { weird: true }]) {
      const r = await sendFeedback(input, async () => {
        throw error;
      });
      expect(r).toEqual({ status: "failed" });
    }
  });

  it("auth failures: server codes and the auth middleware's 'Unauthorized: …' map to unauthenticated", async () => {
    for (const error of [
      new FeedbackError("unauthenticated"),
      new Error("Unauthorized: No authorization header provided"),
      new Error("Unauthorized: Invalid token"),
    ]) {
      const r = await sendFeedback(input, async () => {
        throw error;
      });
      expect(r).toEqual({ status: "unauthenticated" });
    }
    expect(
      await sendFeedback(input, async () => {
        throw new FeedbackError("forbidden");
      }),
    ).toEqual({ status: "forbidden" });
  });

  it("an error that merely mentions 'unauthorized' later in the text is not an auth failure", async () => {
    const r = await sendFeedback(input, async () => {
      throw new Error("proxy said: not Unauthorized");
    });
    expect(r).toEqual({ status: "failed" });
  });

  it("maps server error codes", async () => {
    expect(
      await sendFeedback(input, async () => {
        throw new FeedbackError("rate_limited", 300);
      }),
    ).toEqual({ status: "rate_limited", retryAfterSeconds: 300 });
    expect(
      await sendFeedback(input, async () => {
        throw new FeedbackError("invalid");
      }),
    ).toEqual({ status: "invalid" });
    expect(
      await sendFeedback(input, async () => {
        throw new FeedbackError("unavailable");
      }),
    ).toEqual({ status: "failed" });
  });

  it("a retry after a network error sends the same submissionId", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, duplicate: false });
    expect((await sendFeedback(input, submit)).status).toBe("failed");
    expect((await sendFeedback(input, submit)).status).toBe("sent");
    const ids = submit.mock.calls.map((c) => (c[0] as { data: FeedbackInput }).data.submissionId);
    expect(ids).toEqual([input.submissionId, input.submissionId]);
  });
});
