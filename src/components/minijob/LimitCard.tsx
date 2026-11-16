import { useId } from "react";
import { Gauge } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { useT } from "@/lib/i18n";
import { formatEuro, formatHours } from "@/lib/minijob/calc";
import { sharePastLimit } from "@/lib/minijob/legal/amounts";
import type { LimitUsage } from "@/lib/minijob/limits";
import { cn } from "@/lib/utils";

interface LimitCardProps {
  usage: LimitUsage;
  scopeLabel: string;
  rate: number;
  auto: boolean;
  /** Self-employed: employee Minijob limit not applicable. */
  notApplicable?: boolean;
  /**
   * `year` (default): calendar-year actual earnings against the annual reference – a
   * statistical figure, not a legal classification. `month`: the monthly reference
   * amount; a month above it is not automatically an exceedance. In both cases the
   * regular remuneration over the employment period (at most 12 months) is decisive,
   * and its assessment is the forecast card.
   */
  scope?: "month" | "year";
  /**
   * The legal assessment (rolling 12-month forecast) reports an exceedance. Only then does the
   * card use the alarm styling and the exceedance explanation; a figure above the reference
   * alone is a statistic.
   */
  legalExceeded?: boolean;
}

export function LimitCard({
  usage,
  scopeLabel,
  rate,
  auto,
  notApplicable,
  scope = "year",
  legalExceeded = false,
}: LimitCardProps) {
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
        alarm={legalExceeded}
        main={`${formatEuro(usage.earnings)} / ${formatEuro(usage.earningsLimit)}`}
        hint={t("limit.leftAmount", { amount: formatEuro(usage.earningsLeft) })}
      />
      <Bar
        titleId={titleId}
        label={t("limit.hours")}
        share={usage.hoursShare}
        alarm={legalExceeded}
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

      {/* The limit is an upper bound: exactly 100 % is within it, only more is above it.
          Figures above a REFERENCE are a statistic, not a legal classification; the alarm
          box is reserved for the legal assessment (the forecast card's result). */}
      {legalExceeded ? (
        <div className="mt-3 space-y-1 rounded-xl border border-destructive/30 bg-destructive/5 p-2.5">
          <p className="text-xs leading-relaxed text-destructive">{t("limit.overExplain")}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("limit.disclaimer")}</p>
        </div>
      ) : sharePastLimit(usage.earningsShare) || sharePastLimit(usage.hoursShare) ? (
        <div className="mt-3 rounded-xl border bg-muted/40 p-2.5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {scope === "month" ? t("limit.monthAboveNote") : t("limit.yearAboveNote")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Bar({
  titleId,
  label,
  share,
  alarm,
  main,
  hint,
}: {
  /** ID des sichtbaren Kartentitels – Teil des Accessible Name des Balkens. */
  titleId: string;
  label: string;
  share: number;
  /** Legal assessment exceeded: alarm colour. Otherwise a reference figure never reads as a violation. */
  alarm: boolean;
  main: string;
  hint: string;
}) {
  const labelId = useId();
  const clamped = Math.min(100, Math.round(share));
  // Exactly 100 % is within the limit; above it (or from 90 %) is only a caution colour.
  const caution = sharePastLimit(share) || share >= 90;
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between text-sm">
        <span id={labelId} className="font-medium">
          {label}
        </span>
        <span
          className={cn(
            "tabular-nums font-semibold",
            alarm ? "text-destructive" : caution ? "text-amber-600" : "text-foreground",
          )}
        >
          {Math.round(share)} %
        </span>
      </div>
      <Progress
        aria-labelledby={`${labelId} ${titleId}`}
        value={clamped}
        className={cn(
          "mt-1.5 h-2.5",
          alarm ? "[&>div]:bg-destructive" : sharePastLimit(share) && "[&>div]:bg-amber-500",
        )}
      />
      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
        {main} · {hint}
      </p>
    </div>
  );
}
