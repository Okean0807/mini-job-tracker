/**
 * Ask-turn helpers: prevent silent "thinking forever" when the AI provider or
 * serverFn transport never settles. Server uses AbortSignal.timeout on fetch;
 * client races the serverFn with a slightly longer timeout as defense-in-depth.
 */

import type { AskSource } from "@/lib/ai/types";

/** Provider fetch must abort — unbounded fetch was the production hang. */
export const ASK_GATEWAY_TIMEOUT_MS = 30_000;

/** Client backup: slightly above gateway so server errors win when possible. */
export const ASK_CLIENT_TIMEOUT_MS = 35_000;

export const ASK_GATEWAY_TIMEOUT_MESSAGE =
  "Die KI antwortet nicht rechtzeitig – bitte erneut versuchen.";

export function withAskTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export type AssistantAskResult = {
  answer: string;
  sources?: AskSource[];
};

export type AssistantAskHandlers = {
  setBusy: (busy: boolean) => void;
  onAnswer: (result: AssistantAskResult) => void;
  onError: (message: string) => void;
};

/**
 * Runs one ask turn: always clears busy; on failure/timeout calls onError
 * (toast + chat bubble are the caller's responsibility).
 */
export async function runAssistantAsk(
  invoke: () => Promise<AssistantAskResult>,
  handlers: AssistantAskHandlers,
  options: {
    timeoutMs: number;
    mapError: (error: unknown) => string;
    timeoutMessage: string;
  },
): Promise<void> {
  handlers.setBusy(true);
  try {
    const result = await withAskTimeout(
      invoke(),
      options.timeoutMs,
      () => new Error(options.timeoutMessage),
    );
    handlers.onAnswer(result);
  } catch (error) {
    handlers.onError(options.mapError(error));
  } finally {
    handlers.setBusy(false);
  }
}

/** True when fetch failed because of AbortSignal.timeout / abort. */
export function isAbortOrTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}
