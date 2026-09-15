/**
 * Client-side extraction of a user-visible message from askAssistant failures.
 * TanStack Start usually rehydrates Errors, but CSRF/HTML/network paths can yield
 * plain objects or strings — never treat those as a silent hang.
 *
 * Technical / auth / env leakage (Unauthorized, GEMINI_*, HTTP codes, API keys)
 * is sanitized to safe German user copy.
 */

const SAFE_UNAVAILABLE =
  "Die KI ist momentan nicht verfügbar. Bitte später erneut versuchen.";
const SAFE_AUTH =
  "Anmeldung bei der KI fehlgeschlagen. Bitte später erneut versuchen.";
const SAFE_CONFIG =
  "KI-Dienst vorübergehend nicht erreichbar. Bitte später erneut versuchen.";
const SAFE_HTTP = "Die KI konnte nicht antworten. Bitte später erneut versuchen.";

/** True when the raw message looks technical / unsafe for end users. */
export function isTechnicalAiErrorMessage(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  return (
    /unauthorized/i.test(s) ||
    /authorization\s*header/i.test(s) ||
    /api[_\s-]?key/i.test(s) ||
    /GEMINI_/i.test(s) ||
    /\bHTTP\s*\d{3}\b/i.test(s) ||
    /\bstatus\s*[:=]?\s*\d{3}\b/i.test(s) ||
    /bearer\s+[a-z0-9._-]+/i.test(s) ||
    /\bsk-[a-z0-9]+/i.test(s) ||
    /x-goog-api-key/i.test(s) ||
    /invalid.?argument|RESOURCE_EXHAUSTED|PERMISSION_DENIED/i.test(s)
  );
}

/** Map technical failure text to a safe DE user message (never echo secrets). */
export function sanitizeAiClientMessage(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if (!isTechnicalAiErrorMessage(trimmed)) return trimmed;

  if (/unauthorized|authorization\s*header|api[_\s-]?key|bearer\b|sk-/i.test(trimmed)) {
    return SAFE_AUTH;
  }
  if (/GEMINI_/i.test(trimmed)) {
    return SAFE_CONFIG;
  }
  if (/\bHTTP\s*\d{3}\b/i.test(trimmed) || /\bstatus\s*[:=]?\s*\d{3}\b/i.test(trimmed)) {
    return SAFE_HTTP;
  }
  return SAFE_UNAVAILABLE;
}

function extractRaw(error: unknown): string | null {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined && cause !== error) {
      return extractRaw(cause);
    }
  }
  return null;
}

export function aiClientErrorMessage(error: unknown, fallback: string): string {
  const raw = extractRaw(error);
  if (!raw) return fallback;
  return sanitizeAiClientMessage(raw, fallback);
}
