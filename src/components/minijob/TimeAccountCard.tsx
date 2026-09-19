import { CalendarDays, Clock, Scale } from "lucide-react";

import { useT } from "@/lib/i18n";
import { formatHours } from "@/lib/minijob/calc";
import type { FestMonthAccount } from "@/lib/minijob/fest-time-account";
import { cn } from "@/lib/utils";

interface TimeAccountCardProps {
  account: FestMonthAccount;
  monthLabel: string;
  year: number;
}

export function TimeAccountCard({ account, monthLabel, year }: TimeAccountCardProps) {
  const { t } = useT();
  const saldoPositive = account.saldo >= 0;

  return (
    <section
      className="col-span-2 rounded-2xl border bg-card p-4 shadow-card"
      aria-label={t("timeAccount.title")}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("timeAccount.title")}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {monthLabel} {year}
          </p>
        </div>
        <Scale className="size-4 opacity-70" />
      </div>

      <p
        className={cn(
          "mt-3 text-3xl font-extrabold tabular-nums",
          saldoPositive ? "text-primary" : "text-destructive",
        )}
      >
        {saldoPositive ? "+" : ""}
        {formatHours(account.saldo)}
      </p>
      <p className="text-xs text-muted-foreground">{t("timeAccount.saldo")}</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Metric icon={Clock} label={t("timeAccount.soll")} value={formatHours(account.soll)} />
        <Metric icon={Clock} label={t("timeAccount.ist")} value={formatHours(account.ist)} />
        <Metric
          icon={CalendarDays}
          label={t("timeAccount.vacation")}
          value={String(account.vacationDays)}
        />
        <Metric
          icon={CalendarDays}
          label={t("timeAccount.sick")}
          value={String(account.sickDays)}
        />
      </div>
    </section>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
