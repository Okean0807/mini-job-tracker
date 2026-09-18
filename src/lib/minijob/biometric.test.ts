import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  attemptBiometricUnlock,
  biometricCopyKind,
  canOfferBiometricToggle,
  detectBiometricCapability,
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

describe("biometric honesty (Batch F)", () => {
  it("maps capability to copy / toggle gate without fingerprint claims", () => {
    expect(biometricCopyKind("unsupported")).toBe("unavailable");
    expect(biometricCopyKind("passkey")).toBe("passkey");
    expect(biometricCopyKind("platform")).toBe("passkey");
    expect(canOfferBiometricToggle("unsupported")).toBe(false);
    expect(canOfferBiometricToggle("passkey")).toBe(false);
    expect(canOfferBiometricToggle("platform")).toBe(true);
  });

  it("detects unsupported without PublicKeyCredential", async () => {
    const prev = window.PublicKeyCredential;
    // @ts-expect-error test cleanup
    delete window.PublicKeyCredential;
    await expect(detectBiometricCapability(async () => true)).resolves.toBe("unsupported");
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: prev,
    });
  });

  it("returns passkey when WebAuthn exists but platform UV is unavailable", async () => {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(false),
      },
    });
    await expect(detectBiometricCapability()).resolves.toBe("passkey");
  });

  it("returns platform when UV platform authenticator is available", async () => {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
      },
    });
    await expect(detectBiometricCapability()).resolves.toBe("platform");
  });
});
