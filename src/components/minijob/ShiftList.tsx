import { CalendarDays } from "lucide-react";

import {
  formatDateDE,
  formatEuro,
  formatHours,
  shiftBreakdown,
} from "@/lib/minijob/calc";
import type { ResolveOptions } from "@/lib/minijob/resolve";
import { SHIFT_KIND_LABEL, type Job, type Shift } from "@/lib/minijob/types";

interface ShiftListProps {
  shifts: Shift[];
  jobs: Job[];
  resolve: (shift: Shift) => ResolveOptions;
  onSelect: (shift: Shift) => void;
}

export function ShiftList({ shifts, jobs, resolve, onSelect }: ShiftListProps) {
  if (shifts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center">
        <CalendarDays className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          Noch keine Einträge in diesem Zeitraum. Tippe auf einen Tag im Kalender.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {shifts.map((s) => {
        const b = shiftBreakdown(s, resolve(s));
        const job = jobs.find((j) => j.id === s.jobId);
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(s)}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border bg-card p-4 text-left shadow-card transition-colors hover:bg-muted/60"
            >
              <span
                className="h-10 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: job?.color ?? "var(--primary)" }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {formatDateDE(s.date)}
                  {job ? ` · ${job.name}` : ""}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {s.kind === "arbeit"
                    ? `${s.start}–${s.end}${s.breakMinutes ? ` · ${s.breakMinutes} Min. Pause` : ""}`
                    : SHIFT_KIND_LABEL[s.kind]}
                  {` · ${formatEuro(s.rate)}/Std.`}
                </p>
                {b.labels.length ? (
                  <p className="mt-1 text-[11px] font-medium text-primary">
                    Zuschlag: {b.labels.join(", ")}
                  </p>
                ) : null}
                {s.note ? <p className="mt-1 truncate text-xs text-muted-foreground">{s.note}</p> : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold tabular-nums">{formatEuro(b.total)}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{formatHours(b.hours)}</p>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
