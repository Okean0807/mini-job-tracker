import { Award, CalendarCheck, Sparkles, TrendingUp } from "lucide-react";

import { useT } from "@/lib/i18n";
import { formatEuro, formatHours, monthNames } from "@/lib/minijob/calc";
import type { Insights } from "@/lib/minijob/insights";

export function InsightsCard({
  insights,
  month,
  year,
}: {
  insights: Insights;
  month: number;
  year: number;
}) {
  const { t } = useT();
  const monthLabel = monthNames()[month] ?? "";

  const items = [
    {
      icon: TrendingUp,
      label: t("insights.earningsHours"),
      value: `${formatEuro(insights.monthEarnings)} · ${formatHours(insights.monthHours)}`,
    },
    {
      icon: Sparkles,
      label: t("insights.avgHourly"),
      value: formatEuro(insights.avgRate),
    },
    {
      icon: CalendarCheck,
      label: t("insights.bestDay"),
      value: insights.bestDay
        ? `${insights.bestDay.label} · ${formatEuro(insights.bestDay.earnings)}`
        : t("insights.noData"),
    },
    {
      icon: Award,
      label: t("insights.bestMonth", { year }),
      value: insights.bestMonth
        ? `${insights.bestMonth.label} · ${formatEuro(insights.bestMonth.earnings)}`
        : t("insights.noData"),
    },
  ];

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-card" aria-label={t("insights.title", { month: monthLabel })}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("insights.title", { month: monthLabel })}</h2>
        <span className="text-xs text-muted-foreground">
          {t("insights.entries", { count: insights.entries })}
        </span>
      </div>
      <ul className="mt-3 space-y-2.5">
        {items.map(({ icon: Icon, label, value }) => (
          <li key={label} className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="size-4" />
            </span>
            <span className="flex-1 text-xs text-muted-foreground">{label}</span>
            <span className="text-sm font-semibold tabular-nums">{value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
