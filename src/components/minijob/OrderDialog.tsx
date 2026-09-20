import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";
import { formatEuro, formatHours } from "@/lib/minijob/calc";
import { hoursFromInterval, revenuePerHour } from "@/lib/minijob/orders";
import { deleteOrder, newId, saveOrder } from "@/lib/minijob/store";
import type { Job, Order, OrderStatus, Payment } from "@/lib/minijob/types";
import { cn } from "@/lib/utils";

const STATUSES: OrderStatus[] = ["open", "in_progress", "done", "cancelled"];

interface OrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order?: Order | null;
  jobs: Job[];
  payments: Payment[];
}

export function OrderDialog({ open, onOpenChange, order, jobs, payments }: OrderDialogProps) {
  const { t } = useT();
  const [title, setTitle] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [service, setService] = useState("");
  const [location, setLocation] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<OrderStatus>("open");
  const [hoursWorked, setHoursWorked] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [jobId, setJobId] = useState("");

  const selfJobs = jobs.filter((j) => j.mode === "selbststaendig" && !j.archived);

  useEffect(() => {
    if (!open) return;
    setTitle(order?.title ?? "");
    setCustomerName(order?.customerName ?? "");
    setService(order?.service ?? "");
    setLocation(order?.location ?? "");
    setDateFrom(order?.dateFrom ?? "");
    setDateTo(order?.dateTo ?? "");
    setAmount(order ? String(order.amount) : "");
    setStatus(order?.status ?? "open");
    setHoursWorked(order?.hoursWorked !== undefined ? String(order.hoursWorked) : "");
    setStart(order?.start ?? "");
    setEnd(order?.end ?? "");
    setNotes(order?.notes ?? "");
    setPaymentId(order?.paymentId ?? "");
    setJobId(order?.jobId ?? "");
  }, [open, order]);

  function num(value: string): number {
    return Number(value.replace(",", ".")) || 0;
  }

  function submit() {
    if (!title.trim()) {
      toast.error(t("order.titleRequired"));
      return;
    }
    if (!dateFrom) {
      toast.error(t("order.dateRequired"));
      return;
    }
    const next: Order = {
      id: order?.id ?? newId(),
      title: title.trim(),
      customerName: customerName.trim(),
      service: service.trim(),
      location: location.trim(),
      dateFrom,
      amount: num(amount),
      status,
      createdAt: order?.createdAt ?? new Date().toISOString(),
    };
    if (dateTo) next.dateTo = dateTo;
    if (start.trim()) next.start = start.trim();
    if (end.trim()) next.end = end.trim();
    const fromTimes = hoursFromInterval(start.trim() || undefined, end.trim() || undefined);
    if (fromTimes !== undefined) {
      next.hoursWorked = fromTimes;
    } else {
      const hours = num(hoursWorked);
      if (hoursWorked.trim() && hours > 0) next.hoursWorked = hours;
    }
    if (notes.trim()) next.notes = notes.trim();
    if (paymentId) next.paymentId = paymentId;
    if (jobId) next.jobId = jobId;
    saveOrder(next);
    toast.success(t("order.saveOk"));
    onOpenChange(false);
  }

  function remove() {
    if (!order) return;
    deleteOrder(order.id);
    toast.success(t("order.deleteOk"));
    onOpenChange(false);
  }

  const derivedHours = hoursFromInterval(start.trim() || undefined, end.trim() || undefined);
  const effectiveHours =
    derivedHours !== undefined
      ? derivedHours
      : hoursWorked.trim() && num(hoursWorked) > 0
        ? num(hoursWorked)
        : undefined;
  const previewInput: { amount: number; hoursWorked?: number } = { amount: num(amount) };
  if (effectiveHours !== undefined) previewInput.hoursWorked = effectiveHours;
  const previewRev = revenuePerHour(previewInput);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{order ? t("order.edit") : t("order.new")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="order-title">{t("order.titleField")}</Label>
            <Input
              id="order-title"
              value={title}
              placeholder={t("order.titlePh")}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="order-customer">{t("order.customer")}</Label>
            <Input
              id="order-customer"
              value={customerName}
              placeholder={t("order.customerPh")}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="order-service">{t("order.service")}</Label>
            <Input
              id="order-service"
              value={service}
              placeholder={t("order.servicePh")}
              onChange={(e) => setService(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="order-location">{t("order.location")}</Label>
            <Input
              id="order-location"
              value={location}
              placeholder={t("order.locationPh")}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="order-from">{t("order.dateFrom")}</Label>
              <Input
                id="order-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-to">{t("order.dateTo")}</Label>
              <Input
                id="order-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="order-start">{t("order.start")}</Label>
              <Input
                id="order-start"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-end">{t("order.end")}</Label>
              <Input
                id="order-end"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          {derivedHours !== undefined ? (
            <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm tabular-nums">
              <span className="text-muted-foreground">{t("order.duration")}: </span>
              <span className="font-semibold">{formatHours(derivedHours)}</span>
              <span className="ml-1 text-xs text-muted-foreground">
                ({t("order.durationFromTimes")})
              </span>
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="order-amount">{t("order.amount")}</Label>
              <Input
                id="order-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-hours">{t("order.hoursWorked")}</Label>
              <Input
                id="order-hours"
                inputMode="decimal"
                value={derivedHours !== undefined ? String(derivedHours) : hoursWorked}
                onChange={(e) => setHoursWorked(e.target.value)}
                disabled={derivedHours !== undefined}
              />
            </div>
          </div>

          {previewRev !== undefined ? (
            <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm tabular-nums">
              <span className="text-muted-foreground">{t("order.revenuePerHour")}: </span>
              <span className="font-semibold">{formatEuro(previewRev)}</span>
              <span className="ml-1 text-xs text-muted-foreground">
                ({t("order.revenuePerHourHint")})
              </span>
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label>{t("order.status")}</Label>
            <div className="grid grid-cols-2 gap-2">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-sm font-medium",
                    status === s
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  {t(`order.status.${s}`)}
                </button>
              ))}
            </div>
          </div>

          {selfJobs.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="order-job">{t("order.job")}</Label>
              <select
                id="order-job"
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">{t("order.noJob")}</option>
                {selfJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="order-payment">{t("order.payment")}</Label>
            <select
              id="order-payment"
              value={paymentId}
              onChange={(e) => setPaymentId(e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">{t("order.noPayment")}</option>
              {payments.map((p) => (
                <option key={p.id} value={p.id}>
                  {formatEuro(p.actual)}
                  {p.paidOn ? ` · ${p.paidOn}` : ""}
                  {` · ${p.year}-${String(p.month + 1).padStart(2, "0")}`}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{t("order.paymentHint")}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="order-notes">{t("order.notes")}</Label>
            <Textarea
              id="order-notes"
              value={notes}
              rows={3}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {order ? (
            <Button variant="outline" onClick={remove} className="text-destructive">
              <Trash2 className="size-4" /> {t("order.delete")}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={submit}>{t("order.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
