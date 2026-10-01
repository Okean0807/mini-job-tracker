/** Pure calendar/time helpers used by notification scheduling. */

export function minutesOfDay(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return Math.max(0, Math.min(1439, h * 60 + m));
}

/** True when `now` is inside a duration window, including windows crossing midnight. */
export function isWithinTimeWindow(now: string, start: string, durationMinutes: number): boolean {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return false;
  const n = minutesOfDay(now);
  const s = minutesOfDay(start);
  const duration = Math.min(durationMinutes, 24 * 60);
  const distance = (n - s + 24 * 60) % (24 * 60);
  return distance < duration;
}

/** Previous calendar date in YYYY-MM-DD without subtracting 24h milliseconds. */
export function previousCalendarDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
