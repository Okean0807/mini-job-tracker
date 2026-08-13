import type { DashboardConfig, DashboardLayout, UiMode, WidgetId, WidgetSize } from "./types";
import { visible, type Feature } from "./uimode";

export const WIDGET_IDS: WidgetId[] = [
  "timer",
  "stats",
  "limitMonth",
  "limitYear",
  "payday",
  "insights",
  "calendar",
  "shifts",
];

/** Welches Oberflächen-Feature ein Widget benötigt (undefined = immer erlaubt). */
const WIDGET_FEATURE: Partial<Record<WidgetId, Feature>> = {
  stats: "dash.statGrid",
  limitMonth: "dash.limitMonth",
  limitYear: "dash.limitYear",
  payday: "dash.payday",
  insights: "dash.insights",
  calendar: "dash.calendar",
};

export const WIDGET_LABEL_KEY: Record<WidgetId, string> = {
  timer: "widget.timer",
  stats: "widget.stats",
  limitMonth: "widget.limitMonth",
  limitYear: "widget.limitYear",
  payday: "widget.payday",
  insights: "widget.insights",
  calendar: "widget.calendar",
  shifts: "widget.shifts",
};

export const DEFAULT_DASHBOARD: DashboardConfig = {
  layout: "work",
  order: [...WIDGET_IDS],
  hidden: [],
  pinned: [],
  sizes: {},
};

export const LAYOUT_PRESETS: DashboardLayout[] = ["work", "stats", "compact"];

/** Vordefinierte Layouts: Arbeiten, Statistik, Kompakt. */
export function presetConfig(layout: DashboardLayout): DashboardConfig {
  if (layout === "stats") {
    return {
      layout,
      order: ["stats", "insights", "limitMonth", "limitYear", "payday", "calendar", "timer", "shifts"],
      hidden: [],
      pinned: ["stats"],
      sizes: { stats: "large", insights: "large" },
    };
  }
  if (layout === "compact") {
    return {
      layout,
      order: ["timer", "stats", "limitMonth", "shifts", "calendar", "insights", "payday", "limitYear"],
      hidden: ["limitYear", "payday", "insights"],
      pinned: [],
      sizes: { stats: "small", timer: "small" },
    };
  }
  return { ...DEFAULT_DASHBOARD, layout: "work", order: [...WIDGET_IDS], sizes: {}, hidden: [], pinned: [] };
}

export function normalizeDashboard(input?: Partial<DashboardConfig>): DashboardConfig {
  const order = (input?.order ?? []).filter((id) => WIDGET_IDS.includes(id));
  for (const id of WIDGET_IDS) if (!order.includes(id)) order.push(id);
  return {
    layout: input?.layout ?? "work",
    order,
    hidden: (input?.hidden ?? []).filter((id) => WIDGET_IDS.includes(id)),
    pinned: (input?.pinned ?? []).filter((id) => WIDGET_IDS.includes(id)),
    sizes: input?.sizes ?? {},
  };
}

export function widgetSize(config: DashboardConfig, id: WidgetId): WidgetSize {
  return config.sizes[id] ?? "medium";
}

/** Sichtbare Widgets in Reihenfolge – angepinnte zuerst, Oberflächen-Modus beachtet. */
export function activeWidgets(config: DashboardConfig, mode: UiMode): WidgetId[] {
  const list = config.order.filter((id) => {
    if (config.hidden.includes(id)) return false;
    const feature = WIDGET_FEATURE[id];
    return feature ? visible(feature, mode) : true;
  });
  const pinned = list.filter((id) => config.pinned.includes(id));
  return [...pinned, ...list.filter((id) => !pinned.includes(id))];
}

export function moveWidget(order: WidgetId[], from: number, to: number): WidgetId[] {
  const next = [...order];
  const [item] = next.splice(from, 1);
  if (!item) return order;
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

export function spanClass(size: WidgetSize): string {
  return size === "small" ? "col-span-1" : "col-span-2";
}
