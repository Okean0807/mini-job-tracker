import { Coffee, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatClock, isoDate, timeFromDate } from "@/lib/minijob/calc";
import { clearTimer, newId, saveShift, startTimer, updateTimerBreak } from "@/lib/minijob/store";
import type { Job, RunningTimer, Settings } from "@/lib/minijob/types";

interface WorkTimerProps {
  timer: RunningTimer | null | undefined;
  jobs: Job[];
  settings: Settings;
}

export function WorkTimer({ timer, jobs, settings }: WorkTimerProps) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!timer) {
      setSeconds(0);
      return;
    }
    const tick = () => setSeconds(Math.floor((Date.now() - timer.startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timer]);

  const activeJob = jobs.find((j) => j.id === (timer?.jobId ?? settings.activeJobId)) ?? jobs[0];

  function start() {
    startTimer(activeJob?.id);
    toast.success("Arbeit gestartet");
  }

  function stop() {
    if (!timer) return;
    const startedAt = new Date(timer.startedAt);
    const now = new Date();
    const shift = {
      id: newId(),
      kind: "arbeit" as const,
      date: isoDate(startedAt),
      start: timeFromDate(startedAt),
      end: timeFromDate(now),
      breakMinutes: timer.breakMinutes,
      rate: activeJob?.rate ?? settings.defaultRate,
      ...(timer.jobId ? { jobId: timer.jobId } : {}),
    };
    saveShift(shift);
    clearTimer();
    toast.success("Arbeitszeit gespeichert");
  }

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Zeiterfassung
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {timer ? formatClock(seconds) : "00:00:00"}
          </p>
          <p className="text-xs text-muted-foreground">
            {activeJob ? activeJob.name : "Kein Job ausgewählt"}
            {timer?.breakMinutes ? ` · ${timer.breakMinutes} Min. Pause` : ""}
          </p>
        </div>
        {timer ? (
          <div className="flex flex-col gap-2">
            <Button variant="destructive" onClick={stop}>
              <Square className="size-4" /> Feierabend
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateTimerBreak(timer.breakMinutes + 15)}
            >
              <Coffee className="size-4" /> +15 Min.
            </Button>
          </div>
        ) : (
          <Button size="lg" onClick={start}>
            <Play className="size-4" /> Start
          </Button>
        )}
      </div>
    </div>
  );
}
