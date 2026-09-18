/**
 * WebAuthn helpers for PIN-lock biometric unlock.
 *
 * Security invariant: only an explicit successful credential assertion may unlock.
 * Failure, cancel, missing platform authenticator, or null credential must stay locked.
 */

export type BiometricResult = "ok" | "unavailable" | "failed";

const RP_NAME = "MiniJob Tracker";

function rpId(): string {
  if (typeof window === "undefined" || !window.location?.hostname) return "localhost";
  return window.location.hostname;
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function canUsePlatformAuthenticator(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window && !!window.PublicKeyCredential;
}

/** Pure gate used by the lock UI — never treat non-ok as unlock. */
export function shouldUnlockFromBiometric(result: BiometricResult): boolean {
  return result === "ok";
}

export type BiometricRegisterOutcome =
  | { ok: true; credentialId: string }
  | { ok: false; result: Exclude<BiometricResult, "ok"> };

/**
 * Register a platform authenticator credential for later unlock.
 * Returns the credential id (base64url) on success.
 */
export async function registerBiometricCredentialId(
  userHandle: string,
): Promise<BiometricRegisterOutcome> {
  try {
    if (!canUsePlatformAuthenticator()) return { ok: false, result: "unavailable" };
    const available =
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) return { ok: false, result: "unavailable" };

    const userId = new TextEncoder().encode(userHandle.slice(0, 64) || "minijob-user");
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: RP_NAME, id: rpId() },
        user: {
          id: userId,
          name: "minijob-local",
          displayName: "MiniJob",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 60_000,
        attestation: "none",
      },
    })) as PublicKeyCredential | null;

    if (!credential) return { ok: false, result: "failed" };
    return { ok: true, credentialId: bufferToBase64Url(credential.rawId) };
  } catch {
    return { ok: false, result: "failed" };
  }
}

/**
 * Assert an existing platform credential. Never returns "ok" without a credential.
 */
export async function attemptBiometricUnlock(credentialId?: string): Promise<BiometricResult> {
  try {
    if (!canUsePlatformAuthenticator()) return "unavailable";
    const available =
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) return "unavailable";

    // Without a stored credential id there is nothing to assert — stay locked.
    if (!credentialId) return "failed";

    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        userVerification: "required",
        timeout: 30_000,
        allowCredentials: [
          {
            type: "public-key",
            id: base64UrlToBuffer(credentialId),
            transports: ["internal"],
          },
        ],
      },
    });
    if (!credential) return "failed";
    return "ok";
  } catch {
    return "failed";
  }
}

/** Honest capability labels — never claim fingerprint when only passkey exists. */
export type BiometricCapability =
  | "unsupported"
  | "passkey"
  | "platform";

export type BiometricCopyKind = "passkey" | "unavailable";

/**
 * Classify what the UI may honestly claim.
 * - unsupported: no WebAuthn
 * - passkey: WebAuthn present but platform UV authenticator not available
 * - platform: UV platform authenticator available (may include fingerprint/face via OS)
 */
export async function detectBiometricCapability(
  checkPlatform: () => Promise<boolean> = async () => {
    if (!canUsePlatformAuthenticator()) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  },
): Promise<BiometricCapability> {
  if (!canUsePlatformAuthenticator()) return "unsupported";
  const platform = await checkPlatform();
  return platform ? "platform" : "passkey";
}

/** i18n key suffix for settings copy based on capability. */
export function biometricCopyKind(capability: BiometricCapability): BiometricCopyKind {
  return capability === "unsupported" ? "unavailable" : "passkey";
}

/** Toggle may only be offered when WebAuthn + platform UV authenticator exist. */
export function canOfferBiometricToggle(capability: BiometricCapability): boolean {
  return capability === "platform";
}
