import type { ShiftKind } from "@/lib/minijob/types";

/** Legend / primary-day priority (first match wins). */
export const KIND_ORDER: ShiftKind[] = [
  "arbeit",
  "krank",
  "urlaub",
  "feiertag",
  "frei",
  "sonstige",
];

export type ShiftKindStyle = {
  labelKey: string;
  /** Full calendar day-cell classes (light + dark). */
  cell: string;
  /** Legend swatch classes. */
  legend: string;
  /** ShiftList left-bar `bg-*` classes. */
  indicatorClass: string;
};

/**
 * Single source of truth for ShiftKind colors (calendar + list indicator).
 * Semantics: arbeit emerald · urlaub amber · krank red · frei sky · sonstige violet · feiertag zinc.
 */
export const KIND_STYLE: Record<ShiftKind, ShiftKindStyle> = {
  arbeit: {
    cell: "bg-emerald-500/25 text-emerald-900 border-emerald-600/60 dark:bg-emerald-400/35 dark:text-emerald-200 dark:border-emerald-300",
    legend: "bg-emerald-600 dark:bg-emerald-400",
    indicatorClass: "bg-emerald-500 dark:bg-emerald-400",
    labelKey: "kind.arbeit",
  },
  urlaub: {
    cell: "bg-amber-500/25 text-amber-950 border-amber-600/60 dark:bg-amber-400/35 dark:text-amber-200 dark:border-amber-300",
    legend: "bg-amber-600 dark:bg-amber-400",
    indicatorClass: "bg-amber-500 dark:bg-amber-400",
    labelKey: "kind.urlaub",
  },
  krank: {
    cell: "bg-red-500/25 text-red-950 border-red-600/60 dark:bg-red-400/35 dark:text-red-200 dark:border-red-300",
    legend: "bg-red-600 dark:bg-red-400",
    indicatorClass: "bg-red-500 dark:bg-red-400",
    labelKey: "kind.krank",
  },
  frei: {
    cell: "bg-sky-500/25 text-sky-950 border-sky-600/60 dark:bg-sky-400/35 dark:text-sky-200 dark:border-sky-300",
    legend: "bg-sky-600 dark:bg-sky-400",
    indicatorClass: "bg-sky-500 dark:bg-sky-400",
    labelKey: "kind.frei",
  },
  sonstige: {
    cell: "bg-violet-500/25 text-violet-950 border-violet-600/60 dark:bg-violet-400/35 dark:text-violet-200 dark:border-violet-300",
    legend: "bg-violet-600 dark:bg-violet-400",
    indicatorClass: "bg-violet-500 dark:bg-violet-400",
    labelKey: "kind.sonstige",
  },
  feiertag: {
    cell: "bg-zinc-500/20 text-zinc-900 border-zinc-500/50 dark:bg-zinc-400/25 dark:text-zinc-200 dark:border-zinc-400",
    legend: "bg-zinc-500 dark:bg-zinc-400",
    indicatorClass: "bg-zinc-500 dark:bg-zinc-400",
    labelKey: "kind.feiertag",
  },
};

/** Tailwind classes for the ShiftList left vertical indicator bar. */
export function getEntryIndicatorClass(kind: ShiftKind): string {
  return KIND_STYLE[kind].indicatorClass;
}
