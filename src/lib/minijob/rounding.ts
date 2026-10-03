/** Central numeric rounding helpers. Internal calculations keep full precision;
 * rounding is applied only at presentation/export boundaries. */
export function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function roundHours(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}
