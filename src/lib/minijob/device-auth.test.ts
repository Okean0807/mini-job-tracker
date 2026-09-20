import { describe, expect, it } from "vitest";

import { mergeDeviceAuthFromLocal, stripDeviceAuthForCloud } from "./device-auth";
import { DEFAULT_SETTINGS, type AppData, type Settings } from "./types";

function base(settings: Partial<Settings> = {}): AppData {
  return {
    shifts: [{ id: "s1" } as AppData["shifts"][number]],
    jobs: [],
    customers: [],
    projects: [],
    payments: [],
    goals: [],
    orders: [],
    objects: [],
    settings: { ...DEFAULT_SETTINGS, ...settings },
    timer: { startedAt: 1, breakMinutes: 0 },
  };
}

describe("stripDeviceAuthForCloud", () => {
  it("removes pin, credential id, and clears lock flags; drops timer", () => {
    const out = stripDeviceAuthForCloud(
      base({
        pinEnabled: true,
        pin: "4242",
        biometric: true,
        biometricCredentialId: "cred-abc",
        monthlyLimit: 556,
      }),
    );
    expect(out.timer).toBeNull();
    expect(out.settings.pin).toBeUndefined();
    expect(out.settings.biometricCredentialId).toBeUndefined();
    expect(out.settings.pinEnabled).toBe(false);
    expect(out.settings.biometric).toBe(false);
    expect(out.settings.monthlyLimit).toBe(556);
    expect(out.shifts).toHaveLength(1);
  });

  it("does not mutate the source object", () => {
    const src = base({ pinEnabled: true, pin: "9999" });
    stripDeviceAuthForCloud(src);
    expect(src.settings.pin).toBe("9999");
    expect(src.settings.pinEnabled).toBe(true);
    expect(src.timer).not.toBeNull();
  });
});

describe("mergeDeviceAuthFromLocal", () => {
  it("keeps local PIN over a different remote PIN", () => {
    const remote = base({ pinEnabled: true, pin: "1111", language: "en" });
    const local = base({ pinEnabled: true, pin: "4242", language: "de" });
    const out = mergeDeviceAuthFromLocal(remote, local);
    expect(out.settings.pin).toBe("4242");
    expect(out.settings.pinEnabled).toBe(true);
    expect(out.settings.language).toBe("en");
  });

  it("never adopts remote WebAuthn credential ids", () => {
    const remote = base({
      biometric: true,
      biometricCredentialId: "remote-cred",
      pinEnabled: false,
    });
    const local = base({ biometric: false });
    const out = mergeDeviceAuthFromLocal(remote, local);
    expect(out.settings.biometricCredentialId).toBeUndefined();
    expect(out.settings.biometric).toBe(false);
  });

  it("preserves local WebAuthn enrollment across restore", () => {
    const remote = base({ monthlyLimit: 520 });
    const local = base({
      biometric: true,
      biometricCredentialId: "local-cred",
      pinEnabled: true,
      pin: "5555",
    });
    const out = mergeDeviceAuthFromLocal(remote, local);
    expect(out.settings.biometricCredentialId).toBe("local-cred");
    expect(out.settings.biometric).toBe(true);
    expect(out.settings.pin).toBe("5555");
    expect(out.settings.monthlyLimit).toBe(520);
  });

  it("adopts legacy remote PIN only when local has none", () => {
    const remote = base({ pinEnabled: true, pin: "7777" });
    const local = base({ pinEnabled: false });
    const out = mergeDeviceAuthFromLocal(remote, local);
    expect(out.settings.pin).toBe("7777");
    expect(out.settings.pinEnabled).toBe(true);
  });

  it("coerces pinEnabled without valid PIN to false", () => {
    const remote = base({ pinEnabled: true });
    const local = base({ pinEnabled: false });
    const out = mergeDeviceAuthFromLocal(remote, local);
    expect(out.settings.pinEnabled).toBe(false);
    expect(out.settings.pin).toBeUndefined();
  });
});
