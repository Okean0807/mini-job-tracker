import { CalendarClock, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import { formatDate, formatEuro, isoDate, monthNames } from "@/lib/minijob/calc";
import type { PayPeriod } from "@/lib/minijob/payday";
import { deletePayment, newId, savePayment } from "@/lib/minijob/store";
import type { Payment } from "@/lib/minijob/types";
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
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [value, setValue] = useState("");

  function startNew() {
    const initial = period.outstanding > 0 ? period.outstanding : period.expected;
    setValue(initial > 0 ? initial.toFixed(2) : "");
    setEditingId("new");
  }

  function startEdit(payment: Payment) {
    setValue(String(payment.actual));
    setEditingId(payment.id);
  }

  function save() {
    const actual = Number(value.replace(",", "."));
    if (!Number.isFinite(actual) || actual <= 0) {
      toast.error(t("pay.invalid"));
      return;
    }

    const existing = editingId && editingId !== "new"
      ? period.payments.find((payment) => payment.id === editingId)
      : undefined;

    savePayment({
      id: existing?.id ?? newId(),
      jobId: period.job.id,
      year: period.year,
      month: period.month,
      actual,
      confirmed: true,
      paidOn: existing?.paidOn ?? isoDate(new Date()),
      note: existing?.note,
    });
    setEditingId(null);
    toast.success(t("pay.saved"));
  }

  function remove(payment: Payment) {
    deletePayment(payment.id);
    if (editingId === payment.id) setEditingId(null);
    toast.success(t("pay.deleted"));
  }

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

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-lg bg-muted/40 px-2 py-1.5">
          <div className="text-muted-foreground">{t("pay.earned")}</div>
          <div className="font-medium tabular-nums">{formatEuro(period.earned)}</div>
        </div>
        <div className="rounded-lg bg-muted/40 px-2 py-1.5">
          <div className="text-muted-foreground">{t("pay.paid")}</div>
          <div className="font-medium tabular-nums">{formatEuro(period.paid)}</div>
        </div>
        <div className="rounded-lg bg-muted/40 px-2 py-1.5">
          <div className="text-muted-foreground">{t("pay.open")}</div>
          <div className="font-medium tabular-nums">{formatEuro(period.outstanding)}</div>
        </div>
        <div className="rounded-lg bg-muted/40 px-2 py-1.5">
          <div className="text-muted-foreground">{t("pay.overpaid")}</div>
          <div className="font-medium tabular-nums">{formatEuro(period.overpaid)}</div>
        </div>
      </div>

      {period.overdue && (
        <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs font-medium text-destructive">
          {t("pay.overdue")}
        </div>
      )}

      {period.payments.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("pay.payments")}
          </div>
          {period.payments.map((payment) => (
            <div key={payment.id} className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-2">
              {editingId === payment.id ? (
                <>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="h-8 flex-1"
                    aria-label={t("pay.actual")}
                  />
                  <Button size="sm" onClick={save}>{t("pay.save")}</Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-xs tabular-nums">
                    {formatEuro(payment.actual)}{payment.paidOn ? ` · ${formatDate(payment.paidOn)}` : ""}
                  </span>
                  <Button size="icon" variant="ghost" className="size-8" onClick={() => startEdit(payment)} aria-label={t("pay.edit")}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => remove(payment)} aria-label={t("pay.delete")}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {editingId === "new" ? (
        <div className="mt-3 flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-9"
            aria-label={t("pay.actual")}
            autoFocus
          />
          <Button size="sm" onClick={save}>{t("pay.save")}</Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="mt-3 w-full" onClick={startNew}>
          <Plus className="mr-1 size-4" />
          {t("pay.add")}
        </Button>
      )}

      {period.payments.length > 0 && (
        <div className="mt-2 flex items-center justify-between rounded-lg bg-muted/30 px-2.5 py-1.5 text-xs">
          <span className="text-muted-foreground">{t("pay.paymentDiff")}</span>
          <span
            className={cn(
              "font-medium tabular-nums",
              Math.abs(period.paymentDiff) < 0.01
                ? "text-muted-foreground"
                : period.paymentDiff > 0
                  ? "text-emerald-600"
                  : "text-destructive",
            )}
          >
            {Math.abs(period.paymentDiff) < 0.01
              ? <span className="inline-flex items-center gap-1"><Check className="size-3" />{t("pay.diffOk")}</span>
              : formatEuro(period.paymentDiff)}
          </span>
        </div>
      )}
    </li>
  );
}
