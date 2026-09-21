import { CalendarDays, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { formatDate } from "@/lib/minijob/calc";
import {
  dayBlockAddress,
  dayBlockLeistungsart,
  dayHeadingJobName,
} from "@/lib/minijob/day-shifts";
import { getEntryIndicatorClass } from "@/lib/minijob/shift-kind-style";
import type { Job, Shift } from "@/lib/minijob/types";
import { cn } from "@/lib/utils";

interface ShiftListProps {
  date: string;
  /** Shifts for the selected date only (already grouped). */
  shifts: Shift[];
  jobs: Job[];
  onSelect: (shift: Shift) => void;
  onAdd: () => void;
}

export function ShiftList({ date, shifts, jobs, onSelect, onAdd }: ShiftListProps) {
  const { t } = useT();
  const headingJob = dayHeadingJobName(shifts, jobs);

  return (
    <div className="space-y-2" data-testid="day-shift-list">
      <h2 className="text-sm font-semibold text-foreground" data-testid="day-shift-heading">
        {formatDate(date)}
        {headingJob ? ` · ${headingJob}` : ""}
      </h2>

      {shifts.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/50 px-4 py-6 text-center">
          <CalendarDays className="mx-auto size-7 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">{t("list.empty")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shifts.map((s) => {
            const job = jobs.find((j) => j.id === s.jobId);
            const address = dayBlockAddress(s);
            const leistungsart = dayBlockLeistungsart(s);
            const tasks = (s.tasks ?? [])
              .map((task) => (task.startsWith("#") ? t(`task.${task.slice(1)}`) : task))
              .filter(Boolean)
              .join(", ");
            const showJob = !headingJob && Boolean(job?.name);
            const isWork = s.kind === "arbeit";
            return (
              <li key={s.id}>
                <button
                  type="button"
                  data-testid="day-shift-block"
                  data-shift-id={s.id}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelect(s);
                  }}
                  className="flex w-full gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-left shadow-card transition-colors hover:bg-muted/60"
                >
                  <span
                    className={cn(
                      "w-1 shrink-0 self-stretch rounded-full",
                      getEntryIndicatorClass(s.kind),
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-semibold tabular-nums">
                      {isWork ? `${s.start}–${s.end}` : t(`kind.${s.kind}`)}
                    </p>
                    {!isWork && s.start && s.end && s.start !== s.end ? (
                      <p className="truncate text-xs tabular-nums text-muted-foreground">
                        {s.start}–{s.end}
                      </p>
                    ) : null}
                    {showJob ? (
                      <p className="truncate text-xs text-muted-foreground">{job?.name}</p>
                    ) : null}
                    {address ? (
                      <p className="truncate text-xs text-muted-foreground">{address}</p>
                    ) : null}
                    {leistungsart ? (
                      <p className="truncate text-xs font-medium">{leistungsart}</p>
                    ) : null}
                    {tasks ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {t("list.taskLine", { tasks })}
                      </p>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        data-testid="add-day-entry"
        className="h-11 w-full"
        onClick={onAdd}
      >
        <Plus className="size-4" /> {t("dash.newEntry")}
      </Button>
    </div>
  );
}
