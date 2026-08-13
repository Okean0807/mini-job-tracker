import { Award, CalendarDays, Clock, Euro, FileDown, FileSpreadsheet, Sparkles, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { StatCard } from "@/components/minijob/StatCard";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import type { AnnualReport } from "@/lib/minijob/annual";
import { exportAnnualPdf, exportAnnualXlsx } from "@/lib/minijob/annual-export";
import { formatDate, formatEuro, formatHours, weekdayNames } from "@/lib/minijob/calc";

export function AnnualReportCard({ report }: { report: AnnualReport }) {
  const { t } = useT();
  const hasData = report.entries > 0;

  const monthData = report.months.map((m) => ({
    label: m.label.slice(0, 3),
    verdienst: Number(m.earnings.toFixed(2)),
    stunden: Number(m.hours.toFixed(2)),
  }));
  const maxEarnings = Math.max(...monthData.map((m) => m.verdienst), 0);
  const weekdayData = weekdayNames(undefined, "short").map((label, i) => ({
    label,
    stunden: Number((report.weekdayHours[i] ?? 0).toFixed(2)),
  }));
  const maxWeekday = Math.max(...weekdayData.map((d) => d.stunden), 0);

  function run(kind: "pdf" | "xlsx") {
    if (!hasData) {
      toast.error(t("stats.toast.noData"));
      return;
    }
    if (kind === "pdf") exportAnnualPdf(report);
    else exportAnnualXlsx(report);
    toast.success(t("stats.toast.exportSuccess"));
  }

  if (!hasData) {
    return (
      <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        {t("annual.empty", { year: report.year })}
      </p>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      <p className="text-xs text-muted-foreground">
        {t("annual.subtitle", { entries: report.entries, months: report.activeMonths })}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label={t("annual.kpi.earnings")}
          value={formatEuro(report.earnings)}
          hint={t("annual.bonusShare", { share: report.bonusShare.toFixed(0) })}
          icon={Euro}
          highlight
        />
        <StatCard
          label={t("annual.kpi.hours")}
          value={formatHours(report.hours)}
          hint={t("annual.kpi.avgDay") + ": " + formatHours(report.avgDayHours)}
          icon={Clock}
        />
        <StatCard
          label={t("annual.kpi.avgRate")}
          value={formatEuro(report.avgRate)}
          hint={t("annual.kpi.avgMonth") + ": " + formatEuro(report.avgMonthEarnings)}
          icon={TrendingUp}
        />
        <StatCard
          label={t("annual.kpi.workDays")}
          value={String(report.workDays)}
          hint={
            report.limit > 0
              ? `${t("annual.kpi.limit")}: ${Math.round(report.limitShare)} %`
              : t("annual.kpi.bonus") + ": " + formatEuro(report.bonus)
          }
          icon={CalendarDays}
        />
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-card">
        <h2 className="mb-3 text-sm font-semibold">{t("annual.chart.earnings")}</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="label" fontSize={11} />
            <YAxis fontSize={11} width={38} />
            <Tooltip formatter={(v: number) => formatEuro(v)} />
            <Bar dataKey="verdienst" radius={[6, 6, 0, 0]}>
              {monthData.map((entry) => (
                <Cell
                  key={entry.label}
                  fill={
                    entry.verdienst === maxEarnings && maxEarnings > 0
                      ? "var(--primary)"
                      : "var(--primary-glow)"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-card">
        <h2 className="mb-3 text-sm font-semibold">{t("annual.chart.weekdays")}</h2>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={weekdayData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="label" fontSize={11} />
            <YAxis fontSize={11} width={38} />
            <Tooltip formatter={(v: number) => formatHours(v)} />
            <Bar dataKey="stunden" radius={[6, 6, 0, 0]}>
              {weekdayData.map((entry) => (
                <Cell
                  key={entry.label}
                  fill={
                    entry.stunden === maxWeekday && maxWeekday > 0
                      ? "var(--primary)"
                      : "var(--primary-glow)"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {report.jobs.length > 0 ? (
        <div className="rounded-2xl border bg-card p-4 shadow-card">
          <h2 className="mb-3 text-sm font-semibold">{t("annual.chart.jobs")}</h2>
          <ul className="space-y-3">
            {report.jobs.map((j) => (
              <li key={j.id}>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className="size-2 rounded-full" style={{ backgroundColor: j.color }} />
                    {j.name}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatHours(j.hours)} · {formatEuro(j.earnings)}
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${Math.max(2, j.share)}%`, backgroundColor: j.color }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-2xl border bg-card p-4 shadow-card">
        <h2 className="mb-3 text-sm font-semibold">{t("annual.best.title")}</h2>
        <ul className="space-y-2.5">
          <li className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Award className="size-4" />
            </span>
            <span className="flex-1 text-xs text-muted-foreground">{t("annual.best.month")}</span>
            <span className="text-sm font-semibold tabular-nums">
              {report.bestMonth
                ? `${report.bestMonth.label} · ${formatEuro(report.bestMonth.earnings)}`
                : "–"}
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </span>
            <span className="flex-1 text-xs text-muted-foreground">{t("annual.best.day")}</span>
            <span className="text-sm font-semibold tabular-nums">
              {report.bestDay
                ? `${formatDate(report.bestDay.date)} · ${formatEuro(report.bestDay.earnings)}`
                : "–"}
            </span>
          </li>
        </ul>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={() => run("xlsx")}>
          <FileSpreadsheet className="size-4" /> Excel
        </Button>
        <Button variant="outline" onClick={() => run("pdf")}>
          <FileDown className="size-4" /> PDF
        </Button>
      </div>
    </div>
  );
}
