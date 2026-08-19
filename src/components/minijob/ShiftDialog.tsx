import { Camera, ChevronDown, MapPin, Mic, Trash2, X } from "lucide-react";
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
import { addShift, removeShift, upsertShift } from "@/lib/minijob/service";
import { newId, updateSettings } from "@/lib/minijob/store";
import {
  type Customer,
  type Job,
  type Project,
  type Settings,
  type Shift,
  type ShiftKind,
} from "@/lib/minijob/types";
import { WORK_CODES, WORK_CODE_LABELS } from "@/lib/minijob/arbeitsnachweis";
import { listenOnce, parseVoice, voiceSupported } from "@/lib/minijob/voice";
import {
  CLEANING_TASKS,
  compressPhoto,
  currentPosition,
  formatGps,
  templateValue,
} from "@/lib/minijob/worklog";
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
  const [street, setStreet] = useState("");
  const [houseNo, setHouseNo] = useState("");
  const [floor, setFloor] = useState("");
  const [doorSide, setDoorSide] = useState("");
  const [workCode, setWorkCode] = useState("");
  const [workCodeNote, setWorkCodeNote] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newCodeLabel, setNewCodeLabel] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const customCodes = settings.workCodes ?? [];

  const allCodes = [
    ...WORK_CODES.map((code) => ({ code: code as string, label: WORK_CODE_LABELS[code] })),
    ...customCodes,
  ];

  function addCustomCode() {
    const code = newCode.trim().toUpperCase();
    const label = newCodeLabel.trim();
    if (!code || !label) return;
    if (allCodes.some((c) => c.code === code)) {
      toast.error(t("worklog.codeExists"));
      return;
    }
    updateSettings({ workCodes: [...customCodes, { code, label }] });
    setWorkCode(code);
    setNewCode("");
    setNewCodeLabel("");
  }

  function removeCustomCode(code: string) {
    updateSettings({ workCodes: customCodes.filter((c) => c.code !== code) });
    if (workCode === code) setWorkCode("");
  }

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
    setWorkplace(shift?.workplace ?? "");
    setTasks(shift?.tasks ?? []);
    setPhotos(shift?.photos ?? []);
    setGps(shift?.gps);
    setCustomTask("");
    setStreet(shift?.street ?? "");
    setHouseNo(shift?.houseNo ?? "");
    setFloor(shift?.floor ?? "");
    setDoorSide(shift?.doorSide ?? "");
    setWorkCode(shift?.workCode ?? "");
    setWorkCodeNote(shift?.workCodeNote ?? "");
    setAdvanced(
      Boolean(
        shift &&
          (shift.workplace ||
            shift.street ||
            shift.floor ||
            shift.doorSide ||
            shift.workCode ||
            shift.note ||
            shift.overtime ||
            shift.customerId ||
            (shift.tasks?.length ?? 0) > 0 ||
            (shift.photos?.length ?? 0) > 0 ||
            shift.gps),
      ),
    );
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
    if (workplace.trim()) next.workplace = workplace.trim();
    if (tasks.length > 0) next.tasks = tasks;
    if (photos.length > 0) next.photos = photos;
    if (gps) next.gps = gps;
    if (street.trim()) next.street = street.trim();
    if (houseNo.trim()) next.houseNo = houseNo.trim();
    if (floor.trim()) next.floor = floor.trim();
    if (doorSide.trim()) next.doorSide = doorSide.trim();
    if (workCode) next.workCode = workCode;
    if (workCode && workCodeNote.trim()) next.workCodeNote = workCodeNote.trim();
    next.createdAt = shift?.createdAt ?? new Date().toISOString().slice(0, 10);
    if (shift) {
      // vollständiger Datensatz -> id-erhaltendes Überschreiben (identisch zum bisherigen saveShift)
      upsertShift(next);
    } else {
      const { id: _id, ...input } = next;
      addShift(input);
    }
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

          {!advanced ? (
            <p className="text-xs text-muted-foreground">{t("entry.quickHint")}</p>
          ) : null}

          <Button
            type="button"
            variant="outline"
            className="w-full justify-between"
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
          >
            {advanced ? t("entry.less") : t("entry.more")}
            <ChevronDown className={cn("size-4 transition-transform", advanced && "rotate-180")} />
          </Button>

          {advanced ? (
            <div className="space-y-4">
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

          <div className="grid gap-3 rounded-xl border p-3">
            <p className="text-sm font-semibold">{t("worklog.section")}</p>

            <div className="grid gap-1.5">
              <Label htmlFor="einsatzort" className="text-xs">
                {t("worklog.workplace")}
              </Label>
              <Input
                id="einsatzort"
                value={workplace}
                placeholder={t("worklog.workplacePlaceholder")}
                onChange={(e) => setWorkplace(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-[2fr_1fr] gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="strasse" className="text-xs">
                  {t("worklog.street")}
                </Label>
                <Input
                  id="strasse"
                  value={street}
                  placeholder={t("worklog.streetPlaceholder")}
                  onChange={(e) => setStreet(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="hausnr" className="text-xs">
                  {t("worklog.houseNo")}
                </Label>
                <Input
                  id="hausnr"
                  value={houseNo}
                  placeholder="15"
                  onChange={(e) => setHouseNo(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="etage" className="text-xs">
                  {t("worklog.floor")}
                </Label>
                <Input
                  id="etage"
                  value={floor}
                  placeholder={t("worklog.floorPlaceholder")}
                  onChange={(e) => setFloor(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tuerseite" className="text-xs">
                  {t("worklog.doorSide")}
                </Label>
                <Input
                  id="tuerseite"
                  value={doorSide}
                  placeholder={t("worklog.doorSidePlaceholder")}
                  onChange={(e) => setDoorSide(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs">{t("worklog.workCode")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {allCodes.map(({ code, label }) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setWorkCode(workCode === code ? "" : code)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium",
                      workCode === code ? "border-primary bg-primary/10" : "bg-card",
                    )}
                  >
                    {code} · {label}
                  </button>
                ))}
              </div>
              {workCode ? (
                <Input
                  value={workCodeNote}
                  placeholder={t("worklog.workCodeNotePlaceholder")}
                  onChange={(e) => setWorkCodeNote(e.target.value)}
                />
              ) : null}
              <div className="grid grid-cols-[70px_1fr_auto] gap-1.5">
                <Input
                  value={newCode}
                  maxLength={4}
                  placeholder={t("worklog.codeShort")}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                />
                <Input
                  value={newCodeLabel}
                  placeholder={t("worklog.codeLabel")}
                  onChange={(e) => setNewCodeLabel(e.target.value)}
                />
                <Button type="button" variant="secondary" size="sm" onClick={addCustomCode}>
                  {t("worklog.addTask")}
                </Button>
              </div>
              {customCodes.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {customCodes.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => removeCustomCode(c.code)}
                      className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground"
                    >
                      {c.code}
                      <X className="size-3" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs">{t("worklog.tasks")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {CLEANING_TASKS.map((key) => {
                  const value = templateValue(key);
                  const active = tasks.includes(value);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setTasks(
                          active ? tasks.filter((x) => x !== value) : [...tasks, value],
                        )
                      }
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-medium",
                        active ? "border-primary bg-primary/10" : "bg-card",
                      )}
                    >
                      {t(`task.${key}`)}
                    </button>
                  );
                })}
              </div>
              {tasks.some((x) => !x.startsWith("#")) ? (
                <div className="flex flex-wrap gap-1.5">
                  {tasks
                    .filter((x) => !x.startsWith("#"))
                    .map((x) => (
                      <button
                        key={x}
                        type="button"
                        onClick={() => setTasks(tasks.filter((y) => y !== x))}
                        className="flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs"
                      >
                        {x}
                        <X className="size-3" />
                      </button>
                    ))}
                </div>
              ) : null}
              <div className="flex gap-2">
                <Input
                  value={customTask}
                  placeholder={t("worklog.customTask")}
                  onChange={(e) => setCustomTask(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const value = customTask.trim();
                    if (!value || tasks.includes(value)) return;
                    setTasks([...tasks, value]);
                    setCustomTask("");
                  }}
                >
                  {t("worklog.addTask")}
                </Button>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs">{t("worklog.photos")}</Label>
              {photos.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {photos.map((src, i) => (
                    <div key={src.slice(-24) + i} className="relative">
                      <img
                        src={src}
                        alt={t("worklog.photos")}
                        className="size-16 rounded-lg object-cover"
                      />
                      <button
                        type="button"
                        aria-label={t("worklog.remove")}
                        onClick={() => setPhotos(photos.filter((_, idx) => idx !== i))}
                        className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium">
                <Camera className="size-4" />
                {t("worklog.addPhoto")}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = "";
                    try {
                      const next = await Promise.all(files.map((f) => compressPhoto(f)));
                      setPhotos((prev) => [...prev, ...next]);
                    } catch {
                      toast.error(t("worklog.photoError"));
                    }
                  }}
                />
              </label>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-xs">
                <p className="font-medium">{t("worklog.gps")}</p>
                <p className="text-muted-foreground">{gps ? formatGps(gps) : "–"}</p>
              </div>
              <div className="flex gap-1">
                {gps ? (
                  <Button variant="ghost" size="sm" onClick={() => setGps(undefined)}>
                    <X className="size-4" />
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      setGps(await currentPosition());
                    } catch {
                      toast.error(t("worklog.gpsError"));
                    }
                  }}
                >
                  <MapPin className="size-4" /> {t("worklog.gpsAdd")}
                </Button>
              </div>
            </div>
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
            </div>
          ) : null}


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
