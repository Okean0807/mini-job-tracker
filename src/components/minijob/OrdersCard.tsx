import { ClipboardList, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { OrderDialog } from "@/components/minijob/OrderDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { formatEuro } from "@/lib/minijob/calc";
import {
  filterOrdersByStatus,
  revenuePerHour,
  sortOrdersByDateDesc,
  type OrderStatusFilter,
} from "@/lib/minijob/orders";
import type { Job, Order, OrderStatus, Payment } from "@/lib/minijob/types";
import { cn } from "@/lib/utils";

const FILTERS: OrderStatusFilter[] = ["all", "open", "in_progress", "done", "cancelled"];

function statusVariant(status: OrderStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "done") return "default";
  if (status === "cancelled") return "destructive";
  if (status === "in_progress") return "secondary";
  return "outline";
}

export function OrdersCard({
  orders,
  jobs,
  payments,
}: {
  orders: Order[];
  jobs: Job[];
  payments: Payment[];
}) {
  const { t } = useT();
  const [filter, setFilter] = useState<OrderStatusFilter>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);

  const list = useMemo(
    () => sortOrdersByDateDesc(filterOrdersByStatus(orders, filter)),
    [orders, filter],
  );

  function openNew() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(order: Order) {
    setEditing(order);
    setOpen(true);
  }

  return (
    <section
      className="col-span-2 rounded-2xl border bg-card p-4 shadow-card"
      aria-label={t("order.title")}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("order.title")}
        </span>
        <ClipboardList className="size-4 text-muted-foreground" />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium",
              filter === f
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground",
            )}
          >
            {t(`order.filter.${f}`)}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("order.empty")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {list.map((o) => {
            const rev = revenuePerHour(o);
            return (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => openEdit(o)}
                  className="w-full rounded-xl border bg-background/60 px-3 py-2.5 text-left transition hover:bg-muted/40"
                  aria-label={o.title}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{o.title}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {o.customerName || t("label.none")}
                        {o.dateFrom ? ` · ${o.dateFrom}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold tabular-nums">{formatEuro(o.amount)}</p>
                      <Badge variant={statusVariant(o.status)} className="mt-1">
                        {t(`order.status.${o.status}`)}
                      </Badge>
                    </div>
                  </div>
                  {rev !== undefined ? (
                    <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
                      {t("order.revenuePerHour")}: {formatEuro(rev)}
                    </p>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Button variant="outline" size="sm" className="mt-4 w-full" onClick={openNew}>
        <Plus className="size-4" /> {t("order.new")}
      </Button>

      <OrderDialog
        open={open}
        onOpenChange={setOpen}
        order={editing}
        jobs={jobs}
        payments={payments}
      />
    </section>
  );
}
