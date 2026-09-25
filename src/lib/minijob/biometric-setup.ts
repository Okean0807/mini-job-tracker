import { registerBiometricCredentialId, type BiometricRegisterOutcome } from "./biometric";
import { disableBiometric, getScopeGeneration, isScopeCurrent, updateSettings } from "./store";

/**
 * Biometrie einrichten (Einstellungen → Sicherheit). Der WebAuthn-Dialog kann
 * dauern: wechselt währenddessen Konto oder Namensraum, wird nichts in den
 * neuen Namensraum geschrieben ("stale"). Sonst wie bisher: Erfolg speichert
 * die Credential-Id, Fehlschlag schaltet Biometrie ab.
 */
export async function setupBiometricInScope(
  userHandle: string,
  register: (
    userHandle: string,
  ) => Promise<BiometricRegisterOutcome> = registerBiometricCredentialId,
): Promise<BiometricRegisterOutcome | "stale"> {
  const generation = getScopeGeneration();
  const outcome = await register(userHandle);
  if (!isScopeCurrent(generation)) return "stale";
  if (!outcome.ok) {
    disableBiometric();
    return outcome;
  }
  updateSettings({ biometric: true, biometricCredentialId: outcome.credentialId });
  return outcome;
}
