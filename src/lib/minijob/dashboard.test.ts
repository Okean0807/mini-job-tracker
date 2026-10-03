import { describe, expect, it } from "vitest";

import {
  DEFAULT_DASHBOARD,
  LAYOUT_PRESETS,
  WIDGET_IDS,
  WIDGET_LABEL_KEY,
  activeWidgets,
  moveWidget,
  normalizeDashboard,
  presetConfig,
  spanClass,
  widgetSize,
} from "./dashboard";
import type { DashboardConfig, WidgetId } from "./types";

describe("constants", () => {
  it("listet alle Widget-IDs und Labels", () => {
    expect(WIDGET_IDS).toEqual([
      "timer",
      "stats",
      "limitMonth",
      "limitYear",
      "legalForecast",
      "payday",
      "insights",
      "goals",
      "calendar",
      "shifts",
    ]);
    for (const id of WIDGET_IDS) {
      expect(WIDGET_LABEL_KEY[id]).toBe(`widget.${id}`);
    }
  });

  it("DEFAULT_DASHBOARD startet mit voller Reihenfolge und leeren Listen", () => {
    expect(DEFAULT_DASHBOARD.layout).toBe("work");
    expect(DEFAULT_DASHBOARD.order).toEqual(WIDGET_IDS);
    expect(DEFAULT_DASHBOARD.hidden).toEqual([]);
    expect(DEFAULT_DASHBOARD.pinned).toEqual([]);
    expect(DEFAULT_DASHBOARD.sizes).toEqual({});
  });

  it("kennt die drei Layout-Presets", () => {
    expect(LAYOUT_PRESETS).toEqual(["work", "stats", "compact"]);
  });
});

describe("presetConfig", () => {
  it("liefert das Arbeits-Layout (work) als Default", () => {
    const cfg = presetConfig("work");
    expect(cfg.layout).toBe("work");
    expect(cfg.order).toEqual(WIDGET_IDS);
    expect(cfg.hidden).toEqual([]);
    expect(cfg.pinned).toEqual([]);
    expect(cfg.sizes).toEqual({});
  });

  it("stellt Statistik-Layout mit großen Widgets und Stats angepinnt", () => {
    const cfg = presetConfig("stats");
    expect(cfg.layout).toBe("stats");
    expect(cfg.order[0]).toBe("stats");
    expect(cfg.pinned).toEqual(["stats"]);
    expect(cfg.sizes).toEqual({ stats: "large", insights: "large" });
    expect(cfg.hidden).toEqual([]);
    expect(new Set(cfg.order)).toEqual(new Set(WIDGET_IDS));
  });

  it("stellt Kompakt-Layout mit versteckten Neben-Widgets", () => {
    const cfg = presetConfig("compact");
    expect(cfg.layout).toBe("compact");
    expect(cfg.order[0]).toBe("timer");
    expect(cfg.hidden).toEqual(["limitYear", "payday", "insights", "goals"]);
    expect(cfg.sizes).toEqual({ stats: "small", timer: "small" });
    expect(cfg.pinned).toEqual([]);
    expect(new Set(cfg.order)).toEqual(new Set(WIDGET_IDS));
  });
});

describe("normalizeDashboard", () => {
  it("füllt Defaults bei fehlendem Input", () => {
    expect(normalizeDashboard()).toEqual({
      layout: "work",
      order: [...WIDGET_IDS],
      hidden: [],
      pinned: [],
      sizes: {},
    });
  });

  it("filtert unbekannte Widget-IDs und ergänzt fehlende", () => {
    const cfg = normalizeDashboard({
      layout: "stats",
      order: ["timer", "bogus" as WidgetId, "stats"],
      hidden: ["goals", "nope" as WidgetId],
      pinned: ["timer", "xyz" as WidgetId],
      sizes: { timer: "large" },
    });
    expect(cfg.layout).toBe("stats");
    expect(cfg.order[0]).toBe("timer");
    expect(cfg.order[1]).toBe("stats");
    expect(cfg.order).not.toContain("bogus");
    expect(cfg.order).toHaveLength(WIDGET_IDS.length);
    for (const id of WIDGET_IDS) expect(cfg.order).toContain(id);
    expect(cfg.hidden).toEqual(["goals"]);
    expect(cfg.pinned).toEqual(["timer"]);
    expect(cfg.sizes).toEqual({ timer: "large" });
  });

  it("bewahrt leere sizes und leere Listen", () => {
    const cfg = normalizeDashboard({
      order: [...WIDGET_IDS],
      hidden: [],
      pinned: [],
      sizes: {},
    });
    expect(cfg.sizes).toEqual({});
    expect(cfg.hidden).toEqual([]);
    expect(cfg.pinned).toEqual([]);
  });
});

describe("widgetSize", () => {
  it("nutzt konfigurierte Größe oder medium als Default", () => {
    const cfg: DashboardConfig = {
      ...DEFAULT_DASHBOARD,
      sizes: { timer: "small", stats: "large" },
    };
    expect(widgetSize(cfg, "timer")).toBe("small");
    expect(widgetSize(cfg, "stats")).toBe("large");
    expect(widgetSize(cfg, "goals")).toBe("medium");
  });
});

describe("activeWidgets", () => {
  const base: DashboardConfig = {
    layout: "work",
    order: [...WIDGET_IDS],
    hidden: [],
    pinned: [],
    sizes: {},
  };

  it("zeigt im Pro-Modus alle nicht versteckten Widgets", () => {
    expect(activeWidgets(base, "pro")).toEqual(WIDGET_IDS);
  });

  it("entfernt versteckte Widgets", () => {
    const cfg = { ...base, hidden: ["goals", "insights"] as WidgetId[] };
    expect(activeWidgets(cfg, "pro")).not.toContain("goals");
    expect(activeWidgets(cfg, "pro")).not.toContain("insights");
    expect(activeWidgets(cfg, "pro")).toContain("timer");
  });

  it("stellt angepinnte Widgets nach vorne (Order-Reihenfolge unter den Pinned)", () => {
    const cfg: DashboardConfig = {
      ...base,
      order: ["timer", "stats", "goals", "calendar", "shifts", "limitMonth", "limitYear", "payday", "insights"],
      pinned: ["goals", "timer"],
    };
    const list = activeWidgets(cfg, "pro");
    // pinned filter follows config.order, not pinned[] order → timer before goals
    expect(list.slice(0, 2)).toEqual(["timer", "goals"]);
    expect(list.filter((id) => id === "goals")).toHaveLength(1);
  });

  it("filtert nach Oberflächen-Modus (simple ohne goals/payday/insights/limitYear)", () => {
    const list = activeWidgets(base, "simple");
    expect(list).toContain("timer");
    expect(list).toContain("shifts"); // kein Feature-Gate
    expect(list).toContain("stats");
    expect(list).toContain("limitMonth");
    expect(list).toContain("calendar");
    expect(list).not.toContain("goals");
    expect(list).not.toContain("payday");
    expect(list).not.toContain("insights");
    expect(list).not.toContain("limitYear");
  });

  it("zeigt im Standard-Modus goals und payday", () => {
    const list = activeWidgets(base, "standard");
    expect(list).toContain("goals");
    expect(list).toContain("payday");
    expect(list).toContain("insights");
    expect(list).toContain("limitYear");
  });
});

describe("moveWidget", () => {
  const order: WidgetId[] = ["timer", "stats", "goals", "shifts"];

  it("verschiebt ein Widget nach vorne", () => {
    expect(moveWidget(order, 2, 0)).toEqual(["goals", "timer", "stats", "shifts"]);
  });

  it("verschiebt ein Widget nach hinten", () => {
    expect(moveWidget(order, 0, 3)).toEqual(["stats", "goals", "shifts", "timer"]);
  });

  it("ändert nichts bei out-of-range from-Index", () => {
    expect(moveWidget(order, 99, 0)).toEqual(order);
    expect(moveWidget(order, 4, 0)).toEqual(order);
  });

  it("klemmt to-Index in den gültigen Bereich", () => {
    expect(moveWidget(order, 0, 100)).toEqual(["stats", "goals", "shifts", "timer"]);
    expect(moveWidget(order, 3, -5)).toEqual(["shifts", "timer", "stats", "goals"]);
  });

  it("mutiert das Original-Array nicht", () => {
    const copy = [...order];
    moveWidget(order, 1, 3);
    expect(order).toEqual(copy);
  });
});

describe("spanClass", () => {
  it("mappt small auf col-span-1 und sonst col-span-2", () => {
    expect(spanClass("small")).toBe("col-span-1");
    expect(spanClass("medium")).toBe("col-span-2");
    expect(spanClass("large")).toBe("col-span-2");
  });
});
