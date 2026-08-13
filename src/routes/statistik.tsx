import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList, Clock, Euro, FileDown, FileSpreadsheet, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { AnnualReportCard } from "@/components/minijob/AnnualReportCard";
import { StatCard } from "@/components/minijob/StatCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/lib/i18n";
import {
  formatEuro,
  formatHours,
  monthNames,
  monthNamesShort,
  shiftEarnings,
  shiftHours,
  shiftsInMonth,
  shiftsInYear,
  sumEarnings,
  sumHours,
} from "@/lib/minijob/calc";
import { buildAnnualReport } from "@/lib/minijob/annual";
import { exportPdf, exportXlsx } from "@/lib/minijob/export";
import { exportWorkReportPdf } from "@/lib/minijob/worklog";
import { makeResolver } from "@/lib/minijob/resolve";
import { yearlyLimitOf } from "@/lib/minijob/limits";
import { useAppData } from "@/lib/minijob/store";
import type { Shift } from "@/lib/minijob/types";

export const Route = createFileRoute("/statistik")({
  head: () => ({
    meta: [
      { title: "Statistik – MiniJob Tracker" },
      {
        name: "description",
        content:
          "Tages-, Monats- und Jahresstatistiken zu Arbeitsstunden und Verdienst je Job, inklusive Diagrammen und Export als Excel oder PDF.",
      },
      { property: "og:title", content: "Statistik – MiniJob Tracker" },
      {
        property: "og:description",
        content: "Diagramme zu Stunden und Verdienst, Export als XLSX und PDF.",
      },
    ],
  }),
  component: StatsPage,
});

function StatsPage() {
  const { t } = useT();
  const { shifts, jobs, settings } = useAppData();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [jobFilter, setJobFilter] = useState<string>("alle");

  const months = monthNames();
  const monthsShort = monthNamesShort();

  const resolve = useMemo(() => makeResolver(jobs, settings), [jobs, settings]);
  const filtered = useMemo(
    () => (jobFilter === "alle" ? shifts : shifts.filter((s) => s.jobId === jobFilter)),
    [shifts, jobFilter],
  );

  const yearShifts = useMemo(() => shiftsInYear(filtered, year), [filtered, year]);
  const monthShifts = useMemo(() => shiftsInMonth(filtered, year, month), [filtered, year, month]);

  const monthlyData = useMemo(
    () =>
      monthsShort.map((label, idx) => {
        const list = shiftsInMonth(filtered, year, idx);
        return {
          monat: label,
          stunden: Number(sumHours(list).toFixed(2)),
          verdienst: Number(sumEarnings(list, resolve).toFixed(2)),
        };
      }),
    [filtered, year, resolve, monthsShort],
  );

  const dailyData = useMemo(
    () =>
      [...monthShifts]
        .sort((a, b) => (a.date > b.date ? 1 : -1))
        .map((s) => ({
          tag: s.date.slice(8),
          verdienst: Number(shiftEarnings(s, resolve(s)).toFixed(2)),
          stunden: Number(shiftHours(s).toFixed(2)),
        })),
    [monthShifts, resolve],
  );

  const perJob = useMemo(
    () =>
      jobs.map((job) => {
        const list = shiftsInYear(
          shifts.filter((s) => s.jobId === job.id),
          year,
        );
        return {
          job,
          hours: sumHours(list),
          earnings: sumEarnings(list, resolve),
        };
      }),
    [jobs, shifts, year, resolve],
  );

  const annualReport = useMemo(
    () => buildAnnualReport(filtered, jobs, settings, year, resolve),
    [filtered, jobs, settings, year, resolve],
  );

  const ctx = { jobs, bundesland: settings.bundesland };

  function doExport(kind: "xlsx" | "pdf", list: Shift[], title: string) {
    if (list.length === 0) {
      toast.error(t("stats.toast.noData"));
      return;
    }
    if (kind === "xlsx") exportXlsx(list, title, ctx);
    else exportPdf(list, title, ctx);
    toast.success(t("stats.toast.exportSuccess"));
  }

  const monthEarnings = sumEarnings(monthShifts, resolve);
  const yearEarnings = sumEarnings(yearShifts, resolve);
  const monthHours = sumHours(monthShifts);
  const yearHours = sumHours(yearShifts);

  return (
    <main className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-extrabold tracking-tight">{t("stats.title")}</h1>

      <div className="mt-3 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setYear(year - 1)}>
          {year - 1}
        </Button>
        <span className="flex-1 text-center text-lg font-semibold">{year}</span>
        <Button variant="outline" size="sm" onClick={() => setYear(year + 1)}>
          {year + 1}
        </Button>
      </div>

      {jobs.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setJobFilter("alle")}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              jobFilter === "alle" ? "border-primary bg-primary/10" : "bg-card"
            }`}
          >
            {t("stats.allJobs")}
          </button>
          {jobs.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => setJobFilter(j.id)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                jobFilter === j.id ? "border-primary bg-primary/10" : "bg-card"
              }`}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: j.color }} />
              {j.name}
            </button>
          ))}
        </div>
      ) : null}

      <Tabs defaultValue="monat" className="mt-5">
        <TabsList className="w-full">
          <TabsTrigger value="monat" className="flex-1">
            {t("stats.tab.month")}
          </TabsTrigger>
          <TabsTrigger value="jahr" className="flex-1">
            {t("stats.tab.year")}
          </TabsTrigger>
          <TabsTrigger value="jobs" className="flex-1">
            {t("stats.tab.jobs")}
          </TabsTrigger>
          <TabsTrigger value="bericht" className="flex-1">
            {t("stats.tab.report")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="monat" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-1">
            {monthsShort.map((label, idx) => (
              <button
                key={label}
                type="button"
                onClick={() => setMonth(idx)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  idx === month ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label={t("stats.card.earnings")}
              value={formatEuro(monthEarnings)}
              hint={`${months[month]} ${year}`}
              icon={Euro}
              highlight
            />
            <StatCard
              label={t("stats.card.hoursLabel")}
              value={formatHours(monthHours)}
              hint={t("stats.card.hoursHint")}
              icon={Clock}
            />
          </div>

          <ChartCard title={t("stats.chart.earningsDay")}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="tag" fontSize={11} />
                <YAxis fontSize={11} width={38} />
                <Tooltip formatter={(v: number) => formatEuro(v)} />
                <Bar dataKey="verdienst" radius={[6, 6, 0, 0]} fill="var(--primary)" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={t("stats.chart.hoursDay")}>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="tag" fontSize={11} />
                <YAxis fontSize={11} width={38} />
                <Tooltip formatter={(v: number) => formatHours(v)} />
                <Line type="monotone" dataKey="stunden" stroke="var(--primary)" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              onClick={() =>
                doExport(
                  "xlsx",
                  monthShifts,
                  t("report.monthTitle", { month: months[month]!, year }),
                )
              }
            >
              <FileSpreadsheet className="size-4" /> Excel
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                doExport(
                  "pdf",
                  monthShifts,
                  t("report.monthTitle", { month: months[month]!, year }),
                )
              }
            >
              <FileDown className="size-4" /> PDF
            </Button>
          </div>

          <Button
            className="w-full"
            onClick={() => {
              if (monthShifts.length === 0) {
                toast.error(t("stats.toast.noData"));
                return;
              }
              exportWorkReportPdf(monthShifts, {
                jobs,
                month: `${months[month]!} ${year}`,
                includePhotos: true,
              });
              toast.success(t("stats.toast.exportSuccess"));
            }}
          >
            <ClipboardList className="size-4" /> {t("worklog.export")}
          </Button>
        </TabsContent>

        <TabsContent value="jahr" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label={t("stats.card.yearEarnings")}
              value={formatEuro(yearEarnings)}
              hint={String(year)}
              icon={Euro}
              highlight
            />
            <StatCard
              label={t("stats.card.yearHours")}
              value={formatHours(yearHours)}
              hint={t("stats.entriesHint", { count: yearShifts.length })}
              icon={Clock}
            />
            <StatCard
              label={t("stats.card.avgRate")}
              value={formatEuro(yearHours > 0 ? yearEarnings / yearHours : 0)}
              hint={t("stats.card.avgRateHint")}
              icon={TrendingUp}
            />
            <StatCard
              label={t("stats.card.yearLimit")}
              value={`${Math.round(
                yearlyLimitOf(settings) > 0 ? (yearEarnings / yearlyLimitOf(settings)) * 100 : 0,
              )} %`}
              hint={t("stats.card.yearLimitHint", { amount: formatEuro(yearlyLimitOf(settings)) })}
              icon={Euro}
            />
          </div>

          <ChartCard title={t("stats.chart.earningsMonth")}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="monat" fontSize={11} />
                <YAxis fontSize={11} width={38} />
                <Tooltip formatter={(v: number) => formatEuro(v)} />
                <Bar dataKey="verdienst" radius={[6, 6, 0, 0]}>
                  {monthlyData.map((entry, idx) => (
                    <Cell
                      key={entry.monat}
                      fill={idx === month ? "var(--primary)" : "var(--primary-glow)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={t("stats.chart.hoursMonth")}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="monat" fontSize={11} />
                <YAxis fontSize={11} width={38} />
                <Tooltip formatter={(v: number) => formatHours(v)} />
                <Line type="monotone" dataKey="stunden" stroke="var(--primary)" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid grid-cols-2 gap-3 pb-4">
            <Button
              variant="outline"
              onClick={() => doExport("xlsx", yearShifts, t("report.yearTitle", { year }))}
            >
              <FileSpreadsheet className="size-4" /> Excel
            </Button>
            <Button
              variant="outline"
              onClick={() => doExport("pdf", yearShifts, t("report.yearTitle", { year }))}
            >
              <FileDown className="size-4" /> PDF
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="jobs" className="mt-4 space-y-3 pb-4">
          {perJob.length === 0 ? (
            <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("stats.noJobs")}
            </p>
          ) : (
            perJob.map(({ job, hours, earnings }) => (
              <div
                key={job.id}
                className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-card"
              >
                <span
                  className="size-9 rounded-xl"
                  style={{ backgroundColor: job.color }}
                  aria-hidden
                />
                <div className="flex-1">
                  <p className="font-semibold">{job.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("stats.jobHoursYear", { hours: formatHours(hours), year })}
                  </p>
                </div>
                <p className="font-semibold tabular-nums">{formatEuro(earnings)}</p>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="bericht" className="mt-4">
          <AnnualReportCard report={annualReport} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}
