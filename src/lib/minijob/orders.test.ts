import { beforeEach, describe, expect, it } from "vitest";

import {
  filterOrdersByStatus,
  revenuePerHour,
  sortOrdersByDateDesc,
} from "./orders";
import { deleteOrder, getData, replaceAll, saveOrder } from "./store";
import { DEFAULT_SETTINGS, type Order } from "./types";
import { isValidPayload } from "./payload";

function baseOrder(partial: Partial<Order> & Pick<Order, "id" | "title">): Order {
  return {
    customerName: "Kunde",
    service: "Leistung",
    location: "Ort",
    dateFrom: "2026-09-01",
    amount: 100,
    status: "open",
    ...partial,
  };
}

describe("revenuePerHour", () => {
  it("computes amount/hoursWorked when hours > 0 (450/14.5 ≈ 31.03)", () => {
    const v = revenuePerHour({ amount: 450, hoursWorked: 14.5 });
    expect(v).toBeDefined();
    expect(v!).toBeCloseTo(31.0344827586, 5);
  });

  it("returns undefined when hours missing or zero", () => {
    expect(revenuePerHour({ amount: 450 })).toBeUndefined();
    expect(revenuePerHour({ amount: 450, hoursWorked: 0 })).toBeUndefined();
    expect(revenuePerHour({ amount: 450, hoursWorked: -1 })).toBeUndefined();
  });
});

describe("filterOrdersByStatus / sort", () => {
  const orders: Order[] = [
    baseOrder({ id: "a", title: "A", status: "open", dateFrom: "2026-09-10" }),
    baseOrder({ id: "b", title: "B", status: "in_progress", dateFrom: "2026-09-12" }),
    baseOrder({ id: "c", title: "C", status: "done", dateFrom: "2026-09-08" }),
    baseOrder({ id: "d", title: "D", status: "cancelled", dateFrom: "2026-09-11" }),
  ];

  it("filters by status; all includes cancelled", () => {
    expect(filterOrdersByStatus(orders, "all")).toHaveLength(4);
    expect(filterOrdersByStatus(orders, "open").map((o) => o.id)).toEqual(["a"]);
    expect(filterOrdersByStatus(orders, "in_progress").map((o) => o.id)).toEqual(["b"]);
    expect(filterOrdersByStatus(orders, "done").map((o) => o.id)).toEqual(["c"]);
    expect(filterOrdersByStatus(orders, "cancelled").map((o) => o.id)).toEqual(["d"]);
  });

  it("sorts by dateFrom descending", () => {
    expect(sortOrdersByDateDesc(orders).map((o) => o.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("store saveOrder / deleteOrder", () => {
  beforeEach(() => {
    replaceAll({
      shifts: [],
      jobs: [],
      customers: [],
      projects: [],
      payments: [],
      goals: [],
      orders: [],
      settings: DEFAULT_SETTINGS,
      timer: null,
    });
  });

  it("creates, updates, and deletes an order", () => {
    const created = baseOrder({
      id: "ord-1",
      title: "Reinigung",
      amount: 450,
      hoursWorked: 14.5,
      status: "open",
    });
    saveOrder(created);
    expect(getData().orders).toHaveLength(1);
    expect(getData().orders[0]?.title).toBe("Reinigung");

    saveOrder({ ...created, status: "done", title: "Reinigung erledigt" });
    expect(getData().orders).toHaveLength(1);
    expect(getData().orders[0]?.status).toBe("done");
    expect(getData().orders[0]?.title).toBe("Reinigung erledigt");

    deleteOrder("ord-1");
    expect(getData().orders).toHaveLength(0);
  });

  it("does not alter jobs/shifts (FLEX/FEST paths untouched)", () => {
    replaceAll({
      shifts: [
        {
          id: "s1",
          kind: "arbeit",
          date: "2026-09-01",
          start: "09:00",
          end: "12:00",
          breakMinutes: 0,
          jobId: "j-flex",
        },
      ],
      jobs: [
        { id: "j-flex", name: "Café", color: "#0d9488", mode: "flex", rate: 14 },
        { id: "j-fest", name: "Büro", color: "#2563eb", mode: "fest", rate: 15 },
      ],
      customers: [],
      projects: [],
      payments: [],
      goals: [],
      orders: [],
      settings: DEFAULT_SETTINGS,
      timer: null,
    });
    const before = getData();
    saveOrder(baseOrder({ id: "o1", title: "Auftrag" }));
    const after = getData();
    expect(after.jobs).toEqual(before.jobs);
    expect(after.shifts).toEqual(before.shifts);
    expect(after.orders).toHaveLength(1);
  });
});

describe("payload accepts orders", () => {
  it("accepts orders list of plain records alongside shifts/jobs", () => {
    expect(
      isValidPayload({
        shifts: [],
        jobs: [],
        orders: [{ id: "o1", title: "X", amount: 10, status: "open", dateFrom: "2026-01-01" }],
      }),
    ).toBe(true);
  });

  it("rejects non-record holes in orders", () => {
    expect(isValidPayload({ shifts: [], jobs: [], orders: [null] })).toBe(false);
    expect(isValidPayload({ shifts: [], jobs: [], orders: "x" })).toBe(false);
  });
});
