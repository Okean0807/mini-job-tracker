import { Briefcase, ChevronLeft, ChevronRight, Palmtree, PartyPopper, Thermometer } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { isoDate, monthNames, weekdayNames } from "@/lib/minijob/calc";
import { holidayName } from "@/lib/minijob/holidays";
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

const KIND_STYLE: Record<
  ShiftKind,
  { cell: string; icon: LucideIcon; legend: string; labelKey: string }
> = {
  arbeit: {
    cell: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border-emerald-500/30",
    icon: Briefcase,
    legend: "bg-emerald-500",
    labelKey: "kind.arbeit",
  },
  krank: {
    cell: "bg-amber-500/15 text-amber-900 dark:text-amber-100 border-amber-500/30",
    icon: Thermometer,
    legend: "bg-amber-500",
    labelKey: "kind.krank",
  },
  urlaub: {
    cell: "bg-sky-500/15 text-sky-900 dark:text-sky-100 border-sky-500/30",
    icon: Palmtree,
    legend: "bg-sky-500",
    labelKey: "kind.urlaub",
  },
  feiertag: {
    cell: "bg-violet-500/15 text-violet-900 dark:text-violet-100 border-violet-500/30",
    icon: PartyPopper,
    legend: "bg-violet-500",
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

/** Hours shown for a day: worked or paid-absence hours (matches ShiftList), never raw clock duration for unpaid absences. */
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
          const feiertag = holidayName(iso, bundesland);
          const kind = primaryDayKind(dayShifts);
          const kindMeta = kind ? KIND_STYLE[kind] : null;
          const KindIcon = kindMeta?.icon;
          const colors = dayShifts
            .map((s) => jobs.find((j) => j.id === s.jobId)?.color)
            .filter((c): c is string => Boolean(c));
          // Job color only for pure Arbeit days without mixed absence kinds
          const useJobColor = kind === "arbeit" && colors[0] && dayShifts.every((s) => s.kind === "arbeit");
          const firstColor = useJobColor ? colors[0] : undefined;

          return (
            <button
              key={iso}
              type="button"
              title={feiertag ?? (kind ? t(KIND_STYLE[kind].labelKey) : undefined)}
              data-kind={kind ?? (feiertag ? "feiertag-cal" : undefined)}
              onClick={() => onSelectDay(iso)}
              style={firstColor ? { backgroundColor: firstColor, color: "#fff" } : undefined}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center rounded-xl border text-sm transition-colors",
                !firstColor && kindMeta && kindMeta.cell,
                dayShifts.length && !firstColor && !kindMeta && "bg-gradient-primary font-semibold text-primary-foreground",
                dayShifts.length && "font-semibold",
                !dayShifts.length && "border-transparent hover:bg-muted",
                !dayShifts.length && feiertag && "border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-200",
                iso === today && !dayShifts.length && "border-primary text-primary",
              )}
            >
              <span className="flex items-center gap-0.5">
                {KindIcon ? <KindIcon className="size-2.5 opacity-90" aria-hidden /> : null}
                <span>{day}</span>
              </span>
              {hours > 0 ? (
                <span className="text-[10px] opacity-90 tabular-nums">
                  {hours.toFixed(1).replace(".", ",")} h
                </span>
              ) : null}
              {colors.length > 1 && kind === "arbeit" ? (
                <span className="absolute bottom-1 flex gap-0.5">
                  {colors.slice(1, 4).map((c, i) => (
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
