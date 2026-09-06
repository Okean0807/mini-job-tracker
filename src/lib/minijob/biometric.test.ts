import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  attemptBiometricUnlock,
  registerBiometricCredentialId,
  shouldUnlockFromBiometric,
} from "./biometric";

describe("shouldUnlockFromBiometric", () => {
  it("entsperrt nur bei ok", () => {
    expect(shouldUnlockFromBiometric("ok")).toBe(true);
    expect(shouldUnlockFromBiometric("failed")).toBe(false);
    expect(shouldUnlockFromBiometric("unavailable")).toBe(false);
  });
});

describe("attemptBiometricUnlock", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("bleibt gesperrt ohne credentialId (kein Bypass)", async () => {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
      },
    });
    const get = vi.fn();
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { get, create: vi.fn() },
    });

    await expect(attemptBiometricUnlock()).resolves.toBe("failed");
    await expect(attemptBiometricUnlock("")).resolves.toBe("failed");
    expect(get).not.toHaveBeenCalled();
  });

  it("bleibt gesperrt wenn credentials.get fehlschlägt (kein Unlock im catch)", async () => {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
      },
    });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        get: vi.fn().mockRejectedValue(new Error("NotAllowedError")),
        create: vi.fn(),
      },
    });

    await expect(attemptBiometricUnlock("abc123")).resolves.toBe("failed");
  });

  it("bleibt gesperrt bei null-Credential", async () => {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
      },
    });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        get: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    });

    await expect(attemptBiometricUnlock("abc123")).resolves.toBe("failed");
  });

  it("meldet ok nur bei erfolgreichem Credential", async () => {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
      },
    });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        get: vi.fn().mockResolvedValue({ id: "cred" }),
        create: vi.fn(),
      },
    });

    await expect(attemptBiometricUnlock("YWJj")).resolves.toBe("ok");
  });

  it("meldet unavailable ohne PublicKeyCredential", async () => {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: undefined,
    });
    await expect(attemptBiometricUnlock("abc")).resolves.toBe("unavailable");
  });
});

describe("registerBiometricCredentialId", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("meldet unavailable ohne Plattform-Authenticator", async () => {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(false),
      },
    });
    await expect(registerBiometricCredentialId("u1")).resolves.toEqual({
      ok: false,
      result: "unavailable",
    });
  });
});
