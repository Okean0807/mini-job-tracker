import { beforeEach, describe, expect, it } from "vitest";

import { OAUTH_RETURN_PATH, oauthRedirectTo } from "./auth-session";
import {
  OAUTH_LANDING_KEY,
  OAUTH_LANDING_MAX_AGE_MS,
  clearOAuthLanding,
  isOAuthLandingPending,
  markOAuthLanding,
  resolvePostAuthLanding,
} from "./post-auth-landing";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("OAuth landing marker", () => {
  it("is pending after mark and gone after clear", () => {
    expect(isOAuthLandingPending()).toBe(false);
    markOAuthLanding();
    expect(isOAuthLandingPending()).toBe(true);
    clearOAuthLanding();
    expect(isOAuthLandingPending()).toBe(false);
  });

  it("lives in sessionStorage (per tab), never in localStorage", () => {
    markOAuthLanding();
    expect(window.sessionStorage.getItem(OAUTH_LANDING_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(OAUTH_LANDING_KEY)).toBeNull();
  });

  it("ignores and removes a marker of an abandoned sign-in", () => {
    markOAuthLanding(1_000);
    expect(isOAuthLandingPending(1_000 + OAUTH_LANDING_MAX_AGE_MS - 1)).toBe(true);
    expect(isOAuthLandingPending(1_000 + OAUTH_LANDING_MAX_AGE_MS + 1)).toBe(false);
    expect(window.sessionStorage.getItem(OAUTH_LANDING_KEY)).toBeNull();
  });

  it("ignores garbage and markers from the future", () => {
    window.sessionStorage.setItem(OAUTH_LANDING_KEY, "not-a-number");
    expect(isOAuthLandingPending()).toBe(false);
    window.sessionStorage.setItem(OAUTH_LANDING_KEY, String(Date.now() + 3_600_000));
    expect(isOAuthLandingPending()).toBe(false);
  });
});

describe("resolvePostAuthLanding", () => {
  const base = { pathname: OAUTH_RETURN_PATH, restorePending: false } as const;

  it("waits while the session is unknown (no early redirect)", () => {
    expect(resolvePostAuthLanding({ ...base, authStatus: "loading" })).toBe("wait");
  });

  it("waits while the first profile restore runs", () => {
    expect(resolvePostAuthLanding({ ...base, authStatus: "signed_in", restorePending: true })).toBe(
      "wait",
    );
  });

  it("goes home once signed in on the OAuth return page", () => {
    expect(resolvePostAuthLanding({ ...base, authStatus: "signed_in" })).toBe("go-home");
  });

  it("clears (no redirect) when the sign-in did not produce a session", () => {
    expect(resolvePostAuthLanding({ ...base, authStatus: "signed_out" })).toBe("clear");
  });

  it("never redirects away from other pages (legal pages, start page, ...)", () => {
    for (const pathname of [
      "/",
      "/impressum",
      "/datenschutz",
      "/ki-hinweise",
      "/rechtliches",
      "/statistik",
    ]) {
      expect(resolvePostAuthLanding({ ...base, pathname, authStatus: "signed_in" })).toBe("clear");
    }
  });
});

describe("redirect URL stays the one known to be allowed", () => {
  it("oauthRedirectTo uses OAUTH_RETURN_PATH on the app origin", () => {
    expect(OAUTH_RETURN_PATH).toBe("/einstellungen");
    expect(oauthRedirectTo("https://app.example")).toBe(`https://app.example${OAUTH_RETURN_PATH}`);
  });
});
