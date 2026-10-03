import { PiggyBank, Plus, Check } from "lucide-react";
import { useId, useState } from "react";

import { GoalDialog } from "@/components/minijob/GoalDialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useT } from "@/lib/i18n";
import { formatEuro } from "@/lib/minijob/calc";
import type { GoalProgress } from "@/lib/minijob/goals";
import type { Goal, Job } from "@/lib/minijob/types";
import { cn } from "@/lib/utils";

export function GoalsCard({ goals, jobs }: { goals: GoalProgress[]; jobs: Job[] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const nameIdBase = useId();

  function openNew() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(goal: Goal) {
    setEditing(goal);
    setOpen(true);
  }

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("goal.title")}
        </span>
        <PiggyBank className="size-4 text-muted-foreground" />
      </div>

      {goals.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("goal.empty")}</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {goals.map((g, i) => (
            <li key={g.goal.id}>
              <button
                type="button"
                onClick={() => openEdit(g.goal)}
                className="w-full text-left"
                aria-label={g.goal.name}
              >
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span id={`${nameIdBase}-${i}`} className="truncate font-medium">
                    {g.goal.name}
                    {g.job ? (
                      <span className="ml-1 text-xs text-muted-foreground">· {g.job.name}</span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "tabular-nums font-semibold",
                      g.reached ? "text-primary" : "text-foreground",
                    )}
                  >
                    {Math.round(g.share)} %
                  </span>
                </div>
                <Progress
                  aria-labelledby={`${nameIdBase}-${i}`}
                  value={Math.min(100, Math.round(g.share))}
                  className={cn("mt-1.5 h-2.5", g.reached && "[&>div]:bg-primary")}
                />
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {t("goal.progress", {
                    saved: formatEuro(g.saved),
                    target: formatEuro(g.goal.target),
                  })}
                  {" · "}
                  {g.reached ? (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <Check className="size-3" /> {t("goal.reached")}
                    </span>
                  ) : (
                    t("goal.remaining", { amount: formatEuro(g.remaining) })
                  )}
                </p>
                {!g.reached && g.daysLeft !== undefined ? (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {g.daysLeft < 0
                      ? t("goal.overdue")
                      : t("goal.daysLeft", { days: g.daysLeft })}
                    {g.perMonth
                      ? ` · ${t("goal.perMonth", { amount: formatEuro(g.perMonth) })}`
                      : ""}
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button variant="outline" size="sm" className="mt-4 w-full" onClick={openNew}>
        <Plus className="size-4" /> {t("goal.new")}
      </Button>

      <GoalDialog open={open} onOpenChange={setOpen} goal={editing} jobs={jobs} />
    </div>
  );
}
