/**
 * Statistik S5: Wochenansicht (ISO-KW) mit Vorwochen-Vergleich.
 * Rechenlogik ausschließlich in `stats-week.ts` (S1-Helper + unveränderte Payroll).
 * Keine Jahresgrenze, keine Exporte, keine Zahlungen in der Woche.
 */
import { CalendarDays, Clock, Euro, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { StatCard } from "@/components/minijob/StatCard";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useT } from "@/lib/i18n";
import { formatDate, formatEuro, formatHours, weekdayNames } from "@/lib/minijob/calc";
import type { DateKey } from "@/lib/minijob/date-key";
import type { WeekPeriod } from "@/lib/minijob/period";
import type { ValueComparison } from "@/lib/minijob/period-aggregate";
import type { Resolver } from "@/lib/minijob/resolve";
import {
  buildWeekBreakdown,
  buildWeekComparison,
  buildWeekStats,
  percentDisplay,
  weekTimeAccount,
} from "@/lib/minijob/stats-week";
import type { Job, Shift } from "@/lib/minijob/types";

export type WeekChartMode = "stunden" | "verdienst";

interface Props {
  week: WeekPeriod;
  today: DateKey;
  /** ALLE Schichten (Payroll-Historie). */
  shifts: Shift[];
  /** Job-gefilterte Schichten (Anzeige). */
  filtered: Shift[];
  /** Per Filter gewählte Jobs (Aufteilung). */
  selectedJobs: Job[];
  resolve: Resolver;
  /** Fest-Job für Soll/Ist – nur gesetzt, wenn das Monats-Gating zutrifft (E5). */
  sollIstJob: Job | null;
  bundesland: string;
  chartMode: WeekChartMode;
  onChartModeChange: (mode: WeekChartMode) => void;
}

const MINUS = "\u2212";

function signed(value: number, format: (n: number) => string): string {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return format(0);
  return `${rounded > 0 ? "+" : MINUS}${format(Math.abs(rounded))}`;
}

export function StatsWeekView({
  week,
  today,
  shifts,
  filtered,
  selectedJobs,
  resolve,
  sollIstJob,
  bundesland,
  chartMode,
  onChartModeChange,
}: Props) {
  const { t } = useT();

  const stats = useMemo(
    () => buildWeekStats(week, filtered, shifts, resolve, today),
    [week, filtered, shifts, resolve, today],
  );
  const comparison = useMemo(
    () => buildWeekComparison(week, filtered, shifts, resolve, today),
    [week, filtered, shifts, resolve, today],
  );
  const breakdown = useMemo(
    () => buildWeekBreakdown(week, selectedJobs, filtered, shifts, resolve, today),
    [week, selectedJobs, filtered, shifts, resolve, today],
  );
  const account = useMemo(
    () => (sollIstJob ? weekTimeAccount(sollIstJob, week, filtered, today, bundesland) : null),
    [sollIstJob, week, filtered, today, bundesland],
  );

  const weekdays = weekdayNames(undefined, "short");
  const chartData = stats.days.map((d, i) => {
    const hours = Number(d.workedHours.toFixed(2));
    const earnings = Number(d.earnings.toFixed(2));
    return {
      key: weekdays[i] ?? String(i + 1),
      date: d.date,
      planned: d.planned,
      actualValue: d.planned ? 0 : chartMode === "verdienst" ? earnings : hours,
      plannedValue: d.planned ? (chartMode === "verdienst" ? earnings : hours) : 0,
    };
  });

  const { actual, planned } = stats;
  const fmtValue = (v: number) => (chartMode === "verdienst" ? formatEuro(v) : formatHours(v));
  const weekLabel = t("stats.week.title", { week: week.isoWeek, year: week.isoYear });

  const earningsDetails = [
    t("stats.week.ofWork", { amount: formatEuro(actual.workEarnings) }),
    t("stats.week.ofAbsence", { amount: formatEuro(actual.absenceEarnings) }),
    ...(planned.entries > 0 && planned.earnings !== 0
      ? [t("stats.week.planned", { value: formatEuro(planned.earnings) })]
      : []),
  ];
  const hoursDetails =
    planned.workedHours > 0
      ? [t("stats.week.planned", { value: formatHours(planned.workedHours) })]
      : [];
  const daysDetails =
    planned.workDays > 0 ? [t("stats.week.planned", { value: String(planned.workDays) })] : [];

  function percentCell(c: ValueComparison): string {
    const p = percentDisplay(c);
    if (p.kind === "noValues") return t("stats.week.compare.noValues");
    if (p.kind === "noPrevious") return t("stats.week.compare.noPrevious");
    const sign = p.value > 0 ? "+" : p.value < 0 ? MINUS : "";
    return sign + t("stats.week.compare.percentValue", { value: Math.abs(p.value) });
  }

  const statusText =
    stats.status === "past"
      ? t("stats.week.status.past")
      : stats.status === "running"
        ? t("stats.week.status.running", { day: stats.elapsedDays })
        : t("stats.week.status.future");

  return (
    <div data-testid="stats-week">
      <p className="mt-1 text-center text-xs text-muted-foreground" data-testid="week-status">
        {statusText}
      </p>

      {/* KPI-Zeile: tatsächlich bis heute; geplant separat */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <StatCard
          label={t("stats.week.kpi.earnings")}
          value={formatEuro(actual.earnings)}
          hint={t("stats.week.actualHint")}
          details={earningsDetails}
          icon={Euro}
          highlight
        />
        <StatCard
          label={t("stats.week.kpi.hours")}
          value={formatHours(actual.workedHours)}
          hint={t("stats.week.actualHint")}
          details={hoursDetails}
          icon={Clock}
        />
        <StatCard
          label={t("stats.week.kpi.workDays")}
          value={String(actual.workDays)}
          hint={t("stats.week.actualHint")}
          details={daysDetails}
          icon={CalendarDays}
        />
        {account ? (
          <StatCard
            label={t("stats.week.kpi.sollIst")}
            value={`${formatHours(account.ist)} / ${formatHours(account.soll)}`}
            hint={t("stats.week.sollIstHint", {
              ist: formatHours(account.ist),
              soll: formatHours(account.soll),
            })}
            details={account.istIncludesPlanned ? [t("stats.week.inclPlanned")] : []}
            icon={TrendingUp}
          />
        ) : null}
      </div>

      {/* Vorwochen-Vergleich (nur Woche, E11) */}
      <section
        className="mt-4 rounded-2xl border bg-card p-4 shadow-card"
        data-testid="week-compare"
        aria-labelledby="week-compare-title"
      >
        {comparison ? (
          <>
            <h2 id="week-compare-title" className="text-sm font-semibold">
              {t("stats.week.compare.title", {
                week: comparison.previousWeek.isoWeek,
                year: comparison.previousWeek.isoYear,
              })}
            </h2>
            <p className="text-xs text-muted-foreground">
              {comparison.status === "past"
                ? t("stats.week.compare.full")
                : t("stats.week.compare.running", { days: comparison.days })}
              {" · "}
              {t("stats.week.compare.actualOnly")}
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">{t("stats.week.compare.metric")}</th>
                    <th className="py-1 pr-2 font-medium">{t("stats.week.compare.current")}</th>
                    <th className="py-1 pr-2 font-medium">
                      {t("stats.week.compare.previous", { week: comparison.previousWeek.isoWeek })}
                    </th>
                    <th className="py-1 pr-2 font-medium">{t("stats.week.compare.delta")}</th>
                    <th className="py-1 font-medium">%</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t" data-testid="compare-earnings">
                    <td className="py-1 pr-2">{t("stats.week.kpi.earnings")}</td>
                    <td className="py-1 pr-2">{formatEuro(comparison.earnings.current)}</td>
                    <td className="py-1 pr-2">{formatEuro(comparison.earnings.previous)}</td>
                    <td className="whitespace-nowrap py-1 pr-2">
                      {signed(comparison.earnings.delta, (n) => formatEuro(n))}
                    </td>
                    <td className="whitespace-nowrap py-1">{percentCell(comparison.earnings)}</td>
                  </tr>
                  <tr className="border-t" data-testid="compare-hours">
                    <td className="py-1 pr-2">{t("stats.week.kpi.hours")}</td>
                    <td className="py-1 pr-2">{formatHours(comparison.workedHours.current)}</td>
                    <td className="py-1 pr-2">{formatHours(comparison.workedHours.previous)}</td>
                    <td className="whitespace-nowrap py-1 pr-2">
                      {signed(comparison.workedHours.delta, (n) => formatHours(n))}
                    </td>
                    <td className="whitespace-nowrap py-1">
                      {percentCell(comparison.workedHours)}
                    </td>
                  </tr>
                  <tr className="border-t" data-testid="compare-workdays">
                    <td className="py-1 pr-2">{t("stats.week.kpi.workDays")}</td>
                    <td className="py-1 pr-2">{comparison.workDays.current}</td>
                    <td className="py-1 pr-2">{comparison.workDays.previous}</td>
                    <td className="whitespace-nowrap py-1 pr-2">
                      {signed(comparison.workDays.delta, (n) => String(n))}
                    </td>
                    <td className="py-1">–</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p id="week-compare-title" className="text-xs text-muted-foreground">
            {t("stats.week.compare.future")}
          </p>
        )}
      </section>

      {/* 7-Tage-Diagramm: tatsächlich volle Farbe, geplant hell + gestrichelt */}
      <section className="mt-4 rounded-2xl border bg-card p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {t("stats.week.chart.title", { label: weekLabel })}
          </h2>
          <div className="flex rounded-full border p-0.5 text-xs">
            <button
              type="button"
              aria-pressed={chartMode === "stunden"}
              className={`rounded-full px-2.5 py-1 ${
                chartMode === "stunden" ? "bg-primary text-primary-foreground" : ""
              }`}
              onClick={() => onChartModeChange("stunden")}
            >
              {t("stats.week.chart.hours")}
            </button>
            <button
              type="button"
              aria-pressed={chartMode === "verdienst"}
              className={`rounded-full px-2.5 py-1 ${
                chartMode === "verdienst" ? "bg-primary text-primary-foreground" : ""
              }`}
              onClick={() => onChartModeChange("verdienst")}
            >
              {t("stats.week.chart.earnings")}
            </button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="key" fontSize={11} interval={0} />
            <YAxis fontSize={11} width={38} />
            <Tooltip
              formatter={(v: number, name: string) => [fmtValue(v), name]}
              labelFormatter={(_label, payload) => {
                const row = payload?.[0]?.payload as
                  { date?: string; planned?: boolean } | undefined;
                if (!row?.date) return String(_label);
                return `${formatDate(row.date)}${row.planned ? ` · ${t("stats.week.chart.planned")}` : ""}`;
              }}
            />
            <Bar
              dataKey="actualValue"
              name={t("stats.week.chart.actual")}
              stackId="w"
              fill="var(--primary)"
              radius={[6, 6, 0, 0]}
            />
            <Bar
              dataKey="plannedValue"
              name={t("stats.week.chart.planned")}
              stackId="w"
              fill="var(--primary-glow)"
              fillOpacity={0.35}
              stroke="var(--primary)"
              strokeDasharray="4 3"
              radius={[6, 6, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-2 flex gap-4 text-xs text-muted-foreground" data-testid="week-legend">
          <span className="flex items-center gap-1.5">
            <span
              className="size-3 rounded-sm"
              style={{ background: "var(--primary)" }}
              aria-hidden
            />
            {t("stats.week.chart.actual")}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="size-3 rounded-sm border border-dashed"
              style={{
                background: "var(--primary-glow)",
                opacity: 0.6,
                borderColor: "var(--primary)",
              }}
              aria-hidden
            />
            {t("stats.week.chart.planned")}
          </span>
        </div>
      </section>

      {/* Aufteilung (folgt Filter, E8) */}
      <section className="mt-4 space-y-3" data-testid="week-breakdown">
        <h2 className="text-sm font-semibold">{t("stats.week.breakdown.title")}</h2>
        {breakdown.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("stats.week.breakdown.empty")}
          </p>
        ) : (
          breakdown.map(({ job, actual: a, planned: p }) => (
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
                  {formatHours(a.hours)} · {formatEuro(a.earnings)}
                </p>
                {p.hours > 0 || p.earnings > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("stats.week.planned", {
                      value: `${formatHours(p.hours)} · ${formatEuro(p.earnings)}`,
                    })}
                  </p>
                ) : null}
              </div>
              <p className="font-semibold tabular-nums">{formatEuro(a.earnings)}</p>
            </div>
          ))
        )}
      </section>

      {account ? (
        <Accordion type="multiple" className="mt-4">
          <AccordionItem value="week-sollist">
            <AccordionTrigger>{t("stats.week.details.sollIst")}</AccordionTrigger>
            <AccordionContent>
              {account.istIncludesPlanned ? (
                <p className="pb-2 text-xs text-muted-foreground">{t("stats.week.inclPlanned")}</p>
              ) : null}
              <div className="overflow-x-auto pb-2">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="py-1 pr-2">{t("stats.week.table.day")}</th>
                      <th className="py-1 pr-2">{t("stats.week.table.soll")}</th>
                      <th className="py-1 pr-2">{t("stats.week.table.ist")}</th>
                      <th className="py-1">{t("stats.week.table.diff")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.days
                      .filter((d) => d.soll > 0 || d.ist > 0)
                      .map((d) => (
                        <tr key={d.date} className="border-t tabular-nums">
                          <td className="py-1 pr-2">{formatDate(d.date)}</td>
                          <td className="py-1 pr-2">{formatHours(d.soll)}</td>
                          <td className="py-1 pr-2">{formatHours(d.ist)}</td>
                          <td className="py-1">{formatHours(d.diff)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}
    </div>
  );
}
