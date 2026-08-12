import { createFileRoute } from "@tanstack/react-router";
import { Clock, Euro, Plus, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";

import { MonthCalendar } from "@/components/minijob/MonthCalendar";
import { ShiftDialog } from "@/components/minijob/ShiftDialog";
import { ShiftList } from "@/components/minijob/ShiftList";
import { StatCard } from "@/components/minijob/StatCard";
import { Button } from "@/components/ui/button";
import {
  MONTHS_DE,
  averageRate,
  formatEuro,
  formatHours,
  isoDate,
  shiftsInMonth,
  sumEarnings,
  sumHours,
} from "@/lib/minijob/calc";
import { useAppData } from "@/lib/minijob/store";
import type { Shift } from "@/lib/minijob/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MiniJob Tracker – Arbeitszeiten & Verdienst erfassen" },
      {
        name: "description",
        content:
          "Arbeitstage im Kalender erfassen, Stunden und Verdienst automatisch berechnen – mit Statistiken, Excel- und PDF-Export.",
      },
      { property: "og:title", content: "MiniJob Tracker – Arbeitszeiten & Verdienst" },
      {
        property: "og:description",
        content: "Schichten erfassen, Stunden und Verdienst automatisch berechnen.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { shifts, settings } = useAppData();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(isoDate(now));
  const [editing, setEditing] = useState<Shift | null>(null);

  const monthShifts = useMemo(
    () => shiftsInMonth(shifts, year, month),
    [shifts, year, month],
  );
  const hours = sumHours(monthShifts);
  const earnings = sumEarnings(monthShifts);
  const avg = averageRate(monthShifts);
  const limitShare = settings.monthlyLimit > 0 ? (earnings / settings.monthlyLimit) * 100 : 0;

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

      <section className="grid grid-cols-2 gap-3" aria-label="Monatsübersicht">
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
          hint={`${monthShifts.length} Schichten`}
          icon={TrendingUp}
        />
        <StatCard
          label="Minijob-Grenze"
          value={`${Math.round(limitShare)} %`}
          hint={`von ${formatEuro(settings.monthlyLimit)}`}
          icon={Euro}
        />
      </section>

      <section className="mt-5">
        <MonthCalendar
          year={year}
          month={month}
          shifts={shifts}
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
          Schichten im {MONTHS_DE[month]}
        </h2>
        <ShiftList shifts={monthShifts} onSelect={openEdit} />
      </section>

      <Button
        size="lg"
        onClick={() => openNew(isoDate(new Date()))}
        className="fixed bottom-20 right-4 z-40 h-14 rounded-full px-5 shadow-float"
      >
        <Plus className="size-5" /> Schicht
      </Button>

      <ShiftDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        date={selectedDate}
        shift={editing}
        defaultRate={settings.defaultRate}
      />
    </main>
  );
}
