import { isClientCloudSyncEnabled } from "./cloud-flag-runtime";

/**
 * Phase 2 (Public Local Isolation): single source of truth for "may this build talk to the cloud?".
 *
 * The answer is the build-time flag VITE_CLOUD_SYNC_ENABLED that the Build Gate bakes from the profile
 * (public-local => false, cloud-enabled / d41-pilot => true; only the exact string "true" is ON).
 * Every code path that would create the Supabase client, listen for auth events, restore a session,
 * back up, upload, call an Edge Function or reach the AI server function asks this module first.
 */
export function isCloudMode(): boolean {
  return isClientCloudSyncEnabled();
}

/** Public Local build: no cloud, no account, no AI, no paywall - everything runs on the device. */
export function isPublicLocalBuild(): boolean {
  return !isCloudMode();
}

/**
 * Phase D1 (GPS privacy): capturing the device position and turning it into an address (reverse geocoding
 * through a third-party service) exists only in builds with the cloud flag ON. Public Local never asks the
 * browser for the position and never sends coordinates anywhere. Same single decision point as the cloud
 * itself - there is no second profile mechanism.
 */
export function isGpsCaptureAvailable(): boolean {
  return isCloudMode();
}

export class GpsCaptureUnavailableError extends Error {
  constructor(feature: string) {
    super(`gps-unavailable: ${feature} is not available in this build`);
    this.name = "GpsCaptureUnavailableError";
  }
}

export class CloudDisabledError extends Error {
  constructor(feature: string) {
    super(`cloud-disabled: ${feature} is not available in this build`);
    this.name = "CloudDisabledError";
  }
}

/** Throws (before any client is created, before any request is made) when the build has no cloud. */
export function assertCloudEnabled(feature: string): void {
  if (!isCloudMode()) throw new CloudDisabledError(feature);
}
