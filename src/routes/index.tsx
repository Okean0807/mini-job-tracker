import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Clock, Euro, LayoutGrid, Plus, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";

import { DashboardCustomizer } from "@/components/minijob/DashboardCustomizer";
import { TodayImportantCard } from "@/components/minijob/TodayImportantCard";
import { GoalsCard } from "@/components/minijob/GoalsCard";
import { OrdersCard } from "@/components/minijob/OrdersCard";
import { LimitCard } from "@/components/minijob/LimitCard";
import { LegalForecastCard } from "@/components/minijob/LegalForecastCard";
import { TimeAccountCard } from "@/components/minijob/TimeAccountCard";
import { PaydayCard } from "@/components/minijob/PaydayCard";
import { InsightsCard } from "@/components/minijob/InsightsCard";
import { MonthCalendar } from "@/components/minijob/MonthCalendar";
import { AbsenceDialog } from "@/components/minijob/AbsenceDialog";
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
} from "@/lib/minijob/calc";
import { sortProofShifts } from "@/lib/minijob/arbeitsnachweis";
import { payrollTotals } from "@/lib/minijob/payroll";
import { activeWidgets, spanClass, widgetSize } from "@/lib/minijob/dashboard";
import { goalsProgress } from "@/lib/minijob/goals";
import { buildInsights } from "@/lib/minijob/insights";
import { monthUsage, yearUsage } from "@/lib/minijob/limits";
import { legalIncomeForMonth } from "@/lib/minijob/service";
import { isAbsenceKind, type AbsenceKind } from "@/lib/minijob/absence-range";
import { monthTimeAccount } from "@/lib/minijob/fest-time-account";
import { jobsApplyMinijobLimit, primaryWorkMode } from "@/lib/minijob/work-mode";
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
      { property: "og:title", content: "MiniJob Tracker – Arbeitszeiten & Verdienst erfassen" },
      {
        property: "og:description",
        content: "Arbeitszeiten per Timer oder Kalender erfassen, Zuschläge und Verdienst automatisch berechnen – mit Jobs, Statistiken und Export.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useT();
  const { shifts, jobs, customers, projects, payments, goals, orders, objects, settings, timer } = useAppData();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [absenceOpen, setAbsenceOpen] = useState(false);
  const [absenceSeed, setAbsenceSeed] = useState<Shift | null>(null);
  const [absenceKind, setAbsenceKind] = useState<AbsenceKind>("urlaub");
  const [selectedDate, setSelectedDate] = useState(isoDate(now));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const resolve = useMemo(() => makeResolver(jobs, settings), [jobs, settings]);
  const monthShifts = useMemo(() => sortProofShifts(shiftsInMonth(shifts, year, month)), [shifts, year, month]);
  const yearShifts = useMemo(() => shiftsInYear(shifts, year), [shifts, year]);
  const insights = useMemo(
    () => buildInsights(shifts, year, month, resolve),
    [shifts, year, month, resolve],
  );

  const monthTotals = useMemo(
    () => payrollTotals(monthShifts, resolve, shifts),
    [monthShifts, resolve, shifts],
  );
  const yearTotals = useMemo(
    () => payrollTotals(yearShifts, resolve, shifts),
    [yearShifts, resolve, shifts],
  );
  const hours = monthTotals.workedHours;
  const earnings = monthTotals.earnings;
  const yearEarnings = yearTotals.earnings;
  const avg = hours > 0 ? monthTotals.workEarnings / hours : 0;
  const monthLimit = useMemo(
    () => monthUsage(shifts, resolve, settings, year, month),
    [shifts, resolve, settings, year, month],
  );
  const yearLimit = useMemo(
    () => yearUsage(shifts, resolve, settings, year),
    [shifts, resolve, settings, year],
  );
  const legalForecast = useMemo(
    () => legalIncomeForMonth(year, month),
    [year, month, shifts, jobs, settings, resolve],
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
  const appliesMinijobLimit = jobsApplyMinijobLimit(jobs);
  const workMode = primaryWorkMode(jobs, settings.activeJobId);
  const isFest = workMode === "fest";
  const isSelf = workMode === "selbststaendig";
  const festJob =
    jobs.find((j) => j.id === settings.activeJobId && j.mode === "fest" && !j.archived) ??
    jobs.find((j) => j.mode === "fest" && !j.archived);
  const timeAccount = useMemo(() => {
    if (!festJob) return null;
    return monthTimeAccount(festJob, year, month, shifts, settings.bundesland);
  }, [festJob, year, month, shifts, settings.bundesland]);
  const monthLabel = monthNames()[month] ?? "";
  const ui = settings.uiMode;

  function openNew(date: string) {
    setSelectedDate(date);
    setEditingId(null);
    setDialogOpen(true);
  }

  function requestAbsence(kind: AbsenceKind, date: string) {
    setSelectedDate(date);
    setAbsenceSeed(null);
    setAbsenceKind(kind);
    setDialogOpen(false);
    setAbsenceOpen(true);
  }

  function openEdit(shift: Shift) {
    if (typeof shift?.id !== "string" || shift.id.length === 0) return;
    setSelectedDate(shift.date);
    setEditingId(shift.id);
    setDialogOpen(true);
  }

  // Bearbeiten über die stabile Shift.id (aktueller Stand aus dem Store).
  const editing = editingId ? (shifts.find((s) => s.id === editingId) ?? null) : null;

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
              value={appliesMinijobLimit ? `${Math.round(limitShare)} %` : "—"}
              hint={
                appliesMinijobLimit
                  ? t("dash.ofAmount", { amount: formatEuro(monthLimit.earningsLimit) })
                  : t("limit.notApplicable")
              }
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
        notApplicable={!appliesMinijobLimit}
      />
    ),
    legalForecast: <LegalForecastCard forecast={legalForecast.rolling} />,
    limitYear: (
      <LimitCard
        usage={yearLimit}
        scopeLabel={`${t("limit.year")} · ${year}`}
        rate={settings.defaultRate}
        auto={settings.hoursLimitAuto || settings.hoursLimitMonthly <= 0}
        notApplicable={!appliesMinijobLimit}
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
        resolve={resolve}
        onChangeMonth={(y, m) => {
          setYear(y);
          setMonth(m);
        }}
        onSelectDay={(date) => {
          const dayShifts = shifts.filter((s) => s.date === date);
          if (dayShifts.length === 0) {
            openNew(date);
            return;
          }
          // Nur Abwesenheit(en): bestehendes Absence-Edit. Arbeit oder Mix → neuer Eintrag
          // (mehrere Intervalle am selben Tag). Bearbeiten bleibt über ShiftList.
          const hasArbeitOrOther = dayShifts.some((s) => !isAbsenceKind(s.kind));
          if (!hasArbeitOrOther) {
            const absence = dayShifts.find((s) => isAbsenceKind(s.kind));
            if (absence) {
              setAbsenceSeed(absence);
              setAbsenceOpen(true);
              return;
            }
          }
          openNew(date);
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

      {appliesMinijobLimit && (limitShare >= 100 || yearShare >= 100) ? (
        <LimitBanner
          tone="over"
          text={
            limitShare >= 100
              ? t("dash.limitMonthOver", { amount: formatEuro(monthLimit.earningsLimit) })
              : t("dash.limitYearOver", { amount: formatEuro(yearLimit.earningsLimit) })
          }
          detail={t("dash.limitOverExplain")}
          disclaimer={t("dash.limitDisclaimer")}
        />
      ) : appliesMinijobLimit && (limitShare >= 85 || yearShare >= 85) ? (
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

      {isFest && timeAccount ? (
        <div className="mt-4 grid grid-cols-2 items-start gap-3">
          <TimeAccountCard account={timeAccount} monthLabel={monthLabel} year={year} />
        </div>
      ) : null}

      {isSelf ? (
        <div className="mt-4 grid grid-cols-2 items-start gap-3">
          <OrdersCard orders={orders} jobs={jobs} payments={payments} />
        </div>
      ) : null}

      <div className="mt-4">
        <TodayImportantCard
          shifts={shifts}
          jobs={jobs}
          payments={payments}
          settings={settings}
          resolve={resolve}
          monthUsage={monthLimit}
          yearUsage={yearLimit}
          onNewEntry={() => openNew(isoDate(new Date()))}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 items-start gap-3">
        {widgets.map((id) => (
          <div key={id} className={spanClass(widgetSize(dash, id))}>
            {widgetNodes[id]}
          </div>
        ))}
      </div>

      <div className="dash-fab fixed bottom-20 right-4 z-40 flex flex-col items-end gap-2">
        <Button
          size="lg"
          onClick={() => openNew(isoDate(new Date()))}
          className="h-14 rounded-full px-5 shadow-float"
        >
          <Plus className="size-5" /> {t("dash.newEntry")}
        </Button>
      </div>

      {/* Scroll clearance so last cards sit above FAB + tall glove/large nav */}
      <div className="dash-fab-spacer h-24" aria-hidden />

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
        shiftId={editingId}
        jobs={jobs}
        customers={customers}
        projects={projects}
        settings={settings}
        objects={objects}
        onRequestAbsence={requestAbsence}
      />

      <AbsenceDialog
        open={absenceOpen}
        onOpenChange={setAbsenceOpen}
        jobs={jobs}
        shifts={shifts}
        seed={absenceSeed}
        defaultFrom={selectedDate}
        defaultKind={absenceKind}
        activeJobId={settings.activeJobId}
      />
    </main>
  );
}

function LimitBanner({
  tone,
  text,
  detail,
  disclaimer,
}: {
  tone: "near" | "over";
  text: string;
  detail?: string;
  disclaimer?: string;
}) {
  return (
    <div
      className={
        tone === "over"
          ? "mt-4 flex items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          : "mt-4 flex items-start gap-2 rounded-2xl border border-accent bg-accent/20 p-3 text-sm text-accent-foreground"
      }
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1.5">
        <p className="font-medium">{text}</p>
        {detail ? <p className="text-xs leading-relaxed opacity-90">{detail}</p> : null}
        {disclaimer ? <p className="text-xs leading-relaxed opacity-80">{disclaimer}</p> : null}
      </div>
    </div>
  );
}
