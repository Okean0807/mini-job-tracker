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
  shiftsInMonth,
  shiftsInYear,
} from "@/lib/minijob/calc";
import {
  buildDailyMonthSeries,
  buildFestDailyMonthSeries,
  dailyChartTitle,
  dailyXAxisTicks,
  formatDailyTooltipLine,
} from "@/lib/minijob/stats-charts";
import { primaryWorkMode } from "@/lib/minijob/work-mode";
import { payrollTotals } from "@/lib/minijob/payroll";
import { buildAnnualReport } from "@/lib/minijob/annual";
import { exportPdf, exportXlsx } from "@/lib/minijob/export";
import { exportArbeitsnachweisPdf } from "@/lib/minijob/arbeitsnachweis";
import { exportWorkReportPdf } from "@/lib/minijob/worklog";
import { DOCUMENT_LOCALE, td } from "@/lib/minijob/document-i18n";
import { makeResolver } from "@/lib/minijob/resolve";
import { yearUsage } from "@/lib/minijob/limits";
import { payPeriods } from "@/lib/minijob/payday";
import { canUse } from "@/lib/minijob/premium";
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
  const { shifts, jobs, payments, settings } = useAppData();
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
        const totals = payrollTotals(list, resolve, shifts);
        return {
          monat: label,
          stunden: Number(totals.workedHours.toFixed(2)),
          verdienst: Number(totals.earnings.toFixed(2)),
        };
      }),
    [filtered, shifts, year, resolve, monthsShort],
  );

  const workMode = primaryWorkMode(jobs, settings.activeJobId);
  const festJob =
    (jobFilter !== "alle" ? jobs.find((j) => j.id === jobFilter) : undefined) ??
    jobs.find((j) => j.id === settings.activeJobId && j.mode === "fest") ??
    jobs.find((j) => j.mode === "fest");
  const isFestView = workMode === "fest" && festJob?.mode === "fest";

  const dailyData = useMemo(
    () => buildDailyMonthSeries(year, month, monthShifts, resolve),
    [year, month, monthShifts, resolve],
  );
  const festDailyData = useMemo(() => {
    if (!festJob || festJob.mode !== "fest") return [];
    return buildFestDailyMonthSeries(year, month, festJob, filtered, settings.bundesland);
  }, [year, month, festJob, filtered, settings.bundesland]);
  const dailyTicks = useMemo(() => dailyXAxisTicks(dailyData.length), [dailyData.length]);
  const festTicks = useMemo(() => dailyXAxisTicks(festDailyData.length), [festDailyData.length]);
  const earningsDayTitle = dailyChartTitle(
    t("stats.chart.earningsDay"),
    months[month] ?? "",
    year,
  );
  const hoursDayTitle = dailyChartTitle(t("stats.chart.hoursDay"), months[month] ?? "", year);

  const perJob = useMemo(
    () =>
      jobs.map((job) => {
        const list = shiftsInYear(
          shifts.filter((s) => s.jobId === job.id),
          year,
        );
        const totals = payrollTotals(list, resolve, shifts);
        return {
          job,
          hours: totals.workedHours,
          earnings: totals.earnings,
        };
      }),
    [jobs, shifts, year, resolve],
  );

  const annualReport = useMemo(
    () => buildAnnualReport(filtered, jobs, settings, year, resolve),
    [filtered, jobs, settings, year, resolve],
  );

  const legalYearUsage = useMemo(
    () => yearUsage(filtered, resolve, settings, year),
    [filtered, resolve, settings, year],
  );

  const ctx = {
    jobs,
    bundesland: settings.bundesland,
    defaultRate: settings.defaultRate,
    supplements: settings.supplements,
  };

  function doExport(kind: "xlsx" | "pdf", list: Shift[], title: string) {
    if (list.length === 0) {
      toast.error(t("stats.toast.noData"));
      return;
    }
    if (kind === "xlsx" && !canUse(settings, "excel")) {
      toast.error(t("premium.title"), { description: t("premium.excel") });
      return;
    }
    if (kind === "xlsx") exportXlsx(list, title, ctx);
    else exportPdf(list, title, ctx);
    toast.success(t("stats.toast.exportSuccess"));
  }

  const selectedJobs = useMemo(
    () => (jobFilter === "alle" ? jobs : jobs.filter((j) => j.id === jobFilter)),
    [jobs, jobFilter],
  );
  const monthPayPeriods = useMemo(
    () => payPeriods(selectedJobs, filtered, payments, resolve, year, month),
    [selectedJobs, filtered, payments, resolve, year, month],
  );
  const monthPaymentTotals = useMemo(
    () =>
      monthPayPeriods.reduce(
        (acc, p) => ({
          expected: acc.expected + p.expected,
          earned: acc.earned + p.earned,
          paid: acc.paid + p.paid,
          open: acc.open + p.outstanding,
          overpaid: acc.overpaid + p.overpaid,
          overdue: acc.overdue + (p.overdue ? 1 : 0),
        }),
        { expected: 0, earned: 0, paid: 0, open: 0, overpaid: 0, overdue: 0 },
      ),
    [monthPayPeriods],
  );
  const yearPaymentTotals = useMemo(() => {
    const initial = { expected: 0, earned: 0, paid: 0, open: 0, overpaid: 0, overdue: 0 };
    for (let m = 0; m < 12; m += 1) {
      const periods = payPeriods(selectedJobs, filtered, payments, resolve, year, m);
      for (const p of periods) {
        initial.expected += p.expected;
        initial.earned += p.earned;
        initial.paid += p.paid;
        initial.open += p.outstanding;
        initial.overpaid += p.overpaid;
        if (p.overdue) initial.overdue += 1;
      }
    }
    return initial;
  }, [selectedJobs, filtered, payments, resolve, year]);

  const monthTotals = payrollTotals(monthShifts, resolve, shifts);
  const yearTotals = payrollTotals(yearShifts, resolve, shifts);
  const monthEarnings = monthTotals.earnings;
  const yearEarnings = yearTotals.earnings;
  const monthHours = monthTotals.workedHours;
  const yearHours = yearTotals.workedHours;

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

          <div className="rounded-2xl border bg-card p-4 shadow-card">
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("stats.paymentSummary")}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label={t("stats.payment.expected")} value={formatEuro(monthPaymentTotals.expected)} hint={t("stats.payment.monthBasis")} icon={Euro} />
              <StatCard label={t("stats.payment.earned")} value={formatEuro(monthPaymentTotals.earned)} hint={t("stats.payment.monthBasis")} icon={Euro} />
              <StatCard label={t("stats.payment.paid")} value={formatEuro(monthPaymentTotals.paid)} hint={t("stats.payment.monthBasis")} icon={Euro} />
              <StatCard label={t("stats.payment.open")} value={formatEuro(monthPaymentTotals.open)} hint={monthPaymentTotals.overdue > 0 ? t("stats.payment.overdueCount", { count: monthPaymentTotals.overdue }) : t("stats.payment.noOverdue")} icon={Euro} />
            </div>
            {monthPaymentTotals.overpaid > 0.005 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {t("stats.payment.overpaid")}: <span className="font-medium tabular-nums">{formatEuro(monthPaymentTotals.overpaid)}</span>
              </p>
            ) : null}
          </div>

          <ChartCard title={earningsDayTitle}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis
                  dataKey="day"
                  ticks={dailyTicks}
                  fontSize={11}
                  label={{ value: t("stats.axis.day"), position: "insideBottom", offset: -2 }}
                  height={36}
                />
                <YAxis
                  fontSize={11}
                  width={42}
                  label={{
                    value: t("stats.axis.earnings"),
                    angle: -90,
                    position: "insideLeft",
                    offset: 8,
                  }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as {
                      date: string;
                      stunden: number;
                      verdienst: number;
                    };
                    return (
                      <div className="rounded-md border bg-card px-2.5 py-1.5 text-xs shadow-md">
                        {formatDailyTooltipLine(row.date, row.stunden, row.verdienst)}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="verdienst" radius={[6, 6, 0, 0]} fill="var(--primary)" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={hoursDayTitle}>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis
                  dataKey="day"
                  ticks={dailyTicks}
                  fontSize={11}
                  label={{ value: t("stats.axis.day"), position: "insideBottom", offset: -2 }}
                  height={36}
                />
                <YAxis
                  fontSize={11}
                  width={42}
                  label={{
                    value: t("stats.axis.hours"),
                    angle: -90,
                    position: "insideLeft",
                    offset: 8,
                  }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as {
                      date: string;
                      stunden: number;
                      verdienst: number;
                    };
                    return (
                      <div className="rounded-md border bg-card px-2.5 py-1.5 text-xs shadow-md">
                        {formatDailyTooltipLine(row.date, row.stunden, row.verdienst)}
                      </div>
                    );
                  }}
                />
                <Line type="monotone" dataKey="stunden" stroke="var(--primary)" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {isFestView && festDailyData.length > 0 ? (
            <ChartCard title={dailyChartTitle(t("stats.chart.sollIst"), months[month] ?? "", year)}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={festDailyData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis
                    dataKey="day"
                    ticks={festTicks}
                    fontSize={11}
                    label={{ value: t("stats.axis.day"), position: "insideBottom", offset: -2 }}
                    height={36}
                  />
                  <YAxis
                    fontSize={11}
                    width={42}
                    label={{
                      value: t("stats.axis.hours"),
                      angle: -90,
                      position: "insideLeft",
                      offset: 8,
                    }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as {
                        date: string;
                        soll?: number;
                        ist?: number;
                        diff?: number;
                      };
                      return (
                        <div className="rounded-md border bg-card px-2.5 py-1.5 text-xs shadow-md">
                          {row.date}: Soll {row.soll ?? 0} / Ist {row.ist ?? 0} / Diff{" "}
                          {row.diff ?? 0}
                        </div>
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="soll"
                    stroke="var(--muted-foreground)"
                    strokeWidth={2}
                  />
                  <Line type="monotone" dataKey="ist" stroke="var(--primary)" strokeWidth={2} />
                  <Line
                    type="monotone"
                    dataKey="diff"
                    stroke="var(--chart-3, #ea580c)"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              onClick={() =>
                doExport(
                  "xlsx",
                  monthShifts,
                  td("report.monthTitle", { month: monthNames(DOCUMENT_LOCALE)[month]!, year }),
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
                  td("report.monthTitle", { month: monthNames(DOCUMENT_LOCALE)[month]!, year }),
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
                month: `${monthNames(DOCUMENT_LOCALE)[month]!} ${year}`,
                includePhotos: true,
              });
              toast.success(t("stats.toast.exportSuccess"));
            }}
          >
            <ClipboardList className="size-4" /> {t("worklog.export")}
          </Button>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              if (monthShifts.length === 0) {
                toast.error(t("stats.toast.noData"));
                return;
              }
              exportArbeitsnachweisPdf(monthShifts, {
                jobs,
                month,
                year,
                employeeName: settings.employeeName ?? "",
                customCodes: settings.workCodes ?? [],
                ...(jobs.length === 1 && jobs[0]
                  ? { employer: jobs[0].employer ?? jobs[0].name }
                  : {}),
              });
              toast.success(t("stats.toast.exportSuccess"));
            }}
          >
            <FileDown className="size-4" /> {t("worklog.exportProof")}
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
                legalYearUsage.earningsShare,
              )} %`}
              hint={t("stats.card.yearLimitHint", { amount: formatEuro(legalYearUsage.earningsLimit) })}
              icon={Euro}
            />
          </div>

          <div className="rounded-2xl border bg-card p-4 shadow-card">
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("stats.paymentSummaryYear")}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label={t("stats.payment.expected")} value={formatEuro(yearPaymentTotals.expected)} hint={String(year)} icon={Euro} />
              <StatCard label={t("stats.payment.earned")} value={formatEuro(yearPaymentTotals.earned)} hint={String(year)} icon={Euro} />
              <StatCard label={t("stats.payment.paid")} value={formatEuro(yearPaymentTotals.paid)} hint={String(year)} icon={Euro} />
              <StatCard label={t("stats.payment.open")} value={formatEuro(yearPaymentTotals.open)} hint={yearPaymentTotals.overdue > 0 ? t("stats.payment.overdueCount", { count: yearPaymentTotals.overdue }) : t("stats.payment.noOverdue")} icon={Euro} />
            </div>
            {yearPaymentTotals.overpaid > 0.005 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {t("stats.payment.overpaid")}: <span className="font-medium tabular-nums">{formatEuro(yearPaymentTotals.overpaid)}</span>
              </p>
            ) : null}
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
              onClick={() => doExport("xlsx", yearShifts, td("report.yearTitle", { year }))}
            >
              <FileSpreadsheet className="size-4" /> Excel
            </Button>
            <Button
              variant="outline"
              onClick={() => doExport("pdf", yearShifts, td("report.yearTitle", { year }))}
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
