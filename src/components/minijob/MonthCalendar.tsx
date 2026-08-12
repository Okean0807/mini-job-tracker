import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MONTHS_DE, isoDate, shiftHours } from "@/lib/minijob/calc";
import type { Shift } from "@/lib/minijob/types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

interface MonthCalendarProps {
  year: number;
  month: number;
  shifts: Shift[];
  onChangeMonth: (year: number, month: number) => void;
  onSelectDay: (date: string) => void;
}

export function MonthCalendar({
  year,
  month,
  shifts,
  onChangeMonth,
  onSelectDay,
}: MonthCalendarProps) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = isoDate(new Date());

  const hoursByDate = new Map<string, number>();
  for (const s of shifts) {
    hoursByDate.set(s.date, (hoursByDate.get(s.date) ?? 0) + shiftHours(s));
  }

  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function shift(delta: number) {
    const d = new Date(year, month + delta, 1);
    onChangeMonth(d.getFullYear(), d.getMonth());
  }

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <Button variant="ghost" size="icon" aria-label="Vorheriger Monat" onClick={() => shift(-1)}>
          <ChevronLeft className="size-5" />
        </Button>
        <h2 className="text-base font-semibold">
          {MONTHS_DE[month]} {year}
        </h2>
        <Button variant="ghost" size="icon" aria-label="Nächster Monat" onClick={() => shift(1)}>
          <ChevronRight className="size-5" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1 font-medium">
            {d}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, idx) => {
          if (day === null) return <div key={`e-${idx}`} />;
          const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const hours = hoursByDate.get(iso);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelectDay(iso)}
              className={cn(
                "flex aspect-square flex-col items-center justify-center rounded-xl border border-transparent text-sm transition-colors",
                hours
                  ? "bg-gradient-primary font-semibold text-primary-foreground"
                  : "hover:bg-muted",
                iso === today && !hours && "border-primary text-primary",
              )}
            >
              <span>{day}</span>
              {hours ? (
                <span className="text-[10px] opacity-90 tabular-nums">
                  {hours.toFixed(1).replace(".", ",")} h
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
