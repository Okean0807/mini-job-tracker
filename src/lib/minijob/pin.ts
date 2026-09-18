/** PIN UX: label says 4–8 digits; input maxLength is 8. */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

const PIN_PATTERN = new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`);

/** True only for a digit PIN of the expected length (4–8). */
export function isValidPin(pin: string | undefined | null): pin is string {
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

/** Setup confirm UX: short / mismatch / invalid / ok / cancel. */
export type PinConfirmError = "short" | "mismatch" | "invalid" | "cancel";

export type PinConfirmResult =
  | { ok: true; pin: string }
  | { ok: false; error: PinConfirmError };

/**
 * Validate PIN + confirmation before Speichern.
 * - short: either field shorter than min (or empty)
 * - mismatch: both non-empty but differ
 * - invalid: length ok-ish but non-digit / pattern fail
 * - cancel: explicit cancel path (caller may pass cancel=true)
 */
export function validatePinConfirm(
  pin: string,
  confirm: string,
  opts?: { cancel?: boolean },
): PinConfirmResult {
  if (opts?.cancel) return { ok: false, error: "cancel" };

  const a = pin.trim();
  const b = confirm.trim();

  if (a.length < PIN_MIN_LENGTH || b.length < PIN_MIN_LENGTH) {
    return { ok: false, error: "short" };
  }
  if (a !== b) {
    return { ok: false, error: "mismatch" };
  }
  if (!isValidPin(a)) {
    return { ok: false, error: "invalid" };
  }
  return { ok: true, pin: a };
}
