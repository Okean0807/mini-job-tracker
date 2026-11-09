import { Coffee, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { formatClock, isoDate, timeFromDate } from "@/lib/minijob/calc";
import { suggestedRate } from "@/lib/minijob/rate";
import { addShift, ShiftValidationError } from "@/lib/minijob/service";
import { clearTimer, startTimer, updateTimerBreak } from "@/lib/minijob/store";
import type { Job, RunningTimer, Settings } from "@/lib/minijob/types";

interface WorkTimerProps {
  timer: RunningTimer | null | undefined;
  jobs: Job[];
  settings: Settings;
}

export function WorkTimer({ timer, jobs, settings }: WorkTimerProps) {
  const { t } = useT();
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
    toast.success(t("timer.startedToast"));
  }

  function stop() {
    if (!timer) return;
    const startedAt = new Date(timer.startedAt);
    const now = new Date();
    try {
      addShift({
        kind: "arbeit" as const,
        date: isoDate(startedAt),
        start: timeFromDate(startedAt),
        end: timeFromDate(now),
        breakMinutes: timer.breakMinutes,
        rate: suggestedRate({ jobId: activeJob?.id }, { jobs, settings }),
        ...(timer.jobId ? { jobId: timer.jobId } : {}),
      });
    } catch (error) {
      // K2: Die Schreibgrenze lehnt eine unmögliche Schicht ab (z. B. Beginn = Ende bei Start und
      // Stopp in derselben Minute). Es wird nichts gespeichert und der Timer läuft weiter –
      // keine Zeit geht still verloren, und es entsteht kein 0-Stunden-Eintrag.
      if (error instanceof ShiftValidationError) {
        const code = error.issues[0]?.code;
        const reason =
          code === "zero-duration"
            ? t("entry.errZeroDuration")
            : code === "break-too-long"
              ? t("entry.errBreakTooLong")
              : t("entry.errInvalidTime");
        toast.error(`${t("timer.notSaved")} ${reason}`);
        return;
      }
      throw error;
    }
    clearTimer();
    toast.success(t("timer.savedToast"));
  }

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("timer.tracking")}
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {timer ? formatClock(seconds) : "00:00:00"}
          </p>
          <p className="text-xs text-muted-foreground">
            {activeJob ? activeJob.name : t("timer.noJob")}
            {timer?.breakMinutes ? ` ${t("timer.breakMinutes", { minutes: timer.breakMinutes })}` : ""}
          </p>
        </div>
        {timer ? (
          <div className="flex flex-col gap-2">
            <Button variant="destructive" onClick={stop}>
              <Square className="size-4" /> {t("timer.finish")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateTimerBreak(timer.breakMinutes + 15)}
            >
              <Coffee className="size-4" /> {t("timer.addBreak")}
            </Button>
          </div>
        ) : (
          <Button size="lg" onClick={start}>
            <Play className="size-4" /> {t("timer.start")}
          </Button>
        )}
      </div>
    </div>
  );
}
