import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { formatEuro } from "@/lib/minijob/calc";
import { evaluateRollingWarning } from "@/lib/minijob/legal";
import type { Rolling12ForecastResult } from "@/lib/minijob/legal/rolling";
import { hasMonthAboveDoubleReference, isAboveRollingFrame } from "@/lib/minijob/legal/warnings";
import { useT } from "@/lib/i18n";

interface RollingEarningsCardProps {
  rolling: Rolling12ForecastResult;
}

/**
 * "Verdienste der letzten 12 Monate": an INFORMATIONAL rolling earnings indicator.
 *
 * It adds up recorded earnings of the 12 calendar months ending at the displayed month and
 * shows shifts entered with a future date separately; the sum is compared with the sum of
 * those months' monthly limits (the "Orientierungsrahmen"). It is not the statutory,
 * forward-looking assessment of the regular earnings over the employment period (§ 8 SGB IV):
 * above the range is no legal finding, and within it is no proof that the employment remains
 * a Minijob. Calendar-year statistics live on the limit cards and are never mixed in here.
 */
export function RollingEarningsCard({ rolling }: RollingEarningsCardProps) {
  const { t } = useT();
  const actual = rolling.months.reduce((sum, month) => sum + month.actual, 0);
  const planned = rolling.months.reduce((sum, month) => sum + month.expectedAdditional, 0);
  const assessment = evaluateRollingWarning(rolling);
  const above = isAboveRollingFrame(assessment.status);
  const signal = hasMonthAboveDoubleReference(rolling);

  const statusText = above
    ? t("rolling.statusAbove")
    : assessment.status === "NEAR_LIMIT"
      ? t("rolling.statusNear", { percent: Math.round(assessment.ratio * 100) })
      : t("rolling.statusWithin");

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-card" aria-label={t("rolling.title")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("rolling.title")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t("rolling.subtitle")}</p>
        </div>
        {above || signal ? (
          <AlertTriangle className="size-5 shrink-0 text-amber-600" aria-hidden />
        ) : (
          <CheckCircle2 className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Metric label={t("rolling.actual")} value={formatEuro(actual)} testId="rolling-actual" />
        <Metric label={t("rolling.planned")} value={formatEuro(planned)} testId="rolling-planned" />
        <Metric
          label={t("rolling.total")}
          value={formatEuro(rolling.projectedEarnings)}
          testId="rolling-total"
        />
        <Metric
          label={t("rolling.frame")}
          value={formatEuro(rolling.regularLimit)}
          testId="rolling-frame"
        />
      </div>

      <div className="mt-4 rounded-xl border bg-muted/30 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("rolling.statusLabel")}
        </p>
        <p className="mt-1 text-sm font-medium">{statusText}</p>
        {above ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("rolling.aboveHint")}
          </p>
        ) : null}
        {signal ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("rolling.signal")}
          </p>
        ) : null}
        {planned > 0 ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("rolling.plannedNote")}
          </p>
        ) : null}
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {t("rolling.disclaimer")}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("rolling.windowNote")}
        </p>
      </div>
    </section>
  );
}

function Metric({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-xl border p-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 tabular-nums font-semibold" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}
