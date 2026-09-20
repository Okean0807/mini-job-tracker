import { beforeEach, describe, expect, it } from "vitest";

import {
  filterOrdersByStatus,
  hoursFromInterval,
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

describe("hoursFromInterval", () => {
  it("computes same-day duration", () => {
    expect(hoursFromInterval("09:00", "17:00")).toBe(8);
    expect(hoursFromInterval("08:00", "12:30")).toBe(4.5);
  });

  it("handles overnight (end < start)", () => {
    expect(hoursFromInterval("22:00", "02:00")).toBe(4);
  });

  it("returns undefined for missing/invalid", () => {
    expect(hoursFromInterval(undefined, "17:00")).toBeUndefined();
    expect(hoursFromInterval("09:00", undefined)).toBeUndefined();
    expect(hoursFromInterval("", "")).toBeUndefined();
    expect(hoursFromInterval("xx", "yy")).toBeUndefined();
  });
});

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
    objects: [],
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
    objects: [],
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


describe("order start/end → hoursWorked + same-day orders", () => {
  beforeEach(() => {
    replaceAll({
      shifts: [],
      jobs: [],
      customers: [],
      projects: [],
      payments: [],
      goals: [],
      orders: [],
    objects: [],
      settings: DEFAULT_SETTINGS,
      timer: null,
    });
  });

  it("persists start/end and derived hours; revenuePerHour from times", () => {
    const hours = hoursFromInterval("09:00", "12:00");
    expect(hours).toBe(3);
    const order = baseOrder({
      id: "ord-times",
      title: "Mit Zeiten",
      amount: 90,
      start: "09:00",
      end: "12:00",
      hoursWorked: hours!,
    });
    saveOrder(order);
    const stored = getData().orders[0]!;
    expect(stored.start).toBe("09:00");
    expect(stored.end).toBe("12:00");
    expect(stored.hoursWorked).toBe(3);
    expect(revenuePerHour(stored)).toBe(30);
  });

  it("keeps hoursWorked when order has no start/end (legacy)", () => {
    saveOrder(baseOrder({ id: "legacy", title: "Alt", hoursWorked: 14.5, amount: 450 }));
    const stored = getData().orders[0]!;
    expect(stored.start).toBeUndefined();
    expect(stored.end).toBeUndefined();
    expect(stored.hoursWorked).toBe(14.5);
    expect(revenuePerHour(stored)!).toBeCloseTo(31.0344827586, 5);
  });

  it("allows 2–3 orders on the same dateFrom", () => {
    saveOrder(baseOrder({ id: "a", title: "A", dateFrom: "2026-09-15", amount: 50 }));
    saveOrder(baseOrder({ id: "b", title: "B", dateFrom: "2026-09-15", amount: 60, start: "09:00", end: "11:00", hoursWorked: 2 }));
    saveOrder(baseOrder({ id: "c", title: "C", dateFrom: "2026-09-15", amount: 70 }));
    expect(getData().orders).toHaveLength(3);
    expect(getData().orders.filter((o) => o.dateFrom === "2026-09-15")).toHaveLength(3);
  });
});
