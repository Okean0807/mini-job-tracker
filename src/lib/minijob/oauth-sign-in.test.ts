import { describe, expect, it, vi, beforeEach } from "vitest";

const signInWithOAuth = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithOAuth: (...args: unknown[]) => signInWithOAuth(...args),
    },
  },
}));

describe("signInWithOAuthProvider", () => {
  beforeEach(() => {
    signInWithOAuth.mockReset();
    signInWithOAuth.mockResolvedValue({ data: { url: "https://example", provider: "google" }, error: null });
  });

  it("calls supabase.auth.signInWithOAuth with provider and redirectTo (not Lovable broker)", async () => {
    const { signInWithOAuthProvider } = await import("./oauth-sign-in");
    const result = await signInWithOAuthProvider("google", "https://mini-job-tracker-blue.vercel.app");
    expect(result.error).toBeNull();
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://mini-job-tracker-blue.vercel.app",
        skipBrowserRedirect: false,
      },
    });
  });

  it("propagates supabase errors", async () => {
    signInWithOAuth.mockResolvedValue({ data: { url: null, provider: "google" }, error: new Error("provider disabled") });
    const { signInWithOAuthProvider } = await import("./oauth-sign-in");
    const result = await signInWithOAuthProvider("apple", "https://example.com");
    expect(result.error?.message).toBe("provider disabled");
  });
});
