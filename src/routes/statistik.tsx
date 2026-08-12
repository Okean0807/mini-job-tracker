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
  averageRate,
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
import { useAppData } from "@/lib/minijob/store";

export const Route = createFileRoute("/statistik")({
  head: () => ({
    meta: [
      { title: "Statistik – MiniJob Tracker" },
      {
        name: "description",
        content:
          "Monats- und Jahresstatistiken zu Arbeitsstunden und Verdienst, inklusive Diagrammen und Export als Excel oder PDF.",
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
  const { shifts } = useAppData();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const yearShifts = useMemo(() => shiftsInYear(shifts, year), [shifts, year]);
  const monthShifts = useMemo(() => shiftsInMonth(shifts, year, month), [shifts, year, month]);

  const monthlyData = useMemo(
    () =>
      MONTHS_SHORT_DE.map((label, idx) => {
        const list = shiftsInMonth(shifts, year, idx);
        return {
          monat: label,
          stunden: Number(sumHours(list).toFixed(2)),
          verdienst: Number(sumEarnings(list).toFixed(2)),
        };
      }),
    [shifts, year],
  );

  const dailyData = useMemo(
    () =>
      [...monthShifts]
        .sort((a, b) => (a.date > b.date ? 1 : -1))
        .map((s) => ({
          tag: s.date.slice(8),
          verdienst: Number(shiftEarnings(s).toFixed(2)),
          stunden: Number(shiftHours(s).toFixed(2)),
        })),
    [monthShifts],
  );

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

      <Tabs defaultValue="monat" className="mt-5">
        <TabsList className="w-full">
          <TabsTrigger value="monat" className="flex-1">
            Monat
          </TabsTrigger>
          <TabsTrigger value="jahr" className="flex-1">
            Jahr
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
                  idx === month
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Verdienst"
              value={formatEuro(sumEarnings(monthShifts))}
              hint={`${MONTHS_DE[month]} ${year}`}
              icon={Euro}
              highlight
            />
            <StatCard label="Stunden" value={formatHours(sumHours(monthShifts))} icon={Clock} />
            <StatCard
              label="Ø Stundenlohn"
              value={formatEuro(averageRate(monthShifts))}
              icon={TrendingUp}
            />
            <StatCard
              label="Arbeitstage"
              value={String(new Set(monthShifts.map((s) => s.date)).size)}
              icon={Clock}
            />
          </div>

          <ChartCard title={`Verdienst pro Tag – ${MONTHS_DE[month]}`}>
            <BarChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="tag" fontSize={11} stroke="var(--muted-foreground)" />
              <YAxis fontSize={11} stroke="var(--muted-foreground)" width={40} />
              <Tooltip
                formatter={(v: number) => formatEuro(v)}
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                }}
              />
              <Bar dataKey="verdienst" radius={[6, 6, 0, 0]} fill="var(--chart-1)">
                {dailyData.map((_, i) => (
                  <Cell key={i} fill="var(--chart-1)" />
                ))}
              </Bar>
            </BarChart>
          </ChartCard>

          <ExportButtons
            onXlsx={() => {
              if (monthShifts.length === 0) {
                toast.error("Keine Daten zum Exportieren.");
                return;
              }
              exportXlsx(monthShifts, `MiniJob_${MONTHS_DE[month]}_${year}`);
              toast.success("Excel-Datei erstellt");
            }}
            onPdf={() => {
              if (monthShifts.length === 0) {
                toast.error("Keine Daten zum Exportieren.");
                return;
              }
              exportPdf(monthShifts, `${MONTHS_DE[month]} ${year}`);
              toast.success("PDF erstellt");
            }}
          />
        </TabsContent>

        <TabsContent value="jahr" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Verdienst"
              value={formatEuro(sumEarnings(yearShifts))}
              hint={`Jahr ${year}`}
              icon={Euro}
              highlight
            />
            <StatCard label="Stunden" value={formatHours(sumHours(yearShifts))} icon={Clock} />
            <StatCard
              label="Ø Stundenlohn"
              value={formatEuro(averageRate(yearShifts))}
              icon={TrendingUp}
            />
            <StatCard label="Schichten" value={String(yearShifts.length)} icon={Clock} />
          </div>

          <ChartCard title="Verdienst pro Monat">
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="monat" fontSize={11} stroke="var(--muted-foreground)" />
              <YAxis fontSize={11} stroke="var(--muted-foreground)" width={40} />
              <Tooltip
                formatter={(v: number) => formatEuro(v)}
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                }}
              />
              <Bar dataKey="verdienst" radius={[6, 6, 0, 0]} fill="var(--chart-1)" />
            </BarChart>
          </ChartCard>

          <ChartCard title="Stunden pro Monat">
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="monat" fontSize={11} stroke="var(--muted-foreground)" />
              <YAxis fontSize={11} stroke="var(--muted-foreground)" width={40} />
              <Tooltip
                formatter={(v: number) => formatHours(v)}
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="stunden"
                stroke="var(--chart-2)"
                strokeWidth={3}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ChartCard>

          <ExportButtons
            onXlsx={() => {
              if (yearShifts.length === 0) {
                toast.error("Keine Daten zum Exportieren.");
                return;
              }
              exportXlsx(yearShifts, `MiniJob_Jahr_${year}`);
              toast.success("Excel-Datei erstellt");
            }}
            onPdf={() => {
              if (yearShifts.length === 0) {
                toast.error("Keine Daten zum Exportieren.");
                return;
              }
              exportPdf(yearShifts, `Jahresübersicht ${year}`);
              toast.success("PDF erstellt");
            }}
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ExportButtons({ onXlsx, onPdf }: { onXlsx: () => void; onPdf: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Button variant="outline" onClick={onXlsx}>
        <FileSpreadsheet className="size-4" /> Excel
      </Button>
      <Button variant="outline" onClick={onPdf}>
        <FileDown className="size-4" /> PDF
      </Button>
    </div>
  );
}
