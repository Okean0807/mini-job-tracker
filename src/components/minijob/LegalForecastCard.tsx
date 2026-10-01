import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { formatEuro } from "@/lib/minijob/calc";
import { evaluateRollingWarning } from "@/lib/minijob/legal";
import type { Rolling12ForecastResult } from "@/lib/minijob/legal/rolling";
import { useT } from "@/lib/i18n";

interface LegalForecastCardProps {
  forecast: Rolling12ForecastResult;
}

/**
 * Forecast-only legal warning surface.
 * It deliberately distinguishes projected income from actual income and
 * does not classify a forecast exceedance as legally permissible.
 */
export function LegalForecastCard({ forecast }: LegalForecastCardProps) {
  const { t } = useT();
  const projected = forecast.projectedEarnings;
  const regular = forecast.regularLimit;
  const maximum = forecast.maximumAllowedIncome;
  const assessment = evaluateRollingWarning(forecast);
  const critical = assessment.status === "MAXIMUM_EXCEEDED";
  const warning = assessment.status === "REGULAR_LIMIT_EXCEEDED" || assessment.status === "UNPREDICTABLE_EXCEEDANCE_POSSIBLE";

  const statusText = (() => {
    switch (assessment.status) {
      case "MAXIMUM_EXCEEDED":
        return t("legalForecast.statusMaximum");
      case "REGULAR_LIMIT_EXCEEDED":
        return t("legalForecast.statusRegularExceeded");
      case "UNPREDICTABLE_EXCEEDANCE_POSSIBLE":
        return t("legalForecast.statusSpecialPossible");
      case "NEAR_LIMIT":
        return t("legalForecast.statusNear", { percent: Math.round(assessment.ratio * 100) });
      default:
        return t("legalForecast.statusOk");
    }
  })();

  return (
    <section
      className="rounded-2xl border bg-card p-4 shadow-card"
      aria-label={t("legalForecast.title")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("legalForecast.title")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("legalForecast.subtitle")}
          </p>
        </div>
        {critical || warning ? (
          <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden />
        ) : (
          <CheckCircle2 className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Metric label={t("legalForecast.projected")} value={formatEuro(projected)} />
        <Metric label={t("legalForecast.regular")} value={formatEuro(regular)} />
        <Metric label={t("legalForecast.maximum")} value={formatEuro(maximum)} />
        <Metric label={t("legalForecast.specialMonths")} value={String(forecast.unpredictableMonths)} />
      </div>

      <div className="mt-4 rounded-xl border bg-muted/30 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("legalForecast.statusLabel")}
        </p>
        <p className="mt-1 text-sm font-medium">{statusText}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("legalForecast.remainingSpecialMonths", { count: assessment.remainingSpecialMonths })}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {t("legalForecast.disclaimer")}
        </p>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 tabular-nums font-semibold">{value}</p>
    </div>
  );
}
