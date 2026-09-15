import { describe, expect, it } from "vitest";

import {
  aiClientErrorMessage,
  isTechnicalAiErrorMessage,
  sanitizeAiClientMessage,
} from "./ai-client-error";

describe("aiClientErrorMessage", () => {
  it("keeps already-safe German unavailable messages", () => {
    expect(aiClientErrorMessage(new Error("KI ist derzeit nicht verfügbar."), "fallback")).toBe(
      "KI ist derzeit nicht verfügbar.",
    );
  });

  it("sanitizes Unauthorized / API key / technical auth text", () => {
    expect(
      aiClientErrorMessage(new Error("Unauthorized: No authorization header provided"), "fallback"),
    ).toBe("Anmeldung bei der KI fehlgeschlagen. Bitte später erneut versuchen.");
    expect(aiClientErrorMessage(new Error("Invalid API key"), "fallback")).toBe(
      "Anmeldung bei der KI fehlgeschlagen. Bitte später erneut versuchen.",
    );
  });

  it("sanitizes GEMINI_ and HTTP technical leaks", () => {
    expect(aiClientErrorMessage(new Error("Prüfe GEMINI_MODEL bitte"), "fallback")).toBe(
      "KI-Dienst vorübergehend nicht erreichbar. Bitte später erneut versuchen.",
    );
    expect(aiClientErrorMessage(new Error("Die KI konnte nicht antworten. (HTTP 502)"), "fallback")).toBe(
      "Die KI konnte nicht antworten. Bitte später erneut versuchen.",
    );
  });

  it("reads message from plain objects and strings", () => {
    expect(aiClientErrorMessage({ message: "KI-Guthaben aufgebraucht." }, "fallback")).toBe(
      "KI-Guthaben aufgebraucht.",
    );
    expect(aiClientErrorMessage("  Zu viele Anfragen  ", "fallback")).toBe("Zu viele Anfragen");
  });

  it("walks cause and sanitizes nested Unauthorized", () => {
    const wrapped = { message: "", cause: new Error("Unauthorized: Invalid token") };
    expect(aiClientErrorMessage(wrapped, "fallback")).toBe(
      "Anmeldung bei der KI fehlgeschlagen. Bitte später erneut versuchen.",
    );
    expect(aiClientErrorMessage(null, "fallback")).toBe("fallback");
    expect(aiClientErrorMessage({}, "fallback")).toBe("fallback");
  });
});

describe("sanitizeAiClientMessage / isTechnicalAiErrorMessage", () => {
  it("flags technical patterns", () => {
    expect(isTechnicalAiErrorMessage("Unauthorized")).toBe(true);
    expect(isTechnicalAiErrorMessage("GEMINI_API_KEY missing")).toBe(true);
    expect(isTechnicalAiErrorMessage("HTTP 503")).toBe(true);
    expect(isTechnicalAiErrorMessage("KI ist derzeit nicht verfügbar.")).toBe(false);
  });

  it("returns fallback for empty after sanitize path", () => {
    expect(sanitizeAiClientMessage("   ", "fallback")).toBe("fallback");
  });
});
