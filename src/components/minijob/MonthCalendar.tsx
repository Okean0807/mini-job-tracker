import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { isoDate, monthNames, shiftHours, weekdayNames } from "@/lib/minijob/calc";
import { holidayName } from "@/lib/minijob/holidays";
import type { Job, Shift } from "@/lib/minijob/types";
import { cn } from "@/lib/utils";

interface MonthCalendarProps {
  year: number;
  month: number;
  shifts: Shift[];
  jobs: Job[];
  bundesland: string;
  onChangeMonth: (year: number, month: number) => void;
  onSelectDay: (date: string) => void;
}

export function MonthCalendar({
  year,
  month,
  shifts,
  jobs,
  bundesland,
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
          const hours = dayShifts.reduce((acc, s) => acc + shiftHours(s), 0);
          const feiertag = holidayName(iso, bundesland);
          const colors = dayShifts
            .map((s) => jobs.find((j) => j.id === s.jobId)?.color)
            .filter((c): c is string => Boolean(c));
          const first = colors[0];

          return (
            <button
              key={iso}
              type="button"
              title={feiertag}
              onClick={() => onSelectDay(iso)}
              style={first ? { backgroundColor: first, color: "#fff" } : undefined}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center rounded-xl border border-transparent text-sm transition-colors",
                dayShifts.length && !first && "bg-gradient-primary font-semibold text-primary-foreground",
                dayShifts.length && "font-semibold",
                !dayShifts.length && "hover:bg-muted",
                !dayShifts.length && feiertag && "bg-destructive/10 text-destructive",
                iso === today && !dayShifts.length && "border-primary text-primary",
              )}
            >
              <span>{day}</span>
              {hours > 0 ? (
                <span className="text-[10px] opacity-90 tabular-nums">
                  {hours.toFixed(1).replace(".", ",")} h
                </span>
              ) : null}
              {colors.length > 1 ? (
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
    </div>
  );
}
