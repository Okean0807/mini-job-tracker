import { useId } from "react";
import { Gauge } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { useT } from "@/lib/i18n";
import { formatEuro, formatHours, monthNames } from "@/lib/minijob/calc";
import type { LimitUsage } from "@/lib/minijob/limits";
import { cn } from "@/lib/utils";

/** "YYYY-MM" → "März 2026" (D6: betroffene Monate). */
export function o4MonthLabel(key: string): string {
  return `${monthNames()[Number(key.slice(5, 7)) - 1] ?? key} ${key.slice(0, 4)}`;
}

interface LimitCardProps {
  usage: LimitUsage;
  scopeLabel: string;
  rate: number;
  auto: boolean;
  /** Self-employed: employee Minijob limit not applicable. */
  notApplicable?: boolean;
  /**
   * B3-1/O4: Hauptbeschäftigung + mehrere Minijobs. Die Karte zeigt dann nur
   * einen Hinweis und die Summe zur Information – keinen Status/Anteil.
   */
  multipleMinijobs?: boolean;
  /** D6: Monate ("YYYY-MM") im Zeitraum, die den Hinweis auslösen. */
  affectedMonths?: readonly string[];
  /** D6: true = der Hinweis entsteht nur durch ANDERE Monate des Zeitraums. */
  causedByOtherMonths?: boolean;
  /**
   * Owner R5 (Variante B): Konstellation nicht sicher bestimmbar (bezahlte
   * Abwesenheiten nur geschätzt / Bestätigung offen) → kein Status.
   */
  o4Uncertain?: boolean;
  /** Monate ("YYYY-MM") mit unsicherem Status. */
  uncertainMonths?: readonly string[];
}

export function LimitCard({
  usage,
  scopeLabel,
  rate,
  auto,
  notApplicable,
  multipleMinijobs,
  affectedMonths,
  causedByOtherMonths,
  o4Uncertain,
  uncertainMonths,
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
  if (multipleMinijobs || o4Uncertain) {
    return (
      <div
        className="rounded-2xl border bg-card p-4 shadow-card"
        data-testid={multipleMinijobs ? "limit-multiple-minijobs" : "limit-o4-uncertain"}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("limit.title")} · {scopeLabel}
          </span>
          <Gauge className="size-4 text-muted-foreground" />
        </div>
        <div className="mt-3 space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/5 p-2.5">
          <p className="text-sm font-semibold">
            {t(multipleMinijobs ? "limit.multipleMinijobs" : "limit.o4Uncertain")}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(multipleMinijobs ? "limit.multipleMinijobsHint" : "limit.o4UncertainHint")}
          </p>
        </div>
        {multipleMinijobs && affectedMonths?.length ? (
          <p className="mt-2 text-xs text-muted-foreground" data-testid="limit-o4-months">
            {t("limit.multipleMinijobsMonths", {
              months: affectedMonths.map(o4MonthLabel).join(", "),
            })}
          </p>
        ) : null}
        {causedByOtherMonths ? (
          <p className="mt-1 text-xs text-muted-foreground" data-testid="limit-o4-other-months">
            {t("limit.multipleMinijobsOtherMonths")}
          </p>
        ) : null}
        {uncertainMonths?.length ? (
          <p className="mt-1 text-xs text-muted-foreground" data-testid="limit-o4-uncertain-months">
            {t("limit.o4UncertainMonths", {
              months: uncertainMonths.map(o4MonthLabel).join(", "),
            })}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground tabular-nums">
          {t("limit.multipleMinijobsSum", { amount: formatEuro(usage.earnings) })}
        </p>
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
      {/* 0 means "no single hours basis" (different rates, no entries), not a real 0 h limit.
          LimitUsage has no entry or rate count, so the two cases are not told apart here. */}
      {auto && !(usage.hoursLimit > 0) ? (
        <Bar
          titleId={titleId}
          label={t("limit.hours")}
          share={0}
          main={formatHours(usage.hours)}
          hint={t("limit.hoursNoBasis")}
          noLimit
        />
      ) : (
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
      )}

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
  noLimit = false,
}: {
  /** ID des sichtbaren Kartentitels – Teil des Accessible Name des Balkens. */
  titleId: string;
  label: string;
  share: number;
  main: string;
  hint: string;
  /** No limit to compare with: show the value and the hint only, no percentage and no bar. */
  noLimit?: boolean;
}) {
  const labelId = useId();
  const clamped = Math.min(100, Math.round(share));
  if (noLimit) {
    return (
      <div className="mt-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">{label}</span>
          <span className="tabular-nums font-semibold text-foreground">{main}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>
    );
  }
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
