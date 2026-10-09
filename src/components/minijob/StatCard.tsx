import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  highlight?: boolean;
  /** Optionale Zusatzzeilen unter `hint` (z. B. „davon …“, „+ … geplant“). */
  details?: readonly string[];
}

export function StatCard({ label, value, hint, icon: Icon, highlight, details }: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4 shadow-card",
        highlight ? "bg-gradient-primary border-transparent text-primary-foreground" : "bg-card",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "text-xs font-medium uppercase tracking-wide",
            highlight ? "opacity-80" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <Icon className="size-4 opacity-70" />
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
      {hint ? (
        <p className={cn("mt-1 text-xs", highlight ? "opacity-80" : "text-muted-foreground")}>
          {hint}
        </p>
      ) : null}
      {details?.map((line) => (
        <p key={line} className={cn("text-xs", highlight ? "opacity-80" : "text-muted-foreground")}>
          {line}
        </p>
      ))}
    </div>
  );
}
