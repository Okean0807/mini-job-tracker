import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  isFailedOAuthCallback,
  OAUTH_EXCHANGE_GRACE_MS,
  readOAuthCallback,
  stripOAuthParams,
} from "./oauth-callback";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("readOAuthCallback", () => {
  it("detects the authorization code Supabase has to exchange", () => {
    expect(readOAuthCallback("?code=abc&sb_flow_id=1")).toEqual({
      hasCode: true,
      error: null,
      description: null,
    });
  });

  it("detects provider errors", () => {
    expect(readOAuthCallback("?error=access_denied&error_description=User%20denied")).toEqual({
      hasCode: false,
      error: "access_denied",
      description: "User denied",
    });
  });

  it("stays quiet on a normal URL", () => {
    expect(readOAuthCallback("?tab=konto")).toEqual({
      hasCode: false,
      error: null,
      description: null,
    });
    expect(readOAuthCallback("")).toEqual({ hasCode: false, error: null, description: null });
  });
});

describe("stripOAuthParams", () => {
  it("removes round-trip params and keeps the rest", () => {
    expect(
      stripOAuthParams("https://app.example/einstellungen?code=abc&sb_flow_id=9&tab=konto"),
    ).toBe("/einstellungen?tab=konto");
  });

  it("leaves a clean URL untouched", () => {
    expect(stripOAuthParams("https://app.example/")).toBe("/");
    expect(stripOAuthParams("https://app.example/statistik#jahr")).toBe("/statistik#jahr");
  });
});

describe("isFailedOAuthCallback", () => {
  const withCode = readOAuthCallback("?code=abc");

  it("waits while the exchange is still running", () => {
    expect(isFailedOAuthCallback(withCode, "loading")).toBe(false);
  });

  it("reports a code that produced no session", () => {
    expect(isFailedOAuthCallback(withCode, "signed_out")).toBe(true);
  });

  it("stays silent on success", () => {
    expect(isFailedOAuthCallback(withCode, "signed_in")).toBe(false);
  });

  it("reports provider errors immediately, even without a code", () => {
    expect(isFailedOAuthCallback(readOAuthCallback("?error=access_denied"), "signed_out")).toBe(
      true,
    );
  });

  it("does nothing for ordinary navigation", () => {
    expect(isFailedOAuthCallback(readOAuthCallback(""), "signed_out")).toBe(false);
  });
});

describe("root wiring", () => {
  const src = readFileSync(join(root, "routes/__root.tsx"), "utf8");

  it("mounts the callback watcher", () => {
    expect(src).toMatch(/<AuthCallback \/>/);
    expect(src).toMatch(/isFailedOAuthCallback/);
    expect(src).toMatch(/stripOAuthParams/);
    expect(src).toMatch(/error\.oauthCallback/);
  });

  it("finishes the embed handoff by starting OAuth top-level", () => {
    expect(src).toMatch(/readOAuthHandoff/);
    expect(src).toMatch(/signInWithOAuthProvider\("google"\)/);
    expect(src).toMatch(/OAUTH_HANDOFF_PARAM/);
  });

  it("gives the exchange a grace period instead of reporting instantly", () => {
    expect(OAUTH_EXCHANGE_GRACE_MS).toBeGreaterThanOrEqual(3000);
    expect(src).toMatch(/OAUTH_EXCHANGE_GRACE_MS/);
  });
});
