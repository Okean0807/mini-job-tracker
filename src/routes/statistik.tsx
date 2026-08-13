import { createFileRoute } from "@tanstack/react-router";
import { Clock, Euro, FileDown, FileSpreadsheet, TrendingUp } from "lucide-react";
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

import { StatCard } from "@/components/minijob/StatCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MONTHS_DE,
  MONTHS_SHORT_DE,
  formatEuro,
  formatHours,
  shiftEarnings,
  shiftHours,
  shiftsInMonth,
  shiftsInYear,
  sumEarnings,
  sumHours,
} from "@/lib/minijob/calc";
import { exportPdf, exportXlsx } from "@/lib/minijob/export";
import { makeResolver } from "@/lib/minijob/resolve";
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
  const { shifts, jobs, settings } = useAppData();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [jobFilter, setJobFilter] = useState<string>("alle");

  const resolve = useMemo(() => makeResolver(jobs, settings), [jobs, settings]);
  const filtered = useMemo(
    () => (jobFilter === "alle" ? shifts : shifts.filter((s) => s.jobId === jobFilter)),
    [shifts, jobFilter],
  );

  const yearShifts = useMemo(() => shiftsInYear(filtered, year), [filtered, year]);
  const monthShifts = useMemo(() => shiftsInMonth(filtered, year, month), [filtered, year, month]);

  const monthlyData = useMemo(
    () =>
      MONTHS_SHORT_DE.map((label, idx) => {
        const list = shiftsInMonth(filtered, year, idx);
        return {
          monat: label,
          stunden: Number(sumHours(list).toFixed(2)),
          verdienst: Number(sumEarnings(list, resolve).toFixed(2)),
        };
      }),
    [filtered, year, resolve],
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

  const ctx = { jobs, bundesland: settings.bundesland };

  function doExport(kind: "xlsx" | "pdf", list: Shift[], title: string) {
    if (list.length === 0) {
      toast.error("Keine Daten für diesen Zeitraum.");
      return;
    }
    if (kind === "xlsx") exportXlsx(list, title, ctx);
    else exportPdf(list, title, ctx);
    toast.success("Export erstellt");
  }

  const monthEarnings = sumEarnings(monthShifts, resolve);
  const yearEarnings = sumEarnings(yearShifts, resolve);
  const monthHours = sumHours(monthShifts);
  const yearHours = sumHours(yearShifts);

  return (
    <main className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Statistik</h1>

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
            Alle Jobs
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
            Monat
          </TabsTrigger>
          <TabsTrigger value="jahr" className="flex-1">
            Jahr
          </TabsTrigger>
          <TabsTrigger value="jobs" className="flex-1">
            Jobs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="monat" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-1">
            {MONTHS_SHORT_DE.map((label, idx) => (
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
              label="Verdienst"
              value={formatEuro(monthEarnings)}
              hint={`${MONTHS_DE[month]} ${year}`}
              icon={Euro}
              highlight
            />
            <StatCard label="Stunden" value={formatHours(monthHours)} hint="im Monat" icon={Clock} />
          </div>

          <ChartCard title="Verdienst pro Tag">
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

          <ChartCard title="Stunden pro Tag">
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
                doExport("xlsx", monthShifts, `Monatsbericht ${MONTHS_DE[month]} ${year}`)
              }
            >
              <FileSpreadsheet className="size-4" /> Excel
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                doExport("pdf", monthShifts, `Monatsbericht ${MONTHS_DE[month]} ${year}`)
              }
            >
              <FileDown className="size-4" /> PDF
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="jahr" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Jahresverdienst"
              value={formatEuro(yearEarnings)}
              hint={String(year)}
              icon={Euro}
              highlight
            />
            <StatCard
              label="Jahresstunden"
              value={formatHours(yearHours)}
              hint={`${yearShifts.length} Einträge`}
              icon={Clock}
            />
            <StatCard
              label="Ø Stundenlohn"
              value={formatEuro(yearHours > 0 ? yearEarnings / yearHours : 0)}
              hint="im Jahr"
              icon={TrendingUp}
            />
            <StatCard
              label="Jahresgrenze"
              value={`${Math.round(
                settings.yearlyLimit > 0 ? (yearEarnings / settings.yearlyLimit) * 100 : 0,
              )} %`}
              hint={`von ${formatEuro(settings.yearlyLimit)}`}
              icon={Euro}
            />
          </div>

          <ChartCard title="Verdienst pro Monat">
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

          <ChartCard title="Stunden pro Monat">
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
              onClick={() => doExport("xlsx", yearShifts, `Jahresbericht ${year}`)}
            >
              <FileSpreadsheet className="size-4" /> Excel
            </Button>
            <Button
              variant="outline"
              onClick={() => doExport("pdf", yearShifts, `Jahresbericht ${year}`)}
            >
              <FileDown className="size-4" /> PDF
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="jobs" className="mt-4 space-y-3 pb-4">
          {perJob.length === 0 ? (
            <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Noch keine Jobs angelegt.
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
                  <p className="text-xs text-muted-foreground">{formatHours(hours)} in {year}</p>
                </div>
                <p className="font-semibold tabular-nums">{formatEuro(earnings)}</p>
              </div>
            ))
          )}
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
