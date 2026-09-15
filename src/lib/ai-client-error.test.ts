import { describe, expect, it } from "vitest";

import { aiClientErrorMessage } from "./ai-client-error";

describe("aiClientErrorMessage", () => {
  it("prefers Error.message (unavailable / unauthorized)", () => {
    expect(aiClientErrorMessage(new Error("KI ist derzeit nicht verfügbar."), "fallback")).toBe(
      "KI ist derzeit nicht verfügbar.",
    );
    expect(
      aiClientErrorMessage(new Error("Unauthorized: No authorization header provided"), "fallback"),
    ).toBe("Unauthorized: No authorization header provided");
  });

  it("reads message from plain objects and strings", () => {
    expect(aiClientErrorMessage({ message: "KI-Guthaben aufgebraucht." }, "fallback")).toBe(
      "KI-Guthaben aufgebraucht.",
    );
    expect(aiClientErrorMessage("  Zu viele Anfragen  ", "fallback")).toBe("Zu viele Anfragen");
  });

  it("walks cause and falls back when empty", () => {
    const wrapped = { message: "", cause: new Error("Unauthorized: Invalid token") };
    expect(aiClientErrorMessage(wrapped, "fallback")).toBe("Unauthorized: Invalid token");
    expect(aiClientErrorMessage(null, "fallback")).toBe("fallback");
    expect(aiClientErrorMessage({}, "fallback")).toBe("fallback");
  });
});
