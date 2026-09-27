"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

/**
 * Wert für Radix (aria-valuenow). Radix akzeptiert nur endliche Zahlen in
 * [0, max] und loggt sonst einen Fehler; ungültig → null (indeterminate).
 * Nur der ARIA-Wert wird begrenzt – der Indikator nutzt weiter `value` direkt.
 */
function ariaValue(value: number | null | undefined, max: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const upper = typeof max === "number" && Number.isFinite(max) && max > 0 ? max : 100;
  return Math.min(Math.max(value, 0), upper);
}

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className)}
    {...props}
    value={ariaValue(value, props.max)}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 bg-primary transition-all"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
