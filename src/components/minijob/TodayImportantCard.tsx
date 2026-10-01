import { AlertTriangle, CalendarClock, CheckCircle2, CreditCard, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { formatEuro, formatHours, isoDate, shiftHours } from "@/lib/minijob/calc";
import { payPeriods } from "@/lib/minijob/payday";
import { findWageViolations } from "@/lib/minijob/wage-compliance";
import type { Job, Payment, Settings, Shift } from "@/lib/minijob/types";
import type { Resolver } from "@/lib/minijob/resolve";
import { useT } from "@/lib/i18n";

export function TodayImportantCard({
  shifts,
  jobs,
  payments,
  settings,
  resolve,
  monthUsage,
  yearUsage,
  onNewEntry,
}: {
  shifts: Shift[];
  jobs: Job[];
  payments: Payment[];
  settings: Settings;
  resolve: Resolver;
  monthUsage: { share: number; earnings: number; earningsLimit: number };
  yearUsage: { share: number; earnings: number; earningsLimit: number };
  onNewEntry: () => void;
}) {
  const { t } = useT();
  const today = isoDate(new Date());
  const todayShifts = shifts.filter((s) => s.date === today);
  const todayHours = todayShifts.reduce((sum, s) => sum + shiftHours(s), 0);
  const periods = payPeriods(jobs, shifts, payments, resolve, new Date().getFullYear(), new Date().getMonth());
  const overdue = periods.filter((p) => p.overdue).reduce((sum, p) => sum + p.outstanding, 0);
  const open = periods.filter((p) => p.outstanding > 0.005).reduce((sum, p) => sum + p.outstanding, 0);
  const nearLimit = Math.max(monthUsage.share, yearUsage.share) >= 85;
  const monthStart = `${today.slice(0, 7)}-01`;
  const wageViolations = findWageViolations(shifts, jobs, settings.defaultRate, (s) => s.date >= monthStart && s.date <= today);
  const hasNoJob = jobs.length === 0;
  const hasPlannedToday = todayShifts.some((s) => s.kind === "planned");
  const isClear = !hasNoJob && !nearLimit && overdue <= 0.005 && !hasPlannedToday && wageViolations.length === 0;

  return (
    <section className="col-span-2 rounded-2xl border bg-card p-4 shadow-card" aria-labelledby="today-important-title">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p id="today-important-title" className="text-sm font-semibold">{t("dash.todayImportant")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("dash.todayImportantHint")}</p>
        </div>
        {isClear ? <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden /> : <AlertTriangle className="size-5 shrink-0 text-accent-foreground" aria-hidden />}
      </div>

      <div className="mt-3 grid gap-2">
        {hasNoJob ? (
          <ActionRow icon={<Plus className="size-4" />} title={t("dash.todayCreateJob")} href="/jobs" />
        ) : null}
        <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2.5">
          <span className="flex items-center gap-2 text-sm"><CalendarClock className="size-4" />{t("dash.todayWorked")}</span>
          <span className="font-semibold tabular-nums">{formatHours(todayHours)}</span>
        </div>
        {hasPlannedToday ? (
          <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">{t("dash.todayPlanned")}</div>
        ) : null}
        {overdue > 0.005 ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
            <span className="flex items-center gap-2"><CreditCard className="size-4" />{t("dash.todayOverdue")}</span>
            <span className="font-semibold tabular-nums">{formatEuro(overdue)}</span>
          </div>
        ) : open > 0.005 ? (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-sm">
            <span>{t("dash.todayOpen")}</span><span className="font-semibold tabular-nums">{formatEuro(open)}</span>
          </div>
        ) : null}
        {nearLimit ? (
          <div className="rounded-xl border border-accent bg-accent/10 px-3 py-2.5 text-sm">
            {t("dash.todayLimit", { percent: Math.round(Math.max(monthUsage.share, yearUsage.share)) })}
          </div>
        ) : null}
        {wageViolations.length > 0 ? (
          <Link to="/jobs" className="min-w-0 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm break-words hover:bg-destructive/10">
            <span className="font-medium">{t("dash.todayWageViolation", { count: wageViolations.length })}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{t("dash.todayWageViolationHint")}</span>
          </Link>
        ) : null}
      </div>

      <Button type="button" size="sm" className="mt-3 min-h-11 w-full" onClick={onNewEntry}>
        <Plus className="size-4" />{t("dash.newEntry")}
      </Button>
    </section>
  );
}

function ActionRow({ icon, title, href }: { icon: React.ReactNode; title: string; href: "/jobs" }) {
  return <Link to={href} className="flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium hover:bg-muted/50">{icon}{title}</Link>;
}
