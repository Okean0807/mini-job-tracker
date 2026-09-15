import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ASK_CLIENT_TIMEOUT_MS,
  ASK_GATEWAY_TIMEOUT_MESSAGE,
  ASK_GATEWAY_TIMEOUT_MS,
  isAbortOrTimeoutError,
  runAssistantAsk,
  withAskTimeout,
} from "./ai-ask";
import { aiClientErrorMessage } from "./ai-client-error";

describe("ask timeouts (hang root-cause fix)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports gateway timeout shorter than client backup", () => {
    expect(ASK_GATEWAY_TIMEOUT_MS).toBe(30_000);
    expect(ASK_CLIENT_TIMEOUT_MS).toBe(35_000);
    expect(ASK_GATEWAY_TIMEOUT_MS).toBeLessThan(ASK_CLIENT_TIMEOUT_MS);
    expect(ASK_GATEWAY_TIMEOUT_MESSAGE).toMatch(/rechtzeitig/i);
  });

  it("withAskTimeout resolves when promise settles in time", async () => {
    await expect(withAskTimeout(Promise.resolve(42), 1000, () => new Error("late"))).resolves.toBe(
      42,
    );
  });

  it("withAskTimeout rejects on hang (simulates gateway never answering)", async () => {
    vi.useFakeTimers();
    const hanging = new Promise<string>(() => {
      /* never settles — production hang */
    });
    const pending = withAskTimeout(hanging, 50, () => new Error("timeout-msg"));
    const expectation = expect(pending).rejects.toThrow("timeout-msg");
    await vi.advanceTimersByTimeAsync(50);
    await expectation;
  });

  it("isAbortOrTimeoutError detects AbortError and TimeoutError", () => {
    expect(isAbortOrTimeoutError(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(
      true,
    );
    expect(isAbortOrTimeoutError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe(
      true,
    );
    expect(isAbortOrTimeoutError(new Error("network"))).toBe(false);
    expect(isAbortOrTimeoutError(null)).toBe(false);
  });
});

describe("runAssistantAsk — pending never stuck on failure/timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("on invoke failure: busy false + onError with mapped message (not stuck thinking)", async () => {
    const busyLog: boolean[] = [];
    const answers: string[] = [];
    const errors: string[] = [];

    await runAssistantAsk(
      async () => {
        throw new Error("KI ist derzeit nicht verfügbar.");
      },
      {
        setBusy: (b) => busyLog.push(b),
        onAnswer: (r) => answers.push(r.answer),
        onError: (m) => errors.push(m),
      },
      {
        timeoutMs: 5_000,
        mapError: (e) => aiClientErrorMessage(e, "fallback"),
        timeoutMessage: "client-timeout",
      },
    );

    expect(busyLog).toEqual([true, false]);
    expect(answers).toEqual([]);
    expect(errors).toEqual(["KI ist derzeit nicht verfügbar."]);
  });

  it("on hanging invoke: timeout clears busy and surfaces timeout message", async () => {
    vi.useFakeTimers();
    const busyLog: boolean[] = [];
    const errors: string[] = [];

    const done = runAssistantAsk(
      () =>
        new Promise<{ answer: string }>(() => {
          /* hang forever */
        }),
      {
        setBusy: (b) => busyLog.push(b),
        onAnswer: () => {
          throw new Error("should not answer");
        },
        onError: (m) => errors.push(m),
      },
      {
        timeoutMs: 100,
        mapError: (e) => aiClientErrorMessage(e, "fallback"),
        timeoutMessage: "Die KI antwortet nicht rechtzeitig – bitte erneut versuchen.",
      },
    );

    expect(busyLog).toEqual([true]);
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(busyLog).toEqual([true, false]);
    expect(errors).toEqual(["Die KI antwortet nicht rechtzeitig – bitte erneut versuchen."]);
  });

  it("on success: busy false + onAnswer", async () => {
    const busyLog: boolean[] = [];
    const answers: string[] = [];

    await runAssistantAsk(
      async () => ({ answer: "42 Stunden" }),
      {
        setBusy: (b) => busyLog.push(b),
        onAnswer: (r) => answers.push(r.answer),
        onError: () => {
          throw new Error("should not error");
        },
      },
      {
        timeoutMs: 5_000,
        mapError: (e) => aiClientErrorMessage(e, "fallback"),
        timeoutMessage: "client-timeout",
      },
    );

    expect(busyLog).toEqual([true, false]);
    expect(answers).toEqual(["42 Stunden"]);
  });
});
