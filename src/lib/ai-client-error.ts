/**
 * Client-side extraction of a user-visible message from askAssistant failures.
 * TanStack Start usually rehydrates Errors, but CSRF/HTML/network paths can yield
 * plain objects or strings — never treat those as a silent hang.
 *
 * Technical / auth / env / network leakage (Unauthorized, GEMINI_*, HTTP codes,
 * "Failed to fetch", API keys) is sanitized to safe German user copy.
 */

const SAFE_UNAVAILABLE =
  "Die KI ist momentan nicht verfügbar. Bitte später erneut versuchen.";
const SAFE_AUTH =
  "Anmeldung bei der KI fehlgeschlagen. Bitte später erneut versuchen.";
const SAFE_CONFIG =
  "KI-Dienst vorübergehend nicht erreichbar. Bitte später erneut versuchen.";
const SAFE_HTTP = "Die KI konnte nicht antworten. Bitte später erneut versuchen.";
const SAFE_NETWORK =
  "Verbindung zur KI fehlgeschlagen. Bitte Netzwerk prüfen und erneut versuchen.";
const SAFE_OFFLINE =
  "Keine Internetverbindung. Bitte prüfe dein Netz und versuche es erneut.";
const SAFE_TIMEOUT =
  "Die KI antwortet nicht rechtzeitig – bitte erneut versuchen.";

export type AiClientErrorKind =
  | "offline"
  | "network"
  | "timeout"
  | "auth"
  | "config"
  | "http"
  | "unavailable"
  | "safe";

/** True when the browser reports no network (best-effort; SSR-safe). */
export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Network / CORS / transport failures that browsers surface as Failed to fetch. */
export function isNetworkAiErrorMessage(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  return (
    /failed to fetch/i.test(s) ||
    /networkerror/i.test(s) ||
    /network request failed/i.test(s) ||
    /fetch failed/i.test(s) ||
    /load failed/i.test(s) ||
    /err_network|err_internet_disconnected|err_connection/i.test(s) ||
    /econnrefused|enotfound|econnreset|etimedout/i.test(s) ||
    /\bcors\b/i.test(s) ||
    /net::err_/i.test(s)
  );
}

export function isTimeoutAiErrorMessage(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  return /timeout|timed?\s*out|abort(ed)?/i.test(s) || /nicht rechtzeitig/i.test(s);
}

/** True when the raw message looks technical / unsafe for end users. */
export function isTechnicalAiErrorMessage(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (isNetworkAiErrorMessage(s) || isTimeoutAiErrorMessage(s)) return true;
  return (
    /unauthorized/i.test(s) ||
    /authorization\s*header/i.test(s) ||
    /api[_\s-]?key/i.test(s) ||
    /GEMINI_/i.test(s) ||
    /\bHTTP\s*\d{3}\b/i.test(s) ||
    /\bstatus\s*[:=]?\s*\d{3}\b/i.test(s) ||
    /Bearer\s+[a-z0-9._-]+/i.test(s) ||
    /\bsk-[a-z0-9]+/i.test(s) ||
    /x-goog-api-key/i.test(s) ||
    /invalid.?argument|RESOURCE_EXHAUSTED|PERMISSION_DENIED/i.test(s)
  );
}

/** Classify failure for optional support / diagnostics (never shown raw to users). */
export function classifyAiClientError(raw: string): AiClientErrorKind {
  const trimmed = raw.trim();
  if (!trimmed) return "unavailable";
  if (isBrowserOffline() || /offline|internetverbindung/i.test(trimmed)) return "offline";
  if (isNetworkAiErrorMessage(trimmed)) return "network";
  if (isTimeoutAiErrorMessage(trimmed)) return "timeout";
  if (/unauthorized|authorization\s*header|api[_\s-]?key|bearer\b|sk-/i.test(trimmed)) {
    return "auth";
  }
  if (/GEMINI_/i.test(trimmed)) return "config";
  if (/\bHTTP\s*\d{3}\b/i.test(trimmed) || /\bstatus\s*[:=]?\s*\d{3}\b/i.test(trimmed)) {
    return "http";
  }
  if (!isTechnicalAiErrorMessage(trimmed)) return "safe";
  return "unavailable";
}

/** Map technical failure text to a safe DE user message (never echo secrets). */
export function sanitizeAiClientMessage(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  const kind = classifyAiClientError(trimmed);
  switch (kind) {
    case "offline":
      return SAFE_OFFLINE;
    case "network":
      return isBrowserOffline() ? SAFE_OFFLINE : SAFE_NETWORK;
    case "timeout":
      return SAFE_TIMEOUT;
    case "auth":
      return SAFE_AUTH;
    case "config":
      return SAFE_CONFIG;
    case "http":
      return SAFE_HTTP;
    case "safe":
      return trimmed;
    case "unavailable":
    default:
      return isTechnicalAiErrorMessage(trimmed) ? SAFE_UNAVAILABLE : trimmed;
  }
}

function extractRaw(error: unknown): string | null {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const name = (error as { name?: unknown }).name;
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
    // TypeError: Failed to fetch often has empty-ish paths; name still helps.
    if (typeof name === "string" && /typeerror|networkerror/i.test(name)) {
      return name === "NetworkError" ? "NetworkError" : "Failed to fetch";
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined && cause !== error) {
      return extractRaw(cause);
    }
  }
  return null;
}

export function aiClientErrorMessage(error: unknown, fallback: string): string {
  // Prefer offline detection even when the thrown message is empty/opaque.
  if (isBrowserOffline()) return SAFE_OFFLINE;
  const raw = extractRaw(error);
  if (!raw) return fallback;
  return sanitizeAiClientMessage(raw, fallback);
}

/** Exported for tests / support copy — never put secrets here. */
export const AI_CLIENT_SAFE_MESSAGES = {
  unavailable: SAFE_UNAVAILABLE,
  auth: SAFE_AUTH,
  config: SAFE_CONFIG,
  http: SAFE_HTTP,
  network: SAFE_NETWORK,
  offline: SAFE_OFFLINE,
  timeout: SAFE_TIMEOUT,
} as const;
