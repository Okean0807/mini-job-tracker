import { CalendarDays } from "lucide-react";

import { formatDateDE, formatEuro, formatHours, shiftEarnings, shiftHours } from "@/lib/minijob/calc";
import type { Shift } from "@/lib/minijob/types";

interface ShiftListProps {
  shifts: Shift[];
  onSelect: (shift: Shift) => void;
}

export function ShiftList({ shifts, onSelect }: ShiftListProps) {
  if (shifts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center">
        <CalendarDays className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          Noch keine Schichten in diesem Monat. Tippe auf einen Tag im Kalender.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {shifts.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onSelect(s)}
            className="flex w-full items-center justify-between rounded-2xl border bg-card p-4 text-left shadow-card transition-colors hover:bg-muted/60"
          >
            <div>
              <p className="font-semibold">{formatDateDE(s.date)}</p>
              <p className="text-xs text-muted-foreground">
                {s.start}–{s.end}
                {s.breakMinutes ? ` · ${s.breakMinutes} Min. Pause` : ""} · {formatEuro(s.rate)}/Std.
              </p>
              {s.note ? <p className="mt-1 text-xs text-muted-foreground">{s.note}</p> : null}
            </div>
            <div className="text-right">
              <p className="font-semibold tabular-nums">{formatEuro(shiftEarnings(s))}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatHours(shiftHours(s))}
              </p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
