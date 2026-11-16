/**
 * Money comparisons for the Minijob limits. Leaf module (no imports) so every
 * limit surface can share one definition of "exceeds".
 *
 * The statutory limits are upper bounds ("bis 603 EUR"): an amount EQUAL to the
 * limit is within it, only a larger amount exceeds it. Amounts are compared in
 * whole cents so that floating-point noise in a sum (e.g. 603.0000000000001)
 * never turns "exactly the limit" into an exceedance.
 */
export function exceedsAmount(amount: number, limit: number): boolean {
  return Math.round(amount * 100) > Math.round(limit * 100);
}

/**
 * Same question for a usage share in percent (amount / limit × 100). A share is
 * past the limit only when it is strictly above 100 %; the tolerance covers the
 * rounding error of the division, and is far below the effect of one cent
 * (0.00001 % of 7,236 EUR is 0.0007 EUR; one cent is 0.000138 %).
 */
export const OVER_SHARE_EPSILON_PERCENT = 1e-5;

export function sharePastLimit(sharePercent: number): boolean {
  return sharePercent > 100 + OVER_SHARE_EPSILON_PERCENT;
}
