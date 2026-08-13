import { Award, CalendarCheck, Sparkles, TrendingUp } from "lucide-react";

import { MONTHS_DE, formatEuro, formatHours } from "@/lib/minijob/calc";
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
  const items = [
    {
      icon: TrendingUp,
      label: "Verdienst & Stunden",
      value: `${formatEuro(insights.monthEarnings)} · ${formatHours(insights.monthHours)}`,
    },
    {
      icon: Sparkles,
      label: "Ø Stundenverdienst",
      value: formatEuro(insights.avgRate),
    },
    {
      icon: CalendarCheck,
      label: "Bester Tag",
      value: insights.bestDay
        ? `${insights.bestDay.label} · ${formatEuro(insights.bestDay.earnings)}`
        : "Noch keine Daten",
    },
    {
      icon: Award,
      label: `Bester Monat ${year}`,
      value: insights.bestMonth
        ? `${insights.bestMonth.label} · ${formatEuro(insights.bestMonth.earnings)}`
        : "Noch keine Daten",
    },
  ];

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-card" aria-label="Monatsauswertung">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Auswertung {MONTHS_DE[month]}</h2>
        <span className="text-xs text-muted-foreground">
          {insights.entries} {insights.entries === 1 ? "Eintrag" : "Einträge"}
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
