import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AI_CLIENT_SAFE_MESSAGES,
  aiClientErrorMessage,
  classifyAiClientError,
  isNetworkAiErrorMessage,
  isTechnicalAiErrorMessage,
  sanitizeAiClientMessage,
} from "./ai-client-error";

describe("aiClientErrorMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps already-safe German unavailable messages", () => {
    expect(aiClientErrorMessage(new Error("KI ist derzeit nicht verfügbar."), "fallback")).toBe(
      "KI ist derzeit nicht verfügbar.",
    );
  });

  it("sanitizes Unauthorized / API key / technical auth text", () => {
    expect(
      aiClientErrorMessage(new Error("Unauthorized: No authorization header provided"), "fallback"),
    ).toBe(AI_CLIENT_SAFE_MESSAGES.auth);
    expect(aiClientErrorMessage(new Error("Invalid API key"), "fallback")).toBe(
      AI_CLIENT_SAFE_MESSAGES.auth,
    );
  });

  it("sanitizes GEMINI_ and HTTP technical leaks", () => {
    expect(aiClientErrorMessage(new Error("Prüfe GEMINI_MODEL bitte"), "fallback")).toBe(
      AI_CLIENT_SAFE_MESSAGES.config,
    );
    expect(aiClientErrorMessage(new Error("Die KI konnte nicht antworten. (HTTP 502)"), "fallback")).toBe(
      AI_CLIENT_SAFE_MESSAGES.http,
    );
  });

  it("maps Failed to fetch / network / CORS to German network message (never raw EN)", () => {
    expect(aiClientErrorMessage(new Error("Failed to fetch"), "fallback")).toBe(
      AI_CLIENT_SAFE_MESSAGES.network,
    );
    expect(aiClientErrorMessage(new TypeError("Failed to fetch"), "fallback")).toBe(
      AI_CLIENT_SAFE_MESSAGES.network,
    );
    expect(aiClientErrorMessage(new Error("NetworkError when attempting to fetch resource."), "fallback")).toBe(
      AI_CLIENT_SAFE_MESSAGES.network,
    );
    expect(aiClientErrorMessage(new Error("Load failed"), "fallback")).toBe(
      AI_CLIENT_SAFE_MESSAGES.network,
    );
    expect(aiClientErrorMessage(new Error("CORS error blocked request"), "fallback")).toBe(
      AI_CLIENT_SAFE_MESSAGES.network,
    );
    const mapped = aiClientErrorMessage(new Error("Failed to fetch"), "fallback");
    expect(mapped).not.toMatch(/Failed to fetch/i);
    expect(mapped).toMatch(/Netzwerk|Verbindung/i);
  });

  it("maps offline navigator to offline DE message", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(aiClientErrorMessage(new Error("Failed to fetch"), "fallback")).toBe(
      AI_CLIENT_SAFE_MESSAGES.offline,
    );
    expect(aiClientErrorMessage(null, "fallback")).toBe(AI_CLIENT_SAFE_MESSAGES.offline);
  });

  it("maps timeout / abort text to timeout DE message", () => {
    expect(aiClientErrorMessage(new Error("The operation was aborted due to timeout"), "fallback")).toBe(
      AI_CLIENT_SAFE_MESSAGES.timeout,
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
    expect(aiClientErrorMessage(wrapped, "fallback")).toBe(AI_CLIENT_SAFE_MESSAGES.auth);
    expect(aiClientErrorMessage(null, "fallback")).toBe("fallback");
    expect(aiClientErrorMessage({}, "fallback")).toBe("fallback");
  });
});

describe("sanitizeAiClientMessage / isTechnicalAiErrorMessage / classify", () => {
  it("flags technical patterns including Failed to fetch", () => {
    expect(isTechnicalAiErrorMessage("Unauthorized")).toBe(true);
    expect(isTechnicalAiErrorMessage("GEMINI_API_KEY missing")).toBe(true);
    expect(isTechnicalAiErrorMessage("HTTP 503")).toBe(true);
    expect(isTechnicalAiErrorMessage("Failed to fetch")).toBe(true);
    expect(isNetworkAiErrorMessage("Failed to fetch")).toBe(true);
    expect(isTechnicalAiErrorMessage("KI ist derzeit nicht verfügbar.")).toBe(false);
  });

  it("classifies network vs auth", () => {
    expect(classifyAiClientError("Failed to fetch")).toBe("network");
    expect(classifyAiClientError("Unauthorized")).toBe("auth");
    expect(classifyAiClientError("KI ist derzeit nicht verfügbar.")).toBe("safe");
  });

  it("returns fallback for empty after sanitize path", () => {
    expect(sanitizeAiClientMessage("   ", "fallback")).toBe("fallback");
  });
});
