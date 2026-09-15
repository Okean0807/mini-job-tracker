/**
 * Client-side extraction of a user-visible message from askAssistant failures.
 * TanStack Start usually rehydrates Errors, but CSRF/HTML/network paths can yield
 * plain objects or strings — never treat those as a silent hang.
 */
export function aiClientErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined && cause !== error) {
      const nested = aiClientErrorMessage(cause, "");
      if (nested) return nested;
    }
  }
  return fallback;
}
