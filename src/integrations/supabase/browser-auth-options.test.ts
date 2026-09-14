import { describe, expect, it, vi } from "vitest";

vi.mock("./previewAuthStorage", () => ({
  brokeredPreviewStorage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
}));

describe("createBrowserAuthOptions", () => {
  it("uses PKCE + detectSessionInUrl + persistSession", async () => {
    const { createBrowserAuthOptions } = await import("./browser-auth-options");
    const opts = createBrowserAuthOptions();
    expect(opts.flowType).toBe("pkce");
    expect(opts.detectSessionInUrl).toBe(true);
    expect(opts.persistSession).toBe(true);
    expect(opts.autoRefreshToken).toBe(true);
    expect(opts.storage).toBeTruthy();
  });
});
