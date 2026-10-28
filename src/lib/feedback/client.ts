import { readFeedbackError, type FeedbackInput } from "./schema";

export type SendFeedbackOutcome =
  | { status: "sent"; duplicate: boolean }
  | { status: "offline" }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "invalid" }
  | { status: "failed" };

type Submit = (args: { data: FeedbackInput }) => Promise<unknown>;

/** `requireSupabaseAuth` meldet fehlende/ungültige Anmeldung als `Unauthorized: …`. */
function isAuthMiddlewareError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /^\s*Unauthorized\b/.test(message);
}

/**
 * Sendet Feedback und ordnet jedes Ergebnis ein. „sent“ nur, wenn der Server die Speicherung
 * ausdrücklich bestätigt hat (`ok: true`). Der Aufrufer behält dieselbe `submissionId` für
 * Wiederholungen, damit nichts doppelt gespeichert wird. Technische Texte erreichen die UI nie.
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
    if (known?.code === "unauthenticated" || isAuthMiddlewareError(error)) {
      return { status: "unauthenticated" };
    }
    if (known?.code === "forbidden") return { status: "forbidden" };
    return { status: "failed" }; // Netzwerk, HTML-Fehlerseite, unbekannt – keine Details zeigen
  }
}
