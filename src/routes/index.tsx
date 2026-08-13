import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Clock, Euro, Plus, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";

import { MonthCalendar } from "@/components/minijob/MonthCalendar";
import { ShiftDialog } from "@/components/minijob/ShiftDialog";
import { ShiftList } from "@/components/minijob/ShiftList";
import { StatCard } from "@/components/minijob/StatCard";
import { WorkTimer } from "@/components/minijob/WorkTimer";
import { Button } from "@/components/ui/button";
import {
  MONTHS_DE,
  formatEuro,
  formatHours,
  isoDate,
  shiftsInMonth,
  shiftsInYear,
  sumEarnings,
  sumHours,
} from "@/lib/minijob/calc";
import { makeResolver } from "@/lib/minijob/resolve";
import { useAppData } from "@/lib/minijob/store";
import type { Shift } from "@/lib/minijob/types";

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
  const { shifts, jobs, customers, projects, settings, timer } = useAppData();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(isoDate(now));
  const [editing, setEditing] = useState<Shift | null>(null);

  const resolve = useMemo(() => makeResolver(jobs, settings), [jobs, settings]);
  const monthShifts = useMemo(() => shiftsInMonth(shifts, year, month), [shifts, year, month]);
  const yearShifts = useMemo(() => shiftsInYear(shifts, year), [shifts, year]);

  const hours = sumHours(monthShifts);
  const earnings = sumEarnings(monthShifts, resolve);
  const yearEarnings = sumEarnings(yearShifts, resolve);
  const avg = hours > 0 ? earnings / hours : 0;
  const limitShare = settings.monthlyLimit > 0 ? (earnings / settings.monthlyLimit) * 100 : 0;
  const yearShare = settings.yearlyLimit > 0 ? (yearEarnings / settings.yearlyLimit) * 100 : 0;

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

  return (
    <main className="mx-auto max-w-lg px-4 pt-6">
      <header className="mb-5">
        <p className="text-sm text-muted-foreground">Guten Tag</p>
        <h1 className="text-2xl font-extrabold tracking-tight">MiniJob Tracker</h1>
      </header>

      <WorkTimer timer={timer} jobs={jobs} settings={settings} />

      {limitShare >= 100 || yearShare >= 100 ? (
        <LimitBanner
          tone="over"
          text={
            limitShare >= 100
              ? `Die Monatsgrenze von ${formatEuro(settings.monthlyLimit)} ist überschritten.`
              : `Die Jahresgrenze von ${formatEuro(settings.yearlyLimit)} ist überschritten.`
          }
        />
      ) : limitShare >= 85 || yearShare >= 85 ? (
        <LimitBanner
          tone="near"
          text={`Du näherst dich der Minijob-Grenze (${Math.round(Math.max(limitShare, yearShare))} %).`}
        />
      ) : null}

      <section className="mt-4 grid grid-cols-2 gap-3" aria-label="Monatsübersicht">
        <StatCard
          label="Verdienst"
          value={formatEuro(earnings)}
          hint={`${MONTHS_DE[month]} ${year}`}
          icon={Euro}
          highlight
        />
        <StatCard label="Stunden" value={formatHours(hours)} hint="im Monat" icon={Clock} />
        <StatCard
          label="Ø Stundenlohn"
          value={formatEuro(avg)}
          hint={`${monthShifts.length} ${monthShifts.length === 1 ? "Eintrag" : "Einträge"}`}
          icon={TrendingUp}
        />
        <StatCard
          label="Minijob-Grenze"
          value={`${Math.round(limitShare)} %`}
          hint={`von ${formatEuro(settings.monthlyLimit)}`}
          icon={Euro}
        />
      </section>

      {jobs.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed p-5 text-center">
          <p className="text-sm text-muted-foreground">
            Lege zuerst einen Job an, um Farben, Stundenlohn und Zuschläge zu nutzen.
          </p>
          <Button asChild className="mt-3">
            <Link to="/jobs">Job anlegen</Link>
          </Button>
        </div>
      ) : null}

      <section className="mt-5">
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
      </section>

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          Einträge im {MONTHS_DE[month]}
        </h2>
        <ShiftList shifts={monthShifts} jobs={jobs} resolve={resolve} onSelect={openEdit} />
      </section>

      <Button
        size="lg"
        onClick={() => openNew(isoDate(new Date()))}
        className="fixed bottom-20 right-4 z-40 h-14 rounded-full px-5 shadow-float"
      >
        <Plus className="size-5" /> Eintrag
      </Button>

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
