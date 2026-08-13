import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Clock, Euro, LayoutGrid, Plus, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";

import { DashboardCustomizer } from "@/components/minijob/DashboardCustomizer";
import { GoalsCard } from "@/components/minijob/GoalsCard";
import { LimitCard } from "@/components/minijob/LimitCard";
import { PaydayCard } from "@/components/minijob/PaydayCard";
import { InsightsCard } from "@/components/minijob/InsightsCard";
import { MonthCalendar } from "@/components/minijob/MonthCalendar";
import { ShiftDialog } from "@/components/minijob/ShiftDialog";
import { ShiftList } from "@/components/minijob/ShiftList";
import { StatCard } from "@/components/minijob/StatCard";
import { WorkTimer } from "@/components/minijob/WorkTimer";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import {
  formatEuro,
  formatHours,
  isoDate,
  monthNames,
  shiftsInMonth,
  shiftsInYear,
  sumEarnings,
  sumHours,
} from "@/lib/minijob/calc";
import { activeWidgets, spanClass, widgetSize } from "@/lib/minijob/dashboard";
import { goalsProgress } from "@/lib/minijob/goals";
import { buildInsights } from "@/lib/minijob/insights";
import { monthUsage, yearlyLimitOf, yearUsage } from "@/lib/minijob/limits";
import { payPeriods } from "@/lib/minijob/payday";
import { makeResolver } from "@/lib/minijob/resolve";
import { useAppData } from "@/lib/minijob/store";
import type { Shift, WidgetId } from "@/lib/minijob/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MiniJob Tracker – Arbeitszeiten & Verdienst erfassen" },
      {
        name: "description",
        content:
          "Arbeitszeiten per Timer oder Kalender erfassen, Zuschläge und Verdienst automatisch berechnen – mit Jobs, Statistiken und Export.",
      },
      { property: "og:title", content: "MiniJob Tracker – Arbeitszeiten & Verdienst" },
      {
        property: "og:description",
        content: "Schichten erfassen, Zuschläge und Verdienst automatisch berechnen.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useT();
  const { shifts, jobs, customers, projects, payments, goals, settings, timer } = useAppData();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(isoDate(now));
  const [editing, setEditing] = useState<Shift | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const resolve = useMemo(() => makeResolver(jobs, settings), [jobs, settings]);
  const monthShifts = useMemo(() => shiftsInMonth(shifts, year, month), [shifts, year, month]);
  const yearShifts = useMemo(() => shiftsInYear(shifts, year), [shifts, year]);
  const insights = useMemo(
    () => buildInsights(shifts, year, month, resolve),
    [shifts, year, month, resolve],
  );

  const hours = sumHours(monthShifts);
  const earnings = sumEarnings(monthShifts, resolve);
  const yearEarnings = sumEarnings(yearShifts, resolve);
  const avg = hours > 0 ? earnings / hours : 0;
  const monthLimit = useMemo(
    () => monthUsage(shifts, resolve, settings, year, month),
    [shifts, resolve, settings, year, month],
  );
  const yearLimit = useMemo(
    () => yearUsage(shifts, resolve, settings, year),
    [shifts, resolve, settings, year],
  );
  const goalList = useMemo(
    () => goalsProgress(goals, shifts, jobs, resolve),
    [goals, shifts, jobs, resolve],
  );
  const periods = useMemo(
    () => payPeriods(jobs, shifts, payments, resolve, year, month),
    [jobs, shifts, payments, resolve, year, month],
  );
  const limitShare = monthLimit.share;
  const yearShare = yearLimit.share;
  const monthLabel = monthNames()[month] ?? "";
  const ui = settings.uiMode;

  function openNew(date: string) {
    setSelectedDate(date);
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(shift: Shift) {
    setSelectedDate(shift.date);
    setEditing(shift);
    setDialogOpen(true);
  }

  const dash = settings.dashboard;
  const widgets = activeWidgets(dash, ui);

  const widgetNodes: Record<WidgetId, React.ReactNode> = {
    timer: <WorkTimer timer={timer} jobs={jobs} settings={settings} />,
    stats: (
      <section className="grid grid-cols-2 gap-3" aria-label={t("dash.monthOverview")}>
        <StatCard
          label={t("dash.earnings")}
          value={formatEuro(earnings)}
          hint={`${monthLabel} ${year}`}
          icon={Euro}
          highlight
        />
        <StatCard
          label={t("dash.hours")}
          value={formatHours(hours)}
          hint={t("dash.inMonth")}
          icon={Clock}
        />
        {widgetSize(dash, "stats") === "small" ? null : (
          <>
            <StatCard
              label={t("dash.avgRate")}
              value={formatEuro(avg)}
              hint={t("label.entries", { count: monthShifts.length })}
              icon={TrendingUp}
            />
            <StatCard
              label={t("dash.limit")}
              value={`${Math.round(limitShare)} %`}
              hint={t("dash.ofAmount", { amount: formatEuro(settings.monthlyLimit) })}
              icon={Euro}
            />
          </>
        )}
      </section>
    ),
    limitMonth: (
      <LimitCard
        usage={monthLimit}
        scopeLabel={`${t("limit.month")} · ${monthLabel}`}
        rate={settings.defaultRate}
        auto={settings.hoursLimitAuto || settings.hoursLimitMonthly <= 0}
      />
    ),
    limitYear: (
      <LimitCard
        usage={yearLimit}
        scopeLabel={`${t("limit.year")} · ${year}`}
        rate={settings.defaultRate}
        auto={settings.hoursLimitAuto || settings.hoursLimitMonthly <= 0}
      />
    ),
    payday: <PaydayCard periods={periods} />,
    goals: <GoalsCard goals={goalList} jobs={jobs} />,
    insights: <InsightsCard insights={insights} month={month} year={year} />,
    calendar: (
      <MonthCalendar
        year={year}
        month={month}
        shifts={shifts}
        jobs={jobs}
        bundesland={settings.bundesland}
        onChangeMonth={(y, m) => {
          setYear(y);
          setMonth(m);
        }}
        onSelectDay={(date) => {
          const existing = shifts.find((s) => s.date === date);
          if (existing) openEdit(existing);
          else openNew(date);
        }}
      />
    ),
    shifts: (
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          {t("dash.entriesInMonth", { month: monthLabel })}
        </h2>
        <ShiftList shifts={monthShifts} jobs={jobs} resolve={resolve} onSelect={openEdit} />
      </section>
    ),
  };

  return (
    <main className="mx-auto max-w-lg px-4 pt-6">
      <header className="mb-5 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">{t("app.greeting")}</p>
          <h1 className="text-2xl font-extrabold tracking-tight">{t("app.name")}</h1>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("dash.customize")}
          onClick={() => setCustomizeOpen(true)}
        >
          <LayoutGrid className="size-5" />
        </Button>
      </header>

      {limitShare >= 100 || yearShare >= 100 ? (
        <LimitBanner
          tone="over"
          text={
            limitShare >= 100
              ? t("dash.limitMonthOver", { amount: formatEuro(settings.monthlyLimit) })
              : t("dash.limitYearOver", { amount: formatEuro(yearlyLimitOf(settings)) })
          }
        />
      ) : limitShare >= 85 || yearShare >= 85 ? (
        <LimitBanner
          tone="near"
          text={t("dash.limitNear", { percent: Math.round(Math.max(limitShare, yearShare)) })}
        />
      ) : null}

      {jobs.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed p-5 text-center">
          <p className="text-sm text-muted-foreground">{t("dash.noJobsHint")}</p>
          <Button asChild className="mt-3">
            <Link to="/jobs">{t("dash.createJob")}</Link>
          </Button>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 items-start gap-3">
        {widgets.map((id) => (
          <div key={id} className={spanClass(widgetSize(dash, id))}>
            {widgetNodes[id]}
          </div>
        ))}
      </div>

      <Button
        size="lg"
        onClick={() => openNew(isoDate(new Date()))}
        className="fixed bottom-20 right-4 z-40 h-14 rounded-full px-5 shadow-float"
      >
        <Plus className="size-5" /> {t("dash.newEntry")}
      </Button>

      <DashboardCustomizer
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        config={dash}
      />

      <ShiftDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        date={selectedDate}
        shift={editing}
        jobs={jobs}
        customers={customers}
        projects={projects}
        settings={settings}
      />
    </main>
  );
}

function LimitBanner({ tone, text }: { tone: "near" | "over"; text: string }) {
  return (
    <div
      className={
        tone === "over"
          ? "mt-4 flex items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          : "mt-4 flex items-start gap-2 rounded-2xl border border-accent bg-accent/20 p-3 text-sm text-accent-foreground"
      }
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p>{text}</p>
    </div>
  );
}
