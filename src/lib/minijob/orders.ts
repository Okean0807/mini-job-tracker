import type { Order, OrderStatus } from "./types";

/**
 * Kennzahl „Umsatz pro Arbeitsstunde“ = vereinbarter Preis ÷ tatsächliche Stunden.
 * Niemals als Stundenlohn bezeichnen (SELF-Aufträge ≠ Minijob-Rate).
 */
export function revenuePerHour(order: Pick<Order, "amount" | "hoursWorked">): number | undefined {
  const hours = order.hoursWorked;
  if (hours === undefined || !(hours > 0)) return undefined;
  return order.amount / hours;
}

export type OrderStatusFilter = "all" | OrderStatus;

/** Filter by status chip; `all` includes cancelled. */
export function filterOrdersByStatus(orders: Order[], filter: OrderStatusFilter): Order[] {
  if (filter === "all") return orders;
  return orders.filter((o) => o.status === filter);
}

/** Sort newest dateFrom first (then createdAt / id). */
export function sortOrdersByDateDesc(orders: Order[]): Order[] {
  return [...orders].sort((a, b) => {
    if (a.dateFrom !== b.dateFrom) return a.dateFrom < b.dateFrom ? 1 : -1;
    const ac = a.createdAt ?? "";
    const bc = b.createdAt ?? "";
    if (ac !== bc) return ac < bc ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}
