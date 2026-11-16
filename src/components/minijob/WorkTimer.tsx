import { Coffee, Minus, Play, Plus, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import { formatClock, isoDate, timeFromDate, toMinutes } from "@/lib/minijob/calc";
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
  // Korrektur der Pause nach einem abgelehnten Stopp (nur ein Entwurf; der Timer bleibt unberührt).
  const [fixOpen, setFixOpen] = useState(false);
  const [fixBreak, setFixBreak] = useState("");
  const [fixRejected, setFixRejected] = useState(false);

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

  /**
   * Speichert den laufenden Timer als Schicht mit der angegebenen Pause. Geht – wie jeder andere Weg –
   * durch die Schreibgrenze des Service (`ShiftValidationError`); bei einer Ablehnung wird nichts
   * gespeichert, und der Timer samt seiner Pause bleibt unverändert.
   */
  function save(breakMinutes: number): ShiftValidationError | null {
    if (!timer) return null;
    const startedAt = new Date(timer.startedAt);
    const now = new Date();
    try {
      addShift({
        kind: "arbeit" as const,
        date: isoDate(startedAt),
        start: timeFromDate(startedAt),
        end: timeFromDate(now),
        breakMinutes,
        rate: suggestedRate({ jobId: activeJob?.id }, { jobs, settings }),
        ...(timer.jobId ? { jobId: timer.jobId } : {}),
      });
    } catch (error) {
      // K2: Die Schreibgrenze lehnt eine unmögliche Schicht ab (z. B. Beginn = Ende bei Start und
      // Stopp in derselben Minute). Es wird nichts gespeichert und der Timer läuft weiter –
      // keine Zeit geht still verloren, und es entsteht kein 0-Stunden-Eintrag.
      if (error instanceof ShiftValidationError) return error;
      throw error;
    }
    clearTimer();
    toast.success(t("timer.savedToast"));
    return null;
  }

  /** Erfasste Zeit seit dem Start in Minuten – dieselbe Uhrzeit-Rechnung wie beim Speichern. */
  function elapsedMinutes(): number {
    if (!timer) return 0;
    const diff =
      toMinutes(timeFromDate(new Date())) - toMinutes(timeFromDate(new Date(timer.startedAt)));
    return diff < 0 ? diff + 24 * 60 : diff;
  }

  function stop() {
    if (!timer) return;
    const error = save(timer.breakMinutes);
    if (!error) return;
    const code = error.issues[0]?.code;
    const reason =
      code === "zero-duration"
        ? t("entry.errZeroDuration")
        : code === "break-too-long"
          ? t("entry.errBreakTooLong")
          : t("entry.errInvalidTime");
    toast.error(`${t("timer.notSaved")} ${reason}`);
    // Die Pause ist nicht kürzer als die erfasste Zeit: sie lässt sich hier korrigieren (auch auf 0).
    // Nichts wird automatisch geändert – weder die Pause noch die Arbeitszeit.
    if (code === "break-too-long") {
      setFixBreak(String(timer.breakMinutes));
      setFixRejected(false);
      setFixOpen(true);
    }
  }

  const fixValue = Math.round(Number(fixBreak));
  const fixValid = fixBreak.trim() !== "" && Number.isFinite(fixValue) && fixValue >= 0;

  function bumpFix(delta: number) {
    setFixRejected(false);
    setFixBreak(String(Math.max(0, (fixValid ? fixValue : 0) + delta)));
  }

  function confirmFix() {
    if (!fixValid) return;
    // Wieder durch die Schreibgrenze: ist die Pause noch immer zu lang, bleibt alles unverändert.
    if (save(fixValue) === null) setFixOpen(false);
    else setFixRejected(true);
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

      <Dialog open={fixOpen} onOpenChange={(next) => !next && setFixOpen(false)}>
        <DialogContent data-testid="timer-break-fix">
          <DialogHeader>
            <DialogTitle>{t("timer.fixTitle")}</DialogTitle>
            <DialogDescription>
              {t("timer.fixBody", { pause: timer?.breakMinutes ?? 0, elapsed: elapsedMinutes() })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <label htmlFor="timer-break-fix" className="flex-1 text-sm">
              {t("timer.fixBreakLabel")}
            </label>
            <Button
              type="button"
              variant="ghost"
              className="size-11 shrink-0 rounded-full bg-muted/60"
              aria-label={`${t("entry.break")} −15 ${t("entry.minutesShort")}`}
              onClick={() => bumpFix(-15)}
            >
              <Minus className="size-4" />
            </Button>
            <Input
              id="timer-break-fix"
              data-testid="timer-break-fix-input"
              type="number"
              min="0"
              inputMode="numeric"
              value={fixBreak}
              onChange={(e) => {
                setFixRejected(false);
                setFixBreak(e.target.value);
              }}
              className="h-11 w-20 shrink-0 text-center text-base font-semibold tabular-nums"
            />
            <Button
              type="button"
              variant="ghost"
              className="size-11 shrink-0 rounded-full bg-muted/60"
              aria-label={`${t("entry.break")} +15 ${t("entry.minutesShort")}`}
              onClick={() => bumpFix(15)}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            data-testid="timer-break-fix-zero"
            onClick={() => {
              setFixRejected(false);
              setFixBreak("0");
            }}
          >
            {t("timer.fixNoBreak")}
          </Button>
          {fixRejected ? (
            <p className="text-sm text-destructive" data-testid="timer-break-fix-error">
              {t("timer.fixStillInvalid")}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              data-testid="timer-break-fix-cancel"
              onClick={() => setFixOpen(false)}
            >
              {t("timer.fixCancel")}
            </Button>
            <Button
              type="button"
              className="h-11"
              data-testid="timer-break-fix-save"
              disabled={!fixValid}
              onClick={confirmFix}
            >
              {t("timer.fixSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
