import { createFileRoute } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Euro,
  FileDown,
  FileSpreadsheet,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/lib/i18n";
import { buildAnnualReport } from "@/lib/minijob/annual";
import { exportAnnualPdf, exportAnnualXlsx } from "@/lib/minijob/annual-export";
import { exportArbeitsnachweisPdf } from "@/lib/minijob/arbeitsnachweis";
import {
  formatDate,
  formatEuro,
  formatHours,
  monthNames,
  monthNamesShort,
  shiftsInMonth,
  shiftsInYear,
} from "@/lib/minijob/calc";
import { DOCUMENT_LOCALE, td } from "@/lib/minijob/document-i18n";
import { exportPdf, exportXlsx } from "@/lib/minijob/export";
import { monthTimeAccount } from "@/lib/minijob/fest-time-account";
import { payPeriods } from "@/lib/minijob/payday";
import { payrollTotals } from "@/lib/minijob/payroll";
import { canUse } from "@/lib/minijob/premium";
import { makeResolver } from "@/lib/minijob/resolve";
import { avgHourlyRate } from "@/lib/minijob/stats-avg-rate";
import {
  buildDailyMonthSeries,
  buildFestDailyMonthSeries,
  dailyXAxisTicks,
  formatDailyTooltipLine,
} from "@/lib/minijob/stats-charts";
import { statsLegalYearUsage } from "@/lib/minijob/stats-legal";
import { useAppData } from "@/lib/minijob/store";
import type { Shift } from "@/lib/minijob/types";
import { primaryWorkMode } from "@/lib/minijob/work-mode";
import { exportWorkReportPdf } from "@/lib/minijob/worklog";

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

type PeriodKind = "monat" | "jahr";
type ChartMode = "stunden" | "verdienst";

function StatsPage() {
  const { t } = useT();
  const { shifts, jobs, payments, settings } = useAppData();
  const now = new Date();
  const [period, setPeriod] = useState<PeriodKind>("monat");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [jobFilter, setJobFilter] = useState<string>("alle");
  const [chartMode, setChartMode] = useState<ChartMode>("stunden");

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
          workEarnings: Number(totals.workEarnings.toFixed(2)),
        };
      }),
    [filtered, shifts, year, resolve, monthsShort],
  );

  const festJob =
    (jobFilter !== "alle" ? jobs.find((j) => j.id === jobFilter) : undefined) ??
    jobs.find((j) => j.id === settings.activeJobId && j.mode === "fest") ??
    jobs.find((j) => j.mode === "fest");
  const workMode = primaryWorkMode(jobs, settings.activeJobId);
  const isFestView = workMode === "fest" && festJob?.mode === "fest";

  const dailyData = useMemo(
    () => buildDailyMonthSeries(year, month, monthShifts, resolve, shifts),
    [year, month, monthShifts, resolve, shifts],
  );
  const festDailyData = useMemo(() => {
    if (!festJob || festJob.mode !== "fest") return [];
    return buildFestDailyMonthSeries(year, month, festJob, filtered, settings.bundesland);
  }, [year, month, festJob, filtered, settings.bundesland]);
  const dailyTicks = useMemo(() => dailyXAxisTicks(dailyData.length), [dailyData.length]);

  const festAccount = useMemo(() => {
    if (!festJob || festJob.mode !== "fest") return null;
    return monthTimeAccount(festJob, year, month, filtered, settings.bundesland);
  }, [festJob, year, month, filtered, settings.bundesland]);

  /** Aufteilung: folgt Job-Filter (S4; behebt B9-Verhalten des alten Jobs-Tabs). */
  const breakdown = useMemo(() => {
    const sourceJobs = jobFilter === "alle" ? jobs : jobs.filter((j) => j.id === jobFilter);
    const listSource = period === "monat" ? monthShifts : yearShifts;
    return sourceJobs
      .map((job) => {
        const list = listSource.filter((s) => s.jobId === job.id);
        const totals = payrollTotals(list, resolve, shifts);
        return { job, hours: totals.workedHours, earnings: totals.earnings };
      })
      .filter((row) => row.hours > 0 || row.earnings > 0)
      .sort((a, b) => b.earnings - a.earnings);
  }, [jobs, jobFilter, period, monthShifts, yearShifts, resolve, shifts]);

  const legalYearUsage = useMemo(
    () => statsLegalYearUsage(shifts, resolve, settings, year),
    [shifts, resolve, settings, year],
  );

  const annualReport = useMemo(
    () => buildAnnualReport(filtered, jobs, settings, year, resolve),
    [filtered, jobs, settings, year, resolve],
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

  function doAnnualExport(kind: "pdf" | "xlsx") {
    if (annualReport.entries === 0) {
      toast.error(t("stats.toast.noData"));
      return;
    }
    if (kind === "pdf") exportAnnualPdf(annualReport);
    else exportAnnualXlsx(annualReport);
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
  // S4 B1: Ø = workEarnings / workedHours
  const monthAvgRate = avgHourlyRate(monthTotals.workEarnings, monthTotals.workedHours);
  const yearAvgRate = avgHourlyRate(yearTotals.workEarnings, yearTotals.workedHours);

  const periodLabel = period === "monat" ? `${months[month] ?? ""} ${year}` : String(year);

  function shiftPeriod(delta: number) {
    if (period === "jahr") {
      setYear((y) => y + delta);
      return;
    }
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  function goToday() {
    const n = new Date();
    setYear(n.getFullYear());
    setMonth(n.getMonth());
  }

  const chartData =
    period === "monat"
      ? dailyData.map((p) => ({
          key: p.tag,
          stunden: p.stunden,
          verdienst: p.verdienst,
          date: p.date,
        }))
      : monthlyData.map((p) => ({
          key: p.monat,
          stunden: p.stunden,
          verdienst: p.verdienst,
          date: p.monat,
        }));

  const chartTitle =
    period === "monat"
      ? `${t("stats.chart.perDay")} — ${periodLabel}`
      : `${t("stats.chart.perMonth")} — ${periodLabel}`;

  const maxBreakdown = Math.max(...breakdown.map((b) => b.earnings), 0.01);

  const weekdayData = useMemo(() => {
    const labels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    return labels.map((label, i) => ({
      label,
      stunden: Number((annualReport.weekdayHours[i] ?? 0).toFixed(2)),
    }));
  }, [annualReport.weekdayHours]);

  return (
    <main className="mx-auto max-w-lg px-4 pt-6 pb-8">
      <div className="flex items-start justify-between gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">{t("stats.title")}</h1>
      </div>

      {/* A1: nur Monat | Jahr */}
      <Tabs value={period} onValueChange={(v) => setPeriod(v as PeriodKind)} className="mt-4">
        <TabsList className="w-full" aria-label={t("stats.title")}>
          <TabsTrigger value="monat" className="flex-1">
            {t("stats.tab.month")}
          </TabsTrigger>
          <TabsTrigger value="jahr" className="flex-1">
            {t("stats.tab.year")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Periodennavigation */}
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={t("stats.period.prev")}
          onClick={() => shiftPeriod(-1)}
        >
          <ChevronLeft className="size-5" />
        </Button>
        <div className="flex-1 text-center">
          <p className="text-lg font-semibold">{periodLabel}</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("stats.period.next")}
          onClick={() => shiftPeriod(1)}
        >
          <ChevronRight className="size-5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={goToday}>
          {t("stats.period.today")}
        </Button>
      </div>

      {/* Job-Filter */}
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

      {/* KPI-Zeile */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        {period === "monat" ? (
          <>
            <StatCard
              label={t("stats.card.earnings")}
              value={formatEuro(monthEarnings)}
              hint={periodLabel}
              icon={Euro}
              highlight
            />
            <StatCard
              label={t("stats.card.hoursLabel")}
              value={formatHours(monthHours)}
              hint={t("stats.card.hoursHint")}
              icon={Clock}
            />
            {isFestView && festAccount ? (
              <StatCard
                label={t("stats.kpi.sollIst")}
                value={`${formatHours(festAccount.ist)} / ${formatHours(festAccount.soll)}`}
                hint={t("stats.kpi.sollIstHint", {
                  ist: formatHours(festAccount.ist),
                  soll: formatHours(festAccount.soll),
                })}
                icon={TrendingUp}
              />
            ) : (
              <StatCard
                label={t("stats.card.avgRate")}
                value={formatEuro(monthAvgRate)}
                hint={t("stats.card.avgRateHint")}
                icon={TrendingUp}
              />
            )}
            <StatCard
              label={t("stats.kpi.paidOut")}
              value={formatEuro(monthPaymentTotals.paid)}
              hint={t("stats.kpi.paidOutOf", {
                paid: formatEuro(monthPaymentTotals.paid),
                expected: formatEuro(monthPaymentTotals.expected),
              })}
              icon={Euro}
            />
          </>
        ) : (
          <>
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
              value={formatEuro(yearAvgRate)}
              hint={t("stats.card.avgRateHint")}
              icon={TrendingUp}
            />
            <StatCard
              label={t("stats.card.yearLimit")}
              value={`${Math.round(legalYearUsage.earningsShare)} %`}
              hint={`${t("stats.card.yearLimitHint", {
                amount: formatEuro(legalYearUsage.earningsLimit),
              })} · ${t("stats.kpi.yearLimitAll")}`}
              icon={Euro}
            />
          </>
        )}
      </div>

      {/* Hauptdiagramm */}
      <section className="mt-4 rounded-2xl border bg-card p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{chartTitle}</h2>
          <div className="flex rounded-full border p-0.5 text-xs">
            <button
              type="button"
              className={`rounded-full px-2.5 py-1 ${
                chartMode === "stunden" ? "bg-primary text-primary-foreground" : ""
              }`}
              onClick={() => setChartMode("stunden")}
            >
              {t("stats.chart.mode.hours")}
            </button>
            <button
              type="button"
              className={`rounded-full px-2.5 py-1 ${
                chartMode === "verdienst" ? "bg-primary text-primary-foreground" : ""
              }`}
              onClick={() => setChartMode("verdienst")}
            >
              {t("stats.chart.mode.earnings")}
            </button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis
              dataKey="key"
              fontSize={11}
              {...(period === "monat" ? { ticks: dailyTicks.map(String) } : {})}
            />
            <YAxis fontSize={11} width={38} />
            <Tooltip
              formatter={(v: number) =>
                chartMode === "verdienst" ? formatEuro(v) : formatHours(v)
              }
              labelFormatter={(label, payload) => {
                if (period === "monat") {
                  const date = (payload?.[0]?.payload as { date?: string } | undefined)?.date;
                  if (date) {
                    const row = dailyData.find((d) => d.date === date);
                    if (row) return formatDailyTooltipLine(row.date, row.stunden, row.verdienst);
                  }
                }
                return String(label);
              }}
            />
            <Bar
              dataKey={chartMode === "verdienst" ? "verdienst" : "stunden"}
              radius={[6, 6, 0, 0]}
            >
              {chartData.map((entry, idx) => (
                <Cell
                  key={`${entry.key}-${idx}`}
                  fill={
                    period === "jahr" && idx === month ? "var(--primary)" : "var(--primary-glow)"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Aufteilung */}
      <section className="mt-4 space-y-3">
        <h2 className="text-sm font-semibold">{t("stats.breakdown.title")}</h2>
        {breakdown.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("stats.breakdown.empty")}
          </p>
        ) : (
          breakdown.map(({ job, hours, earnings }) => (
            <div
              key={job.id}
              className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-card"
            >
              <span
                className="size-9 rounded-xl"
                style={{ backgroundColor: job.color }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{job.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatHours(hours)} · {formatEuro(earnings)}
                </p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, (earnings / maxBreakdown) * 100)}%` }}
                  />
                </div>
              </div>
              <p className="font-semibold tabular-nums">{formatEuro(earnings)}</p>
            </div>
          ))
        )}
      </section>

      {/* Details */}
      <Accordion type="multiple" className="mt-4">
        <AccordionItem value="payments">
          <AccordionTrigger>{t("stats.details.payments")}</AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-2 gap-3 pb-2">
              {period === "monat" ? (
                <>
                  <StatCard
                    label={t("stats.payment.expected")}
                    value={formatEuro(monthPaymentTotals.expected)}
                    hint={t("stats.payment.monthBasis")}
                    icon={Euro}
                  />
                  <StatCard
                    label={t("stats.payment.earned")}
                    value={formatEuro(monthPaymentTotals.earned)}
                    hint={t("stats.payment.monthBasis")}
                    icon={Euro}
                  />
                  <StatCard
                    label={t("stats.payment.paid")}
                    value={formatEuro(monthPaymentTotals.paid)}
                    hint={t("stats.payment.monthBasis")}
                    icon={Euro}
                  />
                  <StatCard
                    label={t("stats.payment.open")}
                    value={formatEuro(monthPaymentTotals.open)}
                    hint={
                      monthPaymentTotals.overdue > 0
                        ? t("stats.payment.overdueCount", { count: monthPaymentTotals.overdue })
                        : t("stats.payment.noOverdue")
                    }
                    icon={Euro}
                  />
                </>
              ) : (
                <>
                  <StatCard
                    label={t("stats.payment.expected")}
                    value={formatEuro(yearPaymentTotals.expected)}
                    hint={String(year)}
                    icon={Euro}
                  />
                  <StatCard
                    label={t("stats.payment.earned")}
                    value={formatEuro(yearPaymentTotals.earned)}
                    hint={String(year)}
                    icon={Euro}
                  />
                  <StatCard
                    label={t("stats.payment.paid")}
                    value={formatEuro(yearPaymentTotals.paid)}
                    hint={String(year)}
                    icon={Euro}
                  />
                  <StatCard
                    label={t("stats.payment.open")}
                    value={formatEuro(yearPaymentTotals.open)}
                    hint={
                      yearPaymentTotals.overdue > 0
                        ? t("stats.payment.overdueCount", { count: yearPaymentTotals.overdue })
                        : t("stats.payment.noOverdue")
                    }
                    icon={Euro}
                  />
                </>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {period === "monat" && isFestView && festDailyData.length > 0 ? (
          <AccordionItem value="sollist">
            <AccordionTrigger>{t("stats.details.sollIst")}</AccordionTrigger>
            <AccordionContent>
              <div className="overflow-x-auto pb-2">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="py-1 pr-2">{t("stats.table.day")}</th>
                      <th className="py-1 pr-2">{t("stats.table.soll")}</th>
                      <th className="py-1 pr-2">{t("stats.table.ist")}</th>
                      <th className="py-1">{t("stats.table.diff")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {festDailyData
                      .filter((d) => (d.soll ?? 0) > 0 || (d.ist ?? 0) > 0)
                      .map((d) => (
                        <tr key={d.date} className="border-t tabular-nums">
                          <td className="py-1 pr-2">{d.tag}</td>
                          <td className="py-1 pr-2">{formatHours(d.soll ?? 0)}</td>
                          <td className="py-1 pr-2">{formatHours(d.ist ?? 0)}</td>
                          <td className="py-1">{formatHours(d.diff ?? 0)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </AccordionContent>
          </AccordionItem>
        ) : null}

        {period === "jahr" ? (
          <AccordionItem value="year-extras">
            <AccordionTrigger>{t("stats.details.yearExtras")}</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 pb-2">
                <p className="text-xs text-muted-foreground">
                  {t("annual.subtitle", {
                    entries: annualReport.entries,
                    months: annualReport.activeMonths,
                  })}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    label={t("annual.kpi.workDays")}
                    value={String(annualReport.workDays)}
                    hint={t("annual.bonusShare", {
                      share: annualReport.bonusShare.toFixed(0),
                    })}
                    icon={ClipboardList}
                  />
                  <StatCard
                    label={t("annual.kpi.avgMonth")}
                    value={formatEuro(annualReport.avgMonthEarnings)}
                    hint={t("annual.kpi.avgDay") + ": " + formatHours(annualReport.avgDayHours)}
                    icon={TrendingUp}
                  />
                </div>
                <div className="rounded-2xl border p-3">
                  <h3 className="mb-2 text-xs font-semibold">{t("annual.chart.weekdays")}</h3>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={weekdayData}>
                      <XAxis dataKey="label" fontSize={10} />
                      <YAxis fontSize={10} width={28} />
                      <Tooltip formatter={(v: number) => formatHours(v)} />
                      <Bar dataKey="stunden" fill="var(--primary-glow)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {annualReport.bestMonth || annualReport.bestDay ? (
                  <div className="rounded-2xl border p-3">
                    <h3 className="mb-2 text-xs font-semibold">{t("annual.best.title")}</h3>
                    <ul className="space-y-1 text-sm">
                      {annualReport.bestMonth ? (
                        <li className="flex justify-between gap-2">
                          <span className="text-muted-foreground">{t("annual.best.month")}</span>
                          <span className="tabular-nums">
                            {annualReport.bestMonth.label} ·{" "}
                            {formatEuro(annualReport.bestMonth.earnings)}
                          </span>
                        </li>
                      ) : null}
                      {annualReport.bestDay ? (
                        <li className="flex justify-between gap-2">
                          <span className="text-muted-foreground">{t("annual.best.day")}</span>
                          <span className="tabular-nums">
                            {formatDate(annualReport.bestDay.date)} ·{" "}
                            {formatEuro(annualReport.bestDay.earnings)}
                          </span>
                        </li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}
              </div>
            </AccordionContent>
          </AccordionItem>
        ) : null}
      </Accordion>

      {/* Exporte */}
      <div className="mt-5 space-y-2 pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("stats.export.menu")}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {period === "monat" ? (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  doExport(
                    "xlsx",
                    monthShifts,
                    td("report.monthTitle", {
                      month: months[month] ?? "",
                      year,
                    }),
                  )
                }
              >
                <FileSpreadsheet className="size-4" /> {t("stats.export.listExcel")}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  doExport(
                    "pdf",
                    monthShifts,
                    td("report.monthTitle", {
                      month: months[month] ?? "",
                      year,
                    }),
                  )
                }
              >
                <FileDown className="size-4" /> {t("stats.export.listPdf")}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (monthShifts.length === 0) {
                    toast.error(t("stats.toast.noData"));
                    return;
                  }
                  exportWorkReportPdf(monthShifts, {
                    jobs,
                    month: `${monthNames(DOCUMENT_LOCALE)[month] ?? ""} ${year}`,
                    includePhotos: true,
                  });
                  toast.success(t("stats.toast.exportSuccess"));
                }}
              >
                <ClipboardList className="size-4" /> {t("stats.export.worklog")}
              </Button>
              <Button
                variant="outline"
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
                <ClipboardList className="size-4" /> {t("stats.export.proof")}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => doExport("xlsx", yearShifts, td("report.yearTitle", { year }))}
              >
                <FileSpreadsheet className="size-4" /> {t("stats.export.listExcel")}
              </Button>
              <Button
                variant="outline"
                onClick={() => doExport("pdf", yearShifts, td("report.yearTitle", { year }))}
              >
                <FileDown className="size-4" /> {t("stats.export.listPdf")}
              </Button>
              <Button variant="outline" onClick={() => doAnnualExport("xlsx")}>
                <FileSpreadsheet className="size-4" /> {t("stats.export.annualReport")} Excel
              </Button>
              <Button variant="outline" onClick={() => doAnnualExport("pdf")}>
                <FileDown className="size-4" /> {t("stats.export.annualReport")} PDF
              </Button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
