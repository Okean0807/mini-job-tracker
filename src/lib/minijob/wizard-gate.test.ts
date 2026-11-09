/**
 * Root overlay decision: setup wizard vs neutral loader vs nothing.
 * Scenarios: existing account on a device without its data, new account, offline,
 * incomplete profile on the same device, guest.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, type Job } from "./types";
import {
  isFirstProfileRestorePending,
  resolveWizardOverlay,
  shouldShowOnboardingWizard,
} from "./wizard-flow";

type SyncStatus = Parameters<typeof isFirstProfileRestorePending>[0]["status"];

const JOB = { id: "j1", name: "Job", color: "#000", mode: "flex" } as Job;
const emptyProfile = { settings: { ...DEFAULT_SETTINGS, onboarded: false }, jobs: [] as Job[] };
const completeProfile = {
  settings: { ...DEFAULT_SETTINGS, onboarded: true, wizardCompletedAt: 1_700_000_000_000 },
  jobs: [JOB],
};

function overlay(
  profile: { settings: typeof DEFAULT_SETTINGS; jobs: Job[] },
  sync: {
    signedIn: boolean;
    scopeIsUser: boolean;
    lastSyncedAt: number | null;
    status: SyncStatus;
  },
) {
  return resolveWizardOverlay({
    wizardNeeded: shouldShowOnboardingWizard(profile.settings, profile.jobs),
    restorePending: isFirstProfileRestorePending(sync),
  });
}

const newDevice = { signedIn: true, scopeIsUser: true, lastSyncedAt: null };

describe("isFirstProfileRestorePending", () => {
  it.each<[SyncStatus, boolean]>([
    ["idle", true],
    ["syncing", true],
    ["synced", false],
    ["offline", false],
    ["error", false],
    ["conflict", false],
  ])("signed-in account without a completed sync, status %s → %s", (status, expected) => {
    expect(isFirstProfileRestorePending({ ...newDevice, status })).toBe(expected);
  });

  it("is false for guest / demo namespaces, signed-out users and devices that synced before", () => {
    expect(isFirstProfileRestorePending({ ...newDevice, scopeIsUser: false, status: "idle" })).toBe(
      false,
    );
    expect(isFirstProfileRestorePending({ ...newDevice, signedIn: false, status: "idle" })).toBe(
      false,
    );
    expect(isFirstProfileRestorePending({ ...newDevice, lastSyncedAt: 5, status: "syncing" })).toBe(
      false,
    );
  });
});

describe("wizard overlay across the first sign-in on a device", () => {
  it("existing user, new device: empty local profile shows the loader, not the wizard", () => {
    expect(overlay(emptyProfile, { ...newDevice, status: "idle" })).toBe("restoring");
    expect(overlay(emptyProfile, { ...newDevice, status: "syncing" })).toBe("restoring");
  });

  it("restore of a COMPLETE profile hides everything", () => {
    expect(overlay(completeProfile, { ...newDevice, status: "synced", lastSyncedAt: 10 })).toBe(
      "none",
    );
  });

  it("restore of an INCOMPLETE profile (onboarded forced false) shows the wizard", () => {
    const restoredIncomplete = { settings: { ...DEFAULT_SETTINGS, onboarded: false }, jobs: [JOB] };
    expect(overlay(restoredIncomplete, { ...newDevice, status: "synced", lastSyncedAt: 10 })).toBe(
      "wizard",
    );
  });

  it("new account without a cloud profile: wizard right after the first sync settles", () => {
    expect(overlay(emptyProfile, { ...newDevice, status: "synced", lastSyncedAt: 10 })).toBe(
      "wizard",
    );
  });

  it("offline or failed first sync does not trap the user behind the loader", () => {
    expect(overlay(emptyProfile, { ...newDevice, status: "offline" })).toBe("wizard");
    expect(overlay(emptyProfile, { ...newDevice, status: "error" })).toBe("wizard");
  });

  it("incomplete profile on a device that already synced resumes in the wizard at once", () => {
    expect(overlay(emptyProfile, { ...newDevice, lastSyncedAt: 10, status: "syncing" })).toBe(
      "wizard",
    );
  });

  it("guest / signed-out onboarding is unchanged", () => {
    expect(
      overlay(emptyProfile, {
        signedIn: false,
        scopeIsUser: false,
        lastSyncedAt: null,
        status: "idle",
      }),
    ).toBe("wizard");
  });

  it("a completed local profile never shows an overlay, whatever the sync does", () => {
    expect(overlay(completeProfile, { ...newDevice, status: "syncing" })).toBe("none");
  });
});
