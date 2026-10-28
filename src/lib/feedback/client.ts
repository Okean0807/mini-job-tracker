import { readFeedbackError, type FeedbackInput } from "./schema";

export type SendFeedbackOutcome =
  | { status: "sent"; duplicate: boolean }
  | { status: "offline" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "invalid" }
  | { status: "failed" };

type Submit = (args: { data: FeedbackInput }) => Promise<unknown>;

/**
 * Sendet Feedback und ordnet jedes Ergebnis ein. „sent“ nur, wenn der Server
 * die Speicherung ausdrücklich bestätigt hat (`ok: true`). Der Aufrufer behält
 * dieselbe `submissionId` für Wiederholungen, damit nichts doppelt gespeichert wird.
 */
export async function sendFeedback(
  input: FeedbackInput,
  submit: Submit,
): Promise<SendFeedbackOutcome> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { status: "offline" };
  }
  try {
    const result = (await submit({ data: input })) as { ok?: unknown; duplicate?: unknown } | null;
    if (result && result.ok === true) {
      return { status: "sent", duplicate: result.duplicate === true };
    }
    return { status: "failed" };
  } catch (error) {
    const known = readFeedbackError(error);
    if (known?.code === "rate_limited") {
      return { status: "rate_limited", retryAfterSeconds: known.retry };
    }
    if (known?.code === "invalid") return { status: "invalid" };
    return { status: "failed" }; // Netzwerk, HTML-Fehlerseite, unbekannt – keine Details zeigen
  }
}
