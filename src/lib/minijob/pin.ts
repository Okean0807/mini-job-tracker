/** PIN UX: label says 4–8 digits; input maxLength is 8. */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

const PIN_PATTERN = new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`);

/** True only for a digit PIN of the expected length (4–8). */
export function isValidPin(pin: string | undefined | null): boolean {
  return typeof pin === "string" && PIN_PATTERN.test(pin);
}

/**
 * Never leave pinEnabled true without a valid PIN — otherwise the UI shows
 * protection as on while Root's lock gate (`pinEnabled && pin`) never engages.
 */
export function withConsistentPinSettings<T extends { pinEnabled: boolean; pin?: string }>(
  settings: T,
): T {
  if (settings.pinEnabled && !isValidPin(settings.pin)) {
    return { ...settings, pinEnabled: false };
  }
  return settings;
}
