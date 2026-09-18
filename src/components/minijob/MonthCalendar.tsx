import { Briefcase, ChevronLeft, ChevronRight, Palmtree, PartyPopper, Thermometer } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { formatEuro, isoDate, monthNames, weekdayNames } from "@/lib/minijob/calc";
import { holidayName } from "@/lib/minijob/holidays";
import { generateFixedMonth } from "@/lib/minijob/schedule";
import { shiftPayroll } from "@/lib/minijob/payroll";
import type { ResolveOptions } from "@/lib/minijob/resolve";
import type { Job, Shift, ShiftKind } from "@/lib/minijob/types";
import { cn } from "@/lib/utils";

interface MonthCalendarProps {
  year: number;
  month: number;
  shifts: Shift[];
  jobs: Job[];
  bundesland: string;
  /** Same resolver as ShiftList / dashboard – needed for payroll-aligned day hours. */
  resolve: (shift: Shift) => ResolveOptions;
  onChangeMonth: (year: number, month: number) => void;
  onSelectDay: (date: string) => void;
}

const KIND_ORDER: ShiftKind[] = ["arbeit", "krank", "urlaub", "feiertag"];

/** Exported for contrast/snapshot tests — meanings unchanged, dark fills brighter. */
export const KIND_STYLE: Record<
  ShiftKind,
  { cell: string; icon: LucideIcon; legend: string; labelKey: string }
> = {
  // Arbeit green · Krank orange · Urlaub blue · Feiertag violet — saturated for black bg
  arbeit: {
    cell: "bg-emerald-500/25 text-emerald-900 border-emerald-600/60 dark:bg-emerald-400/35 dark:text-emerald-200 dark:border-emerald-300",
    icon: Briefcase,
    legend: "bg-emerald-600 dark:bg-emerald-400",
    labelKey: "kind.arbeit",
  },
  krank: {
    cell: "bg-orange-500/25 text-orange-950 border-orange-600/60 dark:bg-orange-400/35 dark:text-orange-200 dark:border-orange-300",
    icon: Thermometer,
    legend: "bg-orange-600 dark:bg-orange-400",
    labelKey: "kind.krank",
  },
  urlaub: {
    cell: "bg-sky-500/25 text-sky-950 border-sky-600/60 dark:bg-sky-400/35 dark:text-sky-200 dark:border-sky-300",
    icon: Palmtree,
    legend: "bg-sky-600 dark:bg-sky-400",
    labelKey: "kind.urlaub",
  },
  feiertag: {
    cell: "bg-violet-500/25 text-violet-950 border-violet-600/60 dark:bg-violet-400/35 dark:text-violet-200 dark:border-violet-300",
    icon: PartyPopper,
    legend: "bg-violet-600 dark:bg-violet-400",
    labelKey: "kind.feiertag",
  },
};

/** Primary kind for day cell styling — first in KIND_ORDER that appears. */
export function primaryDayKind(dayShifts: Shift[]): ShiftKind | null {
  for (const kind of KIND_ORDER) {
    if (dayShifts.some((s) => s.kind === kind)) return kind;
  }
  return null;
}

/** Dual status: public holiday + recorded work on the same day. */
export function isHolidayWorkDay(dayShifts: Shift[], holiday: string | undefined): boolean {
  return Boolean(holiday) && dayShifts.some((s) => s.kind === "arbeit");
}

/** Hours shown for a day: worked or paid-absence hours (matches ShiftList). */
function dayDisplayHours(
  dayShifts: Shift[],
  allShifts: Shift[],
  resolve: (shift: Shift) => ResolveOptions,
): number {
  return dayShifts.reduce((acc, s) => {
    const pay = shiftPayroll(s, { ...resolve(s), history: allShifts });
    return acc + (s.kind === "arbeit" ? pay.workedHours : pay.paidAbsenceHours);
  }, 0);
}

function dayEarningsTotal(
  dayShifts: Shift[],
  allShifts: Shift[],
  resolve: (shift: Shift) => ResolveOptions,
): number {
  return dayShifts.reduce((acc, s) => {
    const pay = shiftPayroll(s, { ...resolve(s), history: allShifts });
    return acc + pay.earnings;
  }, 0);
}

export function buildDayTitle(options: {
  holiday?: string | undefined;
  kind: ShiftKind | null;
  hours: number;
  earnings: number;
  kindLabel: (kind: ShiftKind) => string;
}): string {
  const parts: string[] = [];
  if (options.holiday) parts.push(options.holiday);
  if (options.kind) parts.push(options.kindLabel(options.kind));
  if (options.hours > 0) parts.push(`${options.hours.toFixed(1).replace(".", ",")} h`);
  if (options.earnings > 0) parts.push(formatEuro(options.earnings));
  return parts.join(" · ");
}

export function CalendarKindLegend() {
  const { t } = useT();
  return (
    <ul
      className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground"
      aria-label={t("cal.legend")}
      data-testid="calendar-kind-legend"
    >
      {KIND_ORDER.map((kind) => {
        const meta = KIND_STYLE[kind];
        const Icon = meta.icon;
        return (
          <li key={kind} className="inline-flex items-center gap-1" data-kind={kind}>
            <span className={cn("size-2 rounded-full", meta.legend)} aria-hidden />
            <Icon className="size-3" aria-hidden />
            <span>{t(meta.labelKey)}</span>
          </li>
        );
      })}
      <li className="inline-flex items-center gap-1" data-kind="planned">
        <span className="size-2 rounded-full border border-dashed border-muted-foreground" aria-hidden />
        <span>{t("cal.planned")}</span>
      </li>
    </ul>
  );
}

export function MonthCalendar({
  year,
  month,
  shifts,
  jobs,
  bundesland,
  resolve,
  onChangeMonth,
  onSelectDay,
}: MonthCalendarProps) {
  const { t } = useT();
  const weekdays = weekdayNames(undefined, "short");
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = isoDate(new Date());

  const byDate = new Map<string, Shift[]>();
  for (const s of shifts) {
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }

  // PLAN vs ACTUAL: fest week days without a recorded shift (advisory only — not payroll).
  const plannedDates = new Set<string>();
  for (const job of jobs) {
    if (job.archived || job.mode !== "fest" || !job.week) continue;
    for (const s of generateFixedMonth(job, year, month, shifts, bundesland)) {
      plannedDates.add(s.date);
    }
  }

  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function move(delta: number) {
    const d = new Date(year, month + delta, 1);
    onChangeMonth(d.getFullYear(), d.getMonth());
  }

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <Button variant="ghost" size="icon" aria-label={t("cal.prevMonth")} onClick={() => move(-1)}>
          <ChevronLeft className="size-5" />
        </Button>
        <h2 className="text-base font-semibold">
          {monthNames()[month]} {year}
        </h2>
        <Button variant="ghost" size="icon" aria-label={t("cal.nextMonth")} onClick={() => move(1)}>
          <ChevronRight className="size-5" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {weekdays.map((d, i) => (
          <div key={`${d}-${i}`} className="py-1 font-medium">
            {d}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, idx) => {
          if (day === null) return <div key={`e-${idx}`} />;
          const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayShifts = byDate.get(iso) ?? [];
          const hours = dayDisplayHours(dayShifts, shifts, resolve);
          const earnings = dayEarningsTotal(dayShifts, shifts, resolve);
          const feiertag = holidayName(iso, bundesland);
          const kind = primaryDayKind(dayShifts);
          const kindMeta = kind ? KIND_STYLE[kind] : null;
          const KindIcon = kindMeta?.icon;
          const holidayAndWork = isHolidayWorkDay(dayShifts, feiertag);
          const colors = dayShifts
            .map((s) => jobs.find((j) => j.id === s.jobId)?.color)
            .filter((c): c is string => Boolean(c));
          // Job color as left border + dot — never full cell fill (dark-mode readability).
          const jobAccent =
            kind === "arbeit" && colors[0] && dayShifts.every((s) => s.kind === "arbeit")
              ? colors[0]
              : undefined;

          const title = buildDayTitle({
            holiday: feiertag,
            kind,
            hours,
            earnings,
            kindLabel: (k) => t(KIND_STYLE[k].labelKey),
          });

          return (
            <button
              key={iso}
              type="button"
              title={title || undefined}
              data-kind={kind ?? (feiertag ? "feiertag-cal" : undefined)}
              data-holiday={feiertag ? "1" : undefined}
              data-holiday-work={holidayAndWork ? "1" : undefined}
              onClick={() => onSelectDay(iso)}
              style={
                jobAccent
                  ? { borderLeftWidth: 3, borderLeftColor: jobAccent }
                  : undefined
              }
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center rounded-xl border text-sm transition-colors",
                kindMeta && kindMeta.cell,
                dayShifts.length && "font-semibold",
                !dayShifts.length && !plannedDates.has(iso) && !feiertag && "border-transparent hover:bg-muted",
                !dayShifts.length &&
                  plannedDates.has(iso) &&
                  "border-dashed border-muted-foreground/40 bg-muted/40 text-muted-foreground",
                !dayShifts.length &&
                  feiertag &&
                  "border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-200",
                holidayAndWork && "border-violet-500/50 ring-1 ring-violet-500/30",
                iso === today && !dayShifts.length && "border-primary text-primary",
              )}
            >
              <span className="flex items-center gap-0.5">
                {feiertag ? (
                  <PartyPopper
                    className="size-2.5 text-violet-600 opacity-90 dark:text-violet-300"
                    aria-hidden
                  />
                ) : null}
                {KindIcon && kind === "arbeit" ? (
                  <KindIcon className="size-2.5 opacity-90" aria-hidden />
                ) : KindIcon && !feiertag ? (
                  <KindIcon className="size-2.5 opacity-90" aria-hidden />
                ) : null}
                <span>{day}</span>
              </span>
              {hours > 0 ? (
                <span className="text-[10px] opacity-90 tabular-nums">
                  {hours.toFixed(1).replace(".", ",")} h
                </span>
              ) : plannedDates.has(iso) ? (
                <span
                  className="text-[9px] font-medium text-muted-foreground"
                  title={t("cal.plannedHint")}
                >
                  {t("cal.planned")}
                </span>
              ) : feiertag && !dayShifts.length ? (
                <span className="max-w-full truncate px-0.5 text-[8px] font-medium text-violet-700 dark:text-violet-300">
                  {feiertag}
                </span>
              ) : null}
              {earnings > 0 && hours > 0 ? (
                <span className="text-[8px] tabular-nums opacity-80">{formatEuro(earnings)}</span>
              ) : null}
              {jobAccent ? (
                <span
                  className="absolute bottom-1 size-1.5 rounded-full ring-1 ring-background"
                  aria-hidden
                />
              ) : colors.length > 1 && kind === "arbeit" ? (
                <span className="absolute bottom-1 flex gap-0.5">
                  {colors.slice(0, 3).map((c, i) => (
                    <span
                      key={`${c}-${i}`}
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <CalendarKindLegend />
    </div>
  );
}
