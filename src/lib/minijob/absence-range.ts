/** Pure helpers for vacation/sick date ranges (Batch B). */

import type { Shift, ShiftKind } from "./types";

const ABSENCE_KINDS: ShiftKind[] = ["urlaub", "krank"];

export function isAbsenceKind(kind: ShiftKind): kind is "urlaub" | "krank" {
  return ABSENCE_KINDS.includes(kind);
}

/** Inclusive ISO date list from..to (local calendar, no UTC shift). */
export function eachIsoDateInclusive(from: string, to: string): string[] {
  const a = from.slice(0, 10);
  const b = to.slice(0, 10);
  const [start, end] = a <= b ? [a, b] : [b, a];
  const out: string[] = [];
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const cur = new Date(ys!, (ms ?? 1) - 1, ds ?? 1);
  const last = new Date(ye!, (me ?? 1) - 1, de ?? 1);
  while (cur <= last) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function shiftDay(iso: string, delta: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Expand a seed absence shift to the contiguous same-job/same-kind block.
 * Used for range edit/delete in the UI.
 */
export function contiguousAbsenceRange(
  seed: Shift,
  all: Shift[],
): { from: string; to: string; ids: string[] } {
  if (!isAbsenceKind(seed.kind)) {
    return { from: seed.date, to: seed.date, ids: [seed.id] };
  }
  const jobId = seed.jobId;
  const kind = seed.kind;
  const byDate = new Map<string, Shift[]>();
  for (const s of all) {
    if (s.kind !== kind) continue;
    if ((s.jobId ?? "") !== (jobId ?? "")) continue;
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }
  let from = seed.date;
  let to = seed.date;
  while (byDate.has(shiftDay(from, -1))) from = shiftDay(from, -1);
  while (byDate.has(shiftDay(to, 1))) to = shiftDay(to, 1);
  const ids: string[] = [];
  for (const date of eachIsoDateInclusive(from, to)) {
    for (const s of byDate.get(date) ?? []) ids.push(s.id);
  }
  return { from, to, ids };
}

/** Absence shifts of job+kind inside [from, to] (inclusive). Never returns arbeit/feiertag. */
export function absenceShiftsInRange(
  all: Shift[],
  jobId: string | undefined,
  kind: ShiftKind,
  from: string,
  to: string,
): Shift[] {
  if (!isAbsenceKind(kind)) return [];
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  return all.filter(
    (s) =>
      s.kind === kind &&
      (s.jobId ?? "") === (jobId ?? "") &&
      s.date >= lo &&
      s.date <= hi,
  );
}
