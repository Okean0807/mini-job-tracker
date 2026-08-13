import { Mic, Trash2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";
import { formatDate, formatEuro, formatHours, shiftBreakdown } from "@/lib/minijob/calc";
import { holidayName } from "@/lib/minijob/holidays";
import { deleteShift, newId, saveShift } from "@/lib/minijob/store";
import {
  type Customer,
  type Job,
  type Project,
  type Settings,
  type Shift,
  type ShiftKind,
} from "@/lib/minijob/types";
import { listenOnce, parseVoice, voiceSupported } from "@/lib/minijob/voice";
import { cn } from "@/lib/utils";

interface ShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  shift?: Shift | null;
  jobs: Job[];
  customers: Customer[];
  projects: Project[];
  settings: Settings;
}

const KINDS: ShiftKind[] = ["arbeit", "urlaub", "krank", "feiertag"];

export function ShiftDialog({
  open,
  onOpenChange,
  date,
  shift,
  jobs,
  customers,
  projects,
  settings,
}: ShiftDialogProps) {
  const { t, locale } = useT();
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const [kind, setKind] = useState<ShiftKind>("arbeit");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [breakMinutes, setBreakMinutes] = useState("30");
  const [rate, setRate] = useState(String(settings.defaultRate));
  const [note, setNote] = useState("");
  const [overtime, setOvertime] = useState(false);
  const [customerId, setCustomerId] = useState<string | undefined>(undefined);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [workplace, setWorkplace] = useState("");
  const [tasks, setTasks] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [gps, setGps] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [customTask, setCustomTask] = useState("");

  useEffect(() => {
    if (!open) return;
    const fallbackJob = jobs.find((j) => j.id === settings.activeJobId) ?? jobs[0];
    setJobId(shift?.jobId ?? fallbackJob?.id);
    setKind(shift?.kind ?? "arbeit");
    setStart(shift?.start ?? "09:00");
    setEnd(shift?.end ?? "17:00");
    setBreakMinutes(String(shift?.breakMinutes ?? 30));
    setRate(String(shift?.rate ?? fallbackJob?.rate ?? settings.defaultRate));
    setNote(shift?.note ?? "");
    setOvertime(shift?.overtime ?? false);
    setCustomerId(shift?.customerId);
    setProjectId(shift?.projectId);
  }, [open, shift, jobs, settings.activeJobId, settings.defaultRate]);

  const job = jobs.find((j) => j.id === jobId);
  const holiday = holidayName(date, settings.bundesland);
  const draft: Shift = {
    id: shift?.id ?? "draft",
    kind,
    date,
    start,
    end,
    breakMinutes: Number(breakMinutes) || 0,
    rate: Number(rate.replace(",", ".")) || 0,
    overtime,
  };
  if (jobId) draft.jobId = jobId;
  const preview = shiftBreakdown(draft, {
    job,
    supplements: job?.supplements ?? settings.supplements,
    holiday: Boolean(holiday),
  });

  async function voice() {
    try {
      const text = await listenOnce();
      const parsed = parseVoice(text);
      if (parsed.type === "shift") {
        setStart(parsed.start);
        setEnd(parsed.end);
        setBreakMinutes(String(parsed.breakMinutes));
        toast.success(t("shift.recognized", { start: parsed.start, end: parsed.end }));
      } else {
        setNote(text);
        toast.message(t("shift.noteTaken"), { description: text });
      }
    } catch {
      toast.error(t("shift.voiceError"));
    }
  }

  function save() {
    const next: Shift = {
      id: shift?.id ?? newId(),
      kind,
      date,
      start,
      end,
      breakMinutes: Number(breakMinutes) || 0,
      rate: Number(rate.replace(",", ".")) || 0,
    };
    if (jobId) next.jobId = jobId;
    if (note.trim()) next.note = note.trim();
    if (overtime) next.overtime = true;
    if (customerId) next.customerId = customerId;
    if (projectId) next.projectId = projectId;
    saveShift(next);
    toast.success(shift ? t("shift.updated") : t("shift.saved"));
    onOpenChange(false);
  }

  const selfEmployed = job?.mode === "selbststaendig";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{shift ? t("shift.editTitle") : t("shift.newTitle")}</DialogTitle>
          <DialogDescription>
            {formatDate(date, locale)}
            {holiday ? ` · ${holiday}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {jobs.length > 1 ? (
            <div className="grid gap-2">
              <Label>{t("label.job")}</Label>
              <div className="flex flex-wrap gap-2">
                {jobs.map((j) => (
                  <button
                    key={j.id}
                    type="button"
                    onClick={() => {
                      setJobId(j.id);
                      setRate(String(j.rate));
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
                      jobId === j.id ? "border-primary bg-primary/10" : "bg-card",
                    )}
                  >
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: j.color }} />
                    {j.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label>{t("label.kind")}</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-lg border px-2 py-1.5 text-xs font-medium",
                    kind === k ? "border-primary bg-primary/10" : "bg-card",
                  )}
                >
                  {t("kind." + k)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="von">{t("label.start")}</Label>
              <Input id="von" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bis">{t("label.end")}</Label>
              <Input id="bis" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="pause">{t("label.breakMinutes")}</Label>
              <Input
                id="pause"
                type="number"
                min="0"
                inputMode="numeric"
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lohn">{t("label.rateEuro")}</Label>
              <Input
                id="lohn"
                type="number"
                step="0.5"
                min="0"
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
          </div>

          {selfEmployed ? (
            <div className="grid gap-3 rounded-xl border p-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("label.customer")}</Label>
                <select
                  value={customerId ?? ""}
                  onChange={(e) => setCustomerId(e.target.value || undefined)}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">{t("shift.noCustomer")}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("label.project")}</Label>
                <select
                  value={projectId ?? ""}
                  onChange={(e) => setProjectId(e.target.value || undefined)}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">{t("shift.noProject")}</option>
                  {projects
                    .filter((p) => !customerId || p.customerId === customerId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between rounded-xl border p-3">
            <div>
              <p className="text-sm font-medium">{t("shift.overtimeTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("shift.overtimeDesc")}</p>
            </div>
            <Switch checked={overtime} onCheckedChange={setOvertime} aria-label={t("shift.overtimeAria")} />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="notiz">{t("label.note")}</Label>
              {voiceSupported() ? (
                <Button variant="ghost" size="sm" onClick={voice}>
                  <Mic className="size-4" /> {t("shift.voice")}
                </Button>
              ) : null}
            </div>
            <Textarea
              id="notiz"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("shift.notePlaceholder")}
            />
          </div>

          <div className="rounded-xl bg-muted p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("shift.duration")}</span>
              <span className="font-semibold tabular-nums">{formatHours(preview.hours, locale)}</span>
            </div>
            {preview.bonus > 0 ? (
              <div className="mt-1 flex justify-between">
                <span className="text-muted-foreground">
                  {t("shift.bonusLabel", { labels: preview.labels.join(", ") })}
                </span>
                <span className="font-semibold tabular-nums">{formatEuro(preview.bonus, locale)}</span>
              </div>
            ) : null}
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">{t("label.earnings")}</span>
              <span className="font-semibold tabular-nums">{formatEuro(preview.total, locale)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-2 gap-2 sm:justify-between">
          {shift ? (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                deleteShift(shift.id);
                toast.success(t("shift.deleted"));
                onOpenChange(false);
              }}
            >
              <Trash2 className="size-4" /> {t("action.delete")}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={save}>{t("action.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
