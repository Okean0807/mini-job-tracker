import { CalendarClock, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import { formatDate, formatEuro, isoDate, monthNames } from "@/lib/minijob/calc";
import type { PayPeriod } from "@/lib/minijob/payday";
import { newId, savePayment } from "@/lib/minijob/store";
import { cn } from "@/lib/utils";

export function PaydayCard({ periods }: { periods: PayPeriod[] }) {
  const { t } = useT();
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("pay.title")}
        </span>
        <CalendarClock className="size-4 text-muted-foreground" />
      </div>
      {periods.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("pay.none")}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {periods.map((p) => (
            <PeriodRow key={`${p.job.id}-${p.year}-${p.month}`} period={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PeriodRow({ period }: { period: PayPeriod }) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    period.payment ? String(period.payment.actual) : period.expected.toFixed(2),
  );

  function save() {
    const actual = Number(value.replace(",", ".")) || 0;
    savePayment({
      id: period.payment?.id ?? newId(),
      jobId: period.job.id,
      year: period.year,
      month: period.month,
      actual,
      paidOn: period.payment?.paidOn ?? isoDate(new Date()),
    });
    setEditing(false);
    toast.success(t("pay.saved"));
  }

  const diff = period.diff ?? 0;
  const month = monthNames()[period.month] ?? "";

  return (
    <li className="rounded-xl border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: period.job.color }}
            />
            <span className="truncate text-sm font-medium">{period.job.name}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("pay.period", { month })} · {t("pay.due", { date: formatDate(period.dueDate) })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums">{formatEuro(period.expected)}</p>
          <p className="text-[11px] text-muted-foreground">{t("pay.expected")}</p>
        </div>
      </div>

      {editing ? (
        <div className="mt-3 flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-9"
            aria-label={t("pay.actual")}
          />
          <Button size="sm" onClick={save}>
            {t("pay.save")}
          </Button>
        </div>
      ) : period.payment ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-2 flex w-full items-center justify-between rounded-lg bg-muted/60 px-2.5 py-1.5 text-left"
        >
          <span className="text-xs text-muted-foreground">
            {t("pay.actual")}: {formatEuro(period.payment.actual)}
          </span>
          <span
            className={cn(
              "text-xs font-medium",
              Math.abs(diff) < 0.01
                ? "text-muted-foreground"
                : diff > 0
                  ? "text-emerald-600"
                  : "text-destructive",
            )}
          >
            {Math.abs(diff) < 0.01 ? (
              <span className="inline-flex items-center gap-1">
                <Check className="size-3" /> {t("pay.diffOk")}
              </span>
            ) : diff > 0 ? (
              t("pay.diffPlus", { amount: formatEuro(diff) })
            ) : (
              t("pay.diffMinus", { amount: formatEuro(Math.abs(diff)) })
            )}
          </span>
        </button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full"
          onClick={() => setEditing(true)}
        >
          {t("pay.enter")}
        </Button>
      )}
    </li>
  );
}
