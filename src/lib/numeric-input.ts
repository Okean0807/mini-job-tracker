/**
 * Parsing of the text typed into a numeric field.
 *
 * Why this exists: a controlled `<input type="number" value={number}>` that stores
 * `Number(text) || 0` rewrites an emptied field to "0" and then keeps showing a
 * leading zero ("0" + "80" -> "080"), because React does not overwrite a number
 * input whose text is numerically equal to the state. Numeric fields therefore keep
 * their own text while being edited (see `NumberField`) and only hand a number to the
 * app state when the text is a valid, non-negative, finite number.
 */

/** Technical sanity bound (values above 2^53-1 are not exactly representable). */
export const MAX_NUMERIC_INPUT = Number.MAX_SAFE_INTEGER;

/**
 * Returns the number for a valid draft, `null` for anything else
 * (empty, whitespace, "-", "abc", "1e999", negative, above the sanity bound).
 * "0", "08", "080" and "12,5" are valid (-> 0, 8, 80, 12.5). Never returns -0 or NaN.
 */
export function parseNumericDraft(raw: string, min = 0): number | null {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < min || n > MAX_NUMERIC_INPUT) return null;
  return n === 0 ? 0 : n;
}

/** Canonical display text of a stored number (no leading zeros, no "-0"). */
export function formatNumericValue(value: number): string {
  return Number.isFinite(value) ? String(value === 0 ? 0 : value) : "0";
}
