import { isValidPin, withConsistentPinSettings } from "./pin";
import type { AppData, Settings } from "./types";

/**
 * PIN and WebAuthn enrollment are device-local:
 * - PIN must not sit plaintext in cloud backups (Supabase `backups.payload`).
 * - `biometricCredentialId` is platform-bound; restoring it on another device
 *   shows a biometric unlock button that can never succeed.
 *
 * Local JSON backup/export intentionally keeps these fields for same-device restore.
 */

/** Deep-clone app data for cloud upload with device-local auth removed. */
export function stripDeviceAuthForCloud(data: AppData): AppData {
  const clone = JSON.parse(JSON.stringify({ ...data, timer: null })) as AppData;
  const { pin: _pin, biometricCredentialId: _cred, ...rest } = clone.settings;
  clone.settings = { ...rest, pinEnabled: false, biometric: false };
  return clone;
}

/**
 * After fetching a cloud payload, keep this device's lock secrets.
 * Legacy remotes may still contain a plaintext PIN — adopt only when this
 * device has none yet (one-time migration); never adopt remote WebAuthn ids.
 */
export function mergeDeviceAuthFromLocal(remote: AppData, local: AppData): AppData {
  const remoteSettings = remote.settings;
  const localSettings = local.settings;

  const { pin: _rPin, biometricCredentialId: _rCred, ...remoteRest } = remoteSettings;
  let settings: Settings = { ...remoteRest, pinEnabled: false, biometric: false };

  if (localSettings.biometricCredentialId) {
    settings = {
      ...settings,
      biometric: localSettings.biometric,
      biometricCredentialId: localSettings.biometricCredentialId,
    };
  }

  if (isValidPin(localSettings.pin)) {
    settings = {
      ...settings,
      pin: localSettings.pin,
      pinEnabled: localSettings.pinEnabled,
    };
  } else if (isValidPin(remoteSettings.pin)) {
    settings = {
      ...settings,
      pin: remoteSettings.pin,
      pinEnabled: remoteSettings.pinEnabled,
    };
  }

  settings = withConsistentPinSettings(settings);
  return { ...remote, settings };
}
