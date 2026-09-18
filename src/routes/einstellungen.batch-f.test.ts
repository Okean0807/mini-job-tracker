import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));
const settingsSrc = readFileSync(join(root, "einstellungen.tsx"), "utf8");
const pinLockSrc = readFileSync(join(root, "../components/minijob/PinLock.tsx"), "utf8");
const shiftSrc = readFileSync(join(root, "../components/minijob/ShiftDialog.tsx"), "utf8");
const settingsDict = readFileSync(join(root, "../lib/i18n/dict/settings.ts"), "utf8");

describe("PIN confirm UX (Batch F #19)", () => {
  it("uses Speichern/Cancel + validatePinConfirm, not blur-only save", () => {
    expect(settingsSrc).toMatch(/validatePinConfirm/);
    expect(settingsSrc).toMatch(/data-testid="pin-setup-save"/);
    expect(settingsSrc).toMatch(/data-testid="pin-setup-cancel"/);
    expect(settingsSrc).toMatch(/set\.security\.pinErrorShort/);
    expect(settingsSrc).toMatch(/set\.security\.pinErrorMismatch/);
    expect(settingsSrc).toMatch(/safe-area-inset-bottom/);
    expect(settingsSrc).not.toMatch(/onBlur=\{\(e\) => \{\s*const pin = e\.target\.value/);
  });
});

describe("Surface mode preview ≠ apply (Batch F #17/#18)", () => {
  it("selects previewMode without immediate updateSettings uiMode", () => {
    expect(settingsSrc).toMatch(/setPreviewMode\(mode\)/);
    expect(settingsSrc).toMatch(/data-testid="ui-mode-preview"/);
    expect(settingsSrc).toMatch(/data-testid="ui-mode-apply"/);
    expect(settingsSrc).toMatch(/data-testid="ui-mode-preview-overlay"/);
    expect(settingsSrc).toMatch(/ui\.previewHint/);
    // Clicking a mode card must not call updateSettings({ uiMode: mode }) directly
    expect(settingsSrc).not.toMatch(/onClick=\{\(\) => updateSettings\(\{ uiMode: mode \}\)/);
  });
});

describe("Biometrics honesty (Batch F #20)", () => {
  it("gates toggle on capability and avoids fingerprint-only claims in DE copy", () => {
    expect(settingsSrc).toMatch(/canOfferBiometricToggle/);
    expect(settingsSrc).toMatch(/detectBiometricCapability/);
    expect(settingsSrc).toMatch(/biometricUnsupported|biometricUnavailable/);
    expect(settingsDict).toMatch(/Passkey \(WebAuthn\)/);
    expect(settingsDict).not.toMatch(/Fingerabdruck oder Gesichtserkennung nutzen/);
    expect(pinLockSrc).toMatch(/KeyRound/);
    expect(pinLockSrc).not.toMatch(/Fingerprint/);
    expect(pinLockSrc).toMatch(/safe-area-inset-bottom/);
  });
});

describe("Geolocation address (Batch F #8)", () => {
  it("reverse-geocodes into zip/city and never saves coords as street on fail", () => {
    expect(shiftSrc).toMatch(/reverseGeocodeGerman/);
    expect(shiftSrc).toMatch(/applyReverseOrKeep/);
    expect(shiftSrc).toMatch(/setZip/);
    expect(shiftSrc).toMatch(/setCity/);
    expect(shiftSrc).toMatch(/worklog\.gpsAddressFail/);
    expect(shiftSrc).toMatch(/safe-area-inset-bottom/);
    expect(shiftSrc).toMatch(/data-testid="worklog-geo-controls"/);
  });
});
