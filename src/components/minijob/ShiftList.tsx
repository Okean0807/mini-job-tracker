import { CalendarDays } from "lucide-react";

import { useT } from "@/lib/i18n";
import { formatDate, formatEuro, formatHours, shiftBreakdown } from "@/lib/minijob/calc";
import { shiftPayroll } from "@/lib/minijob/payroll";
import { effectiveShiftRate } from "@/lib/minijob/rate";
import type { ResolveOptions } from "@/lib/minijob/resolve";
import { getEntryIndicatorClass } from "@/lib/minijob/shift-kind-style";
import type { Job, Shift } from "@/lib/minijob/types";
import { cn } from "@/lib/utils";

interface ShiftListProps {
  shifts: Shift[];
  jobs: Job[];
  resolve: (shift: Shift) => ResolveOptions;
  onSelect: (shift: Shift) => void;
}

export function ShiftList({ shifts, jobs, resolve, onSelect }: ShiftListProps) {
  const { t } = useT();

  if (shifts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center">
        <CalendarDays className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">{t("list.empty")}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {shifts.map((s) => {
        const options = resolve(s);
        const b = shiftBreakdown(s, options);
        const pay = shiftPayroll(s, { ...options, history: shifts });
        const job = jobs.find((j) => j.id === s.jobId);
        const rate = effectiveShiftRate(s, { job, defaultRate: options.defaultRate });
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(s)}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border bg-card p-4 text-left shadow-card transition-colors hover:bg-muted/60"
            >
              <span
                className={cn("h-10 w-1.5 shrink-0 rounded-full", getEntryIndicatorClass(s.kind))}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {formatDate(s.date)}
                  {job ? ` · ${job.name}` : ""}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {s.kind === "arbeit"
                    ? `${s.start}–${s.end}${s.breakMinutes ? ` ${t("list.breakMinutes", { minutes: s.breakMinutes })}` : ""}`
                    : t(`kind.${s.kind}`)}
                  {` ${t("list.perHour", { amount: formatEuro(rate) })}`}
                </p>
                {b.labels.length ? (
                  <p className="mt-1 text-[11px] font-medium text-primary">
                    {t("list.supplement", { labels: b.labels.join(", ") })}
                  </p>
                ) : null}
                {s.kind !== "arbeit" ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {`${pay.paid ? t("pay.absencePaid") : t("pay.absenceUnpaid")} · ${t(`pay.reason.${pay.reason}`)}`}
                    {pay.paid ? ` · ${formatHours(pay.paidAbsenceHours)} ${t("pay.absenceHours")}` : ""}
                    {pay.estimated ? ` · ${t("pay.estimate")}` : ""}
                  </p>
                ) : null}
                {s.note ? <p className="mt-1 truncate text-xs text-muted-foreground">{s.note}</p> : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold tabular-nums">{formatEuro(pay.earnings)}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatHours(s.kind === "arbeit" ? pay.workedHours : pay.paidAbsenceHours)}
                </p>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
