import { useId } from "react";
import { Gauge } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { useT } from "@/lib/i18n";
import { formatEuro, formatHours } from "@/lib/minijob/calc";
import type { LimitUsage } from "@/lib/minijob/limits";
import { cn } from "@/lib/utils";

interface LimitCardProps {
  usage: LimitUsage;
  scopeLabel: string;
  rate: number;
  auto: boolean;
  /** Self-employed: employee Minijob limit not applicable. */
  notApplicable?: boolean;
}

export function LimitCard({ usage, scopeLabel, rate, auto, notApplicable }: LimitCardProps) {
  const { t } = useT();
  const titleId = useId();
  if (notApplicable) {
    return (
      <div className="rounded-2xl border bg-card p-4 shadow-card">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("limit.title")} · {scopeLabel}
          </span>
          <Gauge className="size-4 text-muted-foreground" />
        </div>
        <p className="mt-3 text-sm font-semibold">{t("limit.notApplicable")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("limit.notApplicableHint")}</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between">
        <span
          id={titleId}
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          {t("limit.title")} · {scopeLabel}
        </span>
        <Gauge className="size-4 text-muted-foreground" />
      </div>

      <Bar
        titleId={titleId}
        label={t("limit.earnings")}
        share={usage.earningsShare}
        main={`${formatEuro(usage.earnings)} / ${formatEuro(usage.earningsLimit)}`}
        hint={t("limit.leftAmount", { amount: formatEuro(usage.earningsLeft) })}
      />
      <Bar
        titleId={titleId}
        label={t("limit.hours")}
        share={usage.hoursShare}
        main={`${formatHours(usage.hours)} / ${formatHours(usage.hoursLimit)}`}
        hint={
          auto
            ? t("limit.autoHint", {
                hours: formatHours(usage.hoursLimit),
                rate: formatEuro(rate),
              })
            : t("limit.leftHours", { hours: formatHours(usage.hoursLeft) })
        }
      />

      {usage.earningsShare >= 100 || usage.hoursShare >= 100 ? (
        <div className="mt-3 space-y-1 rounded-xl border border-destructive/30 bg-destructive/5 p-2.5">
          <p className="text-xs leading-relaxed text-destructive">{t("limit.overExplain")}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("limit.disclaimer")}</p>
        </div>
      ) : null}
    </div>
  );
}

function Bar({
  titleId,
  label,
  share,
  main,
  hint,
}: {
  /** ID des sichtbaren Kartentitels – Teil des Accessible Name des Balkens. */
  titleId: string;
  label: string;
  share: number;
  main: string;
  hint: string;
}) {
  const labelId = useId();
  const clamped = Math.min(100, Math.round(share));
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between text-sm">
        <span id={labelId} className="font-medium">
          {label}
        </span>
        <span
          className={cn(
            "tabular-nums font-semibold",
            share >= 100 ? "text-destructive" : share >= 90 ? "text-amber-600" : "text-foreground",
          )}
        >
          {Math.round(share)} %
        </span>
      </div>
      <Progress
        aria-labelledby={`${labelId} ${titleId}`}
        value={clamped}
        className={cn("mt-1.5 h-2.5", share >= 100 && "[&>div]:bg-destructive")}
      />
      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
        {main} · {hint}
      </p>
    </div>
  );
}
