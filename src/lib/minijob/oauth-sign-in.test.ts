import { describe, expect, it, vi, beforeEach } from "vitest";

import { isOAuthLandingPending } from "./post-auth-landing";

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
    window.sessionStorage.clear();
    signInWithOAuth.mockReset();
    signInWithOAuth.mockResolvedValue({ data: { url: "https://example", provider: "google" }, error: null });
  });

  it("calls supabase.auth.signInWithOAuth with google and redirectTo (not Lovable broker)", async () => {
    const { signInWithOAuthProvider } = await import("./oauth-sign-in");
    const result = await signInWithOAuthProvider("google", "https://mini-job-tracker-blue.vercel.app/einstellungen");
    expect(result.error).toBeNull();
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://mini-job-tracker-blue.vercel.app/einstellungen",
        skipBrowserRedirect: false,
      },
    });
  });

  it("defaults redirectTo to the allowed /einstellungen on the current origin (landing is client-side)", async () => {
    vi.stubGlobal("window", { location: { origin: "https://app.example" } });
    vi.resetModules();
    const { signInWithOAuthProvider } = await import("./oauth-sign-in");
    await signInWithOAuthProvider("google");
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://app.example/einstellungen",
        skipBrowserRedirect: false,
      },
    });
    vi.unstubAllGlobals();
  });

  it("propagates supabase errors", async () => {
    signInWithOAuth.mockResolvedValue({ data: { url: null, provider: "google" }, error: new Error("provider disabled") });
    const { signInWithOAuthProvider } = await import("./oauth-sign-in");
    const result = await signInWithOAuthProvider("google", "https://example.com/einstellungen");
    expect(result.error?.message).toBe("provider disabled");
  });

  it("sets the landing marker BEFORE the browser leaves for Google", async () => {
    let markerAtCall: boolean | null = null;
    signInWithOAuth.mockImplementation(async () => {
      markerAtCall = isOAuthLandingPending();
      return { data: { url: "https://example", provider: "google" }, error: null };
    });
    const { signInWithOAuthProvider } = await import("./oauth-sign-in");
    await signInWithOAuthProvider("google", "https://example.com/einstellungen");
    expect(markerAtCall).toBe(true);
    expect(isOAuthLandingPending()).toBe(true);
  });

  it("removes the marker when the sign-in cannot start (error result or throw)", async () => {
    const { signInWithOAuthProvider } = await import("./oauth-sign-in");
    signInWithOAuth.mockResolvedValueOnce({
      data: { url: null, provider: "google" },
      error: new Error("x"),
    });
    await signInWithOAuthProvider("google", "https://example.com/einstellungen");
    expect(isOAuthLandingPending()).toBe(false);

    signInWithOAuth.mockRejectedValueOnce(new Error("network"));
    await expect(
      signInWithOAuthProvider("google", "https://example.com/einstellungen"),
    ).rejects.toThrow("network");
    expect(isOAuthLandingPending()).toBe(false);
  });

  it("exports only google as OAuthProvider (Apple absent from public API)", async () => {
    const mod = await import("./oauth-sign-in");
    // Type-level: OAuthProvider is "google". Runtime sanity: no apple helper.
    expect(typeof mod.signInWithOAuthProvider).toBe("function");
    expect(Object.keys(mod)).not.toContain("signInWithApple");
  });
});
