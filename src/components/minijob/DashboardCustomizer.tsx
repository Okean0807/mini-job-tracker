import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Pin, PinOff } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import {
  LAYOUT_PRESETS,
  WIDGET_LABEL_KEY,
  moveWidget,
  presetConfig,
  widgetSize,
} from "@/lib/minijob/dashboard";
import { updateDashboard } from "@/lib/minijob/store";
import type { DashboardConfig, WidgetId, WidgetSize } from "@/lib/minijob/types";
import { cn } from "@/lib/utils";

const SIZES: WidgetSize[] = ["small", "medium", "large"];

export function DashboardCustomizer({
  open,
  onOpenChange,
  config,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: DashboardConfig;
}) {
  const { t } = useT();
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function toggle(list: WidgetId[], id: WidgetId): WidgetId[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function reorder(from: number, to: number) {
    if (to < 0 || to >= config.order.length || from === to) return;
    updateDashboard({ order: moveWidget(config.order, from, to) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("dash.customize")}</DialogTitle>
          <DialogDescription>{t("dash.customizeHint")}</DialogDescription>
        </DialogHeader>

        <div>
          <p className="mb-2 text-xs font-semibold text-muted-foreground">{t("dash.layouts")}</p>
          <div className="flex flex-wrap gap-2">
            {LAYOUT_PRESETS.map((preset) => (
              <Button
                key={preset}
                size="sm"
                variant={config.layout === preset ? "default" : "outline"}
                onClick={() => updateDashboard(presetConfig(preset))}
              >
                {t(`dash.layout.${preset}`)}
              </Button>
            ))}
          </div>
        </div>

        <ul className="mt-2 space-y-2">
          {config.order.map((id, index) => {
            const hidden = config.hidden.includes(id);
            const pinned = config.pinned.includes(id);
            return (
              <li
                key={id}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null) reorder(dragIndex, index);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                className={cn(
                  "rounded-xl border p-2",
                  hidden && "opacity-55",
                  dragIndex === index && "border-primary",
                )}
              >
                <div className="flex items-center gap-1">
                  <GripVertical
                    className="size-4 shrink-0 cursor-grab text-muted-foreground"
                    aria-label={t("dash.dragHint")}
                  />
                  <span className="flex-1 truncate text-sm font-medium">
                    {t(WIDGET_LABEL_KEY[id])}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("dash.moveUp")}
                    onClick={() => reorder(index, index - 1)}
                  >
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("dash.moveDown")}
                    onClick={() => reorder(index, index + 1)}
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={pinned ? t("dash.unpin") : t("dash.pin")}
                    onClick={() => updateDashboard({ pinned: toggle(config.pinned, id) })}
                  >
                    {pinned ? (
                      <PinOff className="size-4" />
                    ) : (
                      <Pin className="size-4 text-muted-foreground" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={hidden ? t("dash.show") : t("dash.hide")}
                    onClick={() => updateDashboard({ hidden: toggle(config.hidden, id) })}
                  >
                    {hidden ? (
                      <EyeOff className="size-4 text-muted-foreground" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </Button>
                </div>

                <div className="mt-1 flex gap-1 pl-5">
                  {SIZES.map((size) => (
                    <Button
                      key={size}
                      size="sm"
                      variant={widgetSize(config, id) === size ? "secondary" : "ghost"}
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        updateDashboard({ sizes: { ...config.sizes, [id]: size } })
                      }
                    >
                      {t(`size.${size}`)}
                    </Button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-2 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => updateDashboard(presetConfig("work"))}
          >
            {t("dash.reset")}
          </Button>
          <Button className="flex-1" onClick={() => onOpenChange(false)}>
            {t("dash.done")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
