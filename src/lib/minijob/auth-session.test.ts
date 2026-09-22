import { describe, expect, it, vi } from "vitest";

import {
  authSessionStatus,
  bindAuthSession,
  oauthRedirectTo,
  sessionAfterAuthEvent,
} from "./auth-session";
import type { Session } from "@supabase/supabase-js";

function fakeSession(email: string): Session {
  return {
    access_token: "a",
    refresh_token: "r",
    expires_in: 3600,
    token_type: "bearer",
    user: { id: "u1", email, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" },
  } as Session;
}

describe("sessionAfterAuthEvent", () => {
  const s = fakeSession("a@b.c");

  it("keeps session on INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED", () => {
    expect(sessionAfterAuthEvent("INITIAL_SESSION", s)).toBe(s);
    expect(sessionAfterAuthEvent("SIGNED_IN", s)).toBe(s);
    expect(sessionAfterAuthEvent("TOKEN_REFRESHED", s)).toBe(s);
  });

  it("clears session on SIGNED_OUT", () => {
    expect(sessionAfterAuthEvent("SIGNED_OUT", s)).toBeNull();
    expect(sessionAfterAuthEvent("SIGNED_OUT", null)).toBeNull();
  });
});

describe("oauthRedirectTo", () => {
  it("defaults to the dashboard so registration finishes there", () => {
    expect(oauthRedirectTo("/", "https://mini-job-tracker-blue.vercel.app")).toBe(
      "https://mini-job-tracker-blue.vercel.app/",
    );
    expect(oauthRedirectTo("/", "https://example.com/")).toBe("https://example.com/");
  });

  it("keeps an explicit target (sign-in started in Settings returns there)", () => {
    expect(oauthRedirectTo("/einstellungen", "https://example.com")).toBe(
      "https://example.com/einstellungen",
    );
    expect(oauthRedirectTo("einstellungen", "https://example.com/")).toBe(
      "https://example.com/einstellungen",
    );
  });
});

describe("bindAuthSession", () => {
  it("subscribes before getSession and forwards INITIAL_SESSION then hydrate", async () => {
    const s = fakeSession("x@y.z");
    const unsub = vi.fn();
    const getSession = vi.fn().mockResolvedValue({ data: { session: s }, error: null });
    let changeCb: (event: string, session: Session | null) => void = () => {};
    const onAuthStateChange = vi.fn((cb: typeof changeCb) => {
      changeCb = cb;
      return { data: { subscription: { unsubscribe: unsub } } };
    });
    const seen: Array<Session | null> = [];
    const stop = bindAuthSession(
      { auth: { getSession, onAuthStateChange } } as never,
      (session) => seen.push(session),
    );
    expect(onAuthStateChange).toHaveBeenCalled();
    expect(getSession).toHaveBeenCalled();
    // subscribe is registered synchronously before getSession is invoked
    const subOrder = onAuthStateChange.mock.invocationCallOrder[0];
    const getOrder = getSession.mock.invocationCallOrder[0];
    expect(subOrder).toBeDefined();
    expect(getOrder).toBeDefined();
    expect(subOrder!).toBeLessThan(getOrder!);
    changeCb("INITIAL_SESSION", null);
    changeCb("SIGNED_IN", s);
    changeCb("TOKEN_REFRESHED", s);
    changeCb("SIGNED_OUT", null);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toContain(s);
    expect(seen).toContain(null);
    stop();
    expect(unsub).toHaveBeenCalled();
  });

  it("hydrates existing session from getSession when already signed in", async () => {
    const s = fakeSession("old@user");
    const getSession = vi.fn().mockResolvedValue({ data: { session: s }, error: null });
    const onAuthStateChange = vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }));
    const seen: Array<Session | null> = [];
    bindAuthSession({ auth: { getSession, onAuthStateChange } } as never, (x) => seen.push(x));
    await vi.waitFor(() => expect(seen).toContain(s));
  });
});

describe("authSessionStatus", () => {
  it("is loading while pending regardless of session", () => {
    expect(authSessionStatus("pending", null)).toBe("loading");
    expect(authSessionStatus("pending", fakeSession("a@b.c"))).toBe("loading");
  });

  it("is signed_in / signed_out only after ready", () => {
    expect(authSessionStatus("ready", fakeSession("a@b.c"))).toBe("signed_in");
    expect(authSessionStatus("ready", null)).toBe("signed_out");
  });
});
