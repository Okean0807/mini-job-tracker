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

  it("calls supabase.auth.signInWithOAuth with google and redirectTo (not Lovable broker)", async () => {
    const { signInWithOAuthProvider } = await import("./oauth-sign-in");
    const result = await signInWithOAuthProvider("google", "https://mini-job-tracker-blue.vercel.app/einstellungen");
    expect(result.error).toBeNull();
    expect(result.mode).toBe("redirect");
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://mini-job-tracker-blue.vercel.app/einstellungen",
        skipBrowserRedirect: false,
      },
    });
  });

  it("defaults redirectTo to the dashboard on the current origin", async () => {
    const win = { location: { origin: "https://app.example" } } as unknown as Window;
    vi.stubGlobal("window", Object.assign(win, { top: win, self: win }));
    vi.resetModules();
    const { signInWithOAuthProvider } = await import("./oauth-sign-in");
    await signInWithOAuthProvider("google");
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://app.example/",
        skipBrowserRedirect: false,
      },
    });
    vi.unstubAllGlobals();
  });

  /**
   * Google answers the authorize request with `frame-ancestors 'none'`, so a
   * redirect inside the Lovable preview iframe replaces the app with a browser
   * error page. The flow has to continue in a top-level tab instead.
   */
  it("hands off to a top-level tab when the app is embedded", async () => {
    const open = vi.fn().mockReturnValue({});
    const win = {
      location: { origin: "https://app.example" },
      open,
    } as unknown as Window;
    vi.stubGlobal("window", Object.assign(win, { top: {} as Window, self: win }));
    vi.resetModules();
    const { signInWithOAuthProvider, oauthHandoffUrl } = await import("./oauth-sign-in");
    const result = await signInWithOAuthProvider("google");
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      oauthHandoffUrl("google", "https://app.example"),
      "_blank",
      "noopener,noreferrer",
    );
    expect(result).toEqual({ error: null, mode: "new_tab" });
    vi.unstubAllGlobals();
  });

  it("reports a blocked handoff so the UI can explain it", async () => {
    const open = vi.fn().mockReturnValue(null);
    const win = { location: { origin: "https://app.example" }, open } as unknown as Window;
    vi.stubGlobal("window", Object.assign(win, { top: {} as Window, self: win }));
    vi.resetModules();
    const { signInWithOAuthProvider } = await import("./oauth-sign-in");
    expect(await signInWithOAuthProvider("google")).toEqual({ error: null, mode: "blocked" });
    vi.unstubAllGlobals();
  });

  it("recognises the handoff param only for google", async () => {
    const { readOAuthHandoff, OAUTH_HANDOFF_PARAM } = await import("./oauth-sign-in");
    expect(OAUTH_HANDOFF_PARAM).toBe("oauth");
    expect(readOAuthHandoff("?oauth=google")).toBe("google");
    expect(readOAuthHandoff("?oauth=apple")).toBeNull();
    expect(readOAuthHandoff("")).toBeNull();
  });

  it("treats a cross-origin top window as embedded", async () => {
    const win = { location: { origin: "https://app.example" } } as unknown as Window;
    Object.defineProperty(win, "top", {
      get() {
        throw new DOMException("cross-origin", "SecurityError");
      },
    });
    vi.stubGlobal("window", Object.assign(win, { self: win }));
    vi.resetModules();
    const { isEmbeddedContext } = await import("./oauth-sign-in");
    expect(isEmbeddedContext()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("propagates supabase errors", async () => {
    signInWithOAuth.mockResolvedValue({ data: { url: null, provider: "google" }, error: new Error("provider disabled") });
    const { signInWithOAuthProvider } = await import("./oauth-sign-in");
    const result = await signInWithOAuthProvider("google", "https://example.com/einstellungen");
    expect(result.error?.message).toBe("provider disabled");
  });

  it("exports only google as OAuthProvider (Apple absent from public API)", async () => {
    const mod = await import("./oauth-sign-in");
    // Type-level: OAuthProvider is "google". Runtime sanity: no apple helper.
    expect(typeof mod.signInWithOAuthProvider).toBe("function");
    expect(Object.keys(mod)).not.toContain("signInWithApple");
  });
});
