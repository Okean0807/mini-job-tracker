import type { Job, Shift } from "./types";

/**
 * Presentation grouping only: Shifts that belong to one calendar date.
 * Does not merge or rewrite Shift records.
 */
export function shiftsOnDate(shifts: readonly Shift[], date: string): Shift[] {
  return [...shifts]
    .filter((s) => s.date === date)
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

/** Job name for the day heading when every block shares one job. */
export function dayHeadingJobName(
  shifts: readonly Shift[],
  jobs: readonly Job[],
): string | undefined {
  const names = new Set<string>();
  for (const s of shifts) {
    const name = jobs.find((j) => j.id === s.jobId)?.name?.trim();
    if (name) names.add(name);
  }
  return names.size === 1 ? [...names][0] : undefined;
}

/** Compact address for a work block: street+house, otherwise workplace. */
export function dayBlockAddress(
  shift: Pick<Shift, "street" | "houseNo" | "workplace">,
): string {
  const street = [shift.street, shift.houseNo]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return street || (shift.workplace ?? "").trim();
}

/** Shift-owned Leistungsart snapshot — never catalog-only. */
export function dayBlockLeistungsart(
  shift: Pick<Shift, "workCode" | "workCodeLabel">,
): string {
  const code = (shift.workCode ?? "").trim();
  const label = (shift.workCodeLabel ?? "").trim();
  if (code && label) return `${code} · ${label}`;
  return code || label;
}
