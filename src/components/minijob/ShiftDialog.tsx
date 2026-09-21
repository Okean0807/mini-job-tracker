import { CalendarDays, Camera, ChevronDown, ChevronLeft, ChevronRight, MapPin, Mic, Minus, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";
import { formatEuro, formatHours, isoDate, shiftBreakdown } from "@/lib/minijob/calc";
import { shiftPayroll } from "@/lib/minijob/payroll";
import { holidayName } from "@/lib/minijob/holidays";
import { parseRateInput, suggestedRate } from "@/lib/minijob/rate";
import { ObjectDialog } from "@/components/minijob/ObjectDialog";
import { persistDialogShift, removeShift, getShift } from "@/lib/minijob/service";
import {
  type Customer,
  type Job,
  type Project,
  type Settings,
  type Shift,
  type ShiftKind,
  type WorkObject,
} from "@/lib/minijob/types";
import {
  applyObjectToFormFields,
  objectAddressPreview,
  resolveEntryDate,
  withEntryDate,
} from "@/lib/minijob/work-objects";
import {
  applyWorkCodeToFormFields,
  builtinWorkCodes,
  findPredefinedTaskValue,
  findWorkCodeDef,
  normalizeCatalogText,
  normalizeWorkCode,
  snapshotWorkCodeLabel,
} from "@/lib/minijob/catalog";
import { listenOnce, parseVoice, voiceSupported } from "@/lib/minijob/voice";
import {
  applyReverseOrKeep,
  formatGermanAddress,
  reverseGeocodeGerman,
} from "@/lib/minijob/geo-address";
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
  /** Stable Shift.id when editing; empty/null means CREATE. */
  shiftId?: string | null;
  jobs: Job[];
  customers: Customer[];
  projects: Project[];
  settings: Settings;
  objects?: WorkObject[];
  /** When set, choosing Urlaub/Krank closes this dialog and opens AbsenceDialog (From–To). */
  onRequestAbsence?: (kind: "urlaub" | "krank" | "frei" | "sonstige", date: string) => void;
}

const KINDS: ShiftKind[] = ["arbeit", "urlaub", "krank", "feiertag", "frei", "sonstige"];

function formatEntryDate(iso: string, locale: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

function keepFieldVisible(event: { currentTarget: HTMLElement }) {
  event.currentTarget.scrollIntoView({ block: "center", inline: "nearest" });
}

export function ShiftDialog({
  open,
  onOpenChange,
  date,
  shift,
  shiftId,
  jobs,
  customers,
  projects,
  settings,
  objects = [],
  onRequestAbsence,
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
  const [zip, setZip] = useState("");
  const [city, setCity] = useState("");
  const [gpsBusy, setGpsBusy] = useState(false);
  const [floor, setFloor] = useState("");
  const [doorSide, setDoorSide] = useState("");
  const [workCode, setWorkCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newCodeLabel, setNewCodeLabel] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [objectDetailsOpen, setObjectDetailsOpen] = useState(false);
  const [newCodeOpen, setNewCodeOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [fieldError, setFieldError] = useState<{ start?: string; end?: string }>({});
  const [entryDate, setEntryDate] = useState(date);
  const [objectId, setObjectId] = useState<string | undefined>(undefined);
  const [objectDialogOpen, setObjectDialogOpen] = useState(false);
  const editingIdRef = useRef<string | undefined>(undefined);
  const resolvedShiftId = (shiftId ?? shift?.id ?? "").trim() || undefined;
  const isEditing = Boolean(resolvedShiftId);
  const customCodes = settings.workCodes ?? [];
  const customTasksCatalog = settings.customTasks ?? [];
  const predefinedTaskLabels = CLEANING_TASKS.map((key) => ({
    key,
    label: t(`task.${key}`),
  }));

  const builtinCodes = builtinWorkCodes();
  const activeWorkCode = normalizeWorkCode(newCode || workCode);
  const selectedWork = findWorkCodeDef(customCodes, activeWorkCode);

  function applyWorkCodeSelection(code: string) {
    if (!code) {
      setWorkCode("");
      setNewCode("");
      setNewCodeLabel("");
      return;
    }
    const item = findWorkCodeDef(customCodes, code);
    if (!item) {
      setWorkCode("");
      setNewCode("");
      setNewCodeLabel("");
      return;
    }
    const fields = applyWorkCodeToFormFields(item);
    setWorkCode(fields.workCode);
    setNewCode(fields.workCode);
    setNewCodeLabel(fields.workCodeLabel);
  }

  function applyTaskSelection(value: string) {
    if (!value) return;
    if (!tasks.includes(value)) setTasks([...tasks, value]);
  }

  function taskEntryLabel(value: string) {
    if (value.startsWith("#")) return t(`task.${value.slice(1)}`);
    return value;
  }

  function addTaskToEntry() {
    const raw = normalizeCatalogText(customTask);
    if (!raw) return;
    const predefined = findPredefinedTaskValue(raw, predefinedTaskLabels);
    const value = predefined ?? raw;
    if (!tasks.includes(value)) setTasks([...tasks, value]);
    setCustomTask("");
  }

  useEffect(() => {
    if (!open) return;
    const id = (shiftId ?? shift?.id ?? "").trim() || undefined;
    editingIdRef.current = id;
    const source = id ? (getShift(id) ?? shift ?? null) : null;
    const fallbackJob = jobs.find((j) => j.id === settings.activeJobId) ?? jobs[0];
    const initialDate = resolveEntryDate(source ?? undefined, date);
    setEntryDate(initialDate);
    setObjectId(source?.objectId);
    setJobId(source?.jobId ?? fallbackJob?.id);
    // Existing entries keep their kind (incl. Feiertag). New entries on a
    // public holiday default to feiertag so the type matches the calendar day.
    const holidayDefault =
      !source && holidayName(initialDate, settings.bundesland) ? "feiertag" : "arbeit";
    setKind(source?.kind ?? holidayDefault);
    setStart(source?.start ?? "09:00");
    setEnd(source?.end ?? "17:00");
    setBreakMinutes(String(source?.breakMinutes ?? 30));
    setRate(
      source
        ? typeof source.rate === "number"
          ? String(source.rate)
          : ""
        : String(suggestedRate({ jobId: fallbackJob?.id }, { jobs, settings })),
    );
    setNote(source?.note ?? "");
    setOvertime(source?.overtime ?? false);
    setCustomerId(source?.customerId);
    setProjectId(source?.projectId);
    setWorkplace(source?.workplace ?? "");
    setTasks(source?.tasks ?? []);
    setPhotos(source?.photos ?? []);
    setGps(source?.gps);
    setCustomTask("");
    setStreet(source?.street ?? "");
    setHouseNo(source?.houseNo ?? "");
    setZip(source?.zip ?? "");
    setCity(source?.city ?? "");
    setGpsBusy(false);
    setFloor(source?.floor ?? "");
    setDoorSide(source?.doorSide ?? "");
    setWorkCode(source?.workCode ?? "");
    setNewCode(source?.workCode ?? "");
    setNewCodeLabel(source?.workCodeLabel ?? "");
    setAdvanced(
      Boolean(
        source &&
          (source.note ||
            source.overtime ||
            source.customerId ||
            source.projectId ||
            (source.photos?.length ?? 0) > 0 ||
            source.gps),
      ),
    );
    setObjectDetailsOpen(false);
    setNewCodeOpen(false);
    setNewTaskOpen(false);
    setFieldError({});
  }, [open, shiftId, shift?.id, jobs, settings.activeJobId, settings.defaultRate, settings.bundesland, date]);


  const job = jobs.find((j) => j.id === jobId);
  const holiday = holidayName(entryDate, settings.bundesland);
  const selectedObject = objects.find((o) => o.id === objectId);
  const draft: Shift = {
    id: shift?.id ?? "draft",
    kind,
    date: entryDate,
    start,
    end,
    breakMinutes: Number(breakMinutes) || 0,
    overtime,
  };
  const parsedRate = parseRateInput(rate);
  if (parsedRate !== undefined) draft.rate = parsedRate;
  if (jobId) draft.jobId = jobId;

  // Work on a public holiday must pay hours×rate (optional surcharge). Kind "feiertag"
  // is only for not working. Preview uses payroll for absences and breakdown for work.
  const workPreview = shiftBreakdown(draft, {
    job,
    supplements: job?.supplements ?? settings.supplements,
    holiday: Boolean(holiday),
    defaultRate: settings.defaultRate,
  });
  const absencePreview = shiftPayroll(draft, {
    job,
    supplements: job?.supplements ?? settings.supplements,
    holiday: Boolean(holiday),
    defaultRate: settings.defaultRate,
  });
  const preview =
    kind === "arbeit"
      ? {
          hours: workPreview.hours,
          bonus: workPreview.bonus,
          total: workPreview.total,
          labels: workPreview.labels,
        }
      : {
          hours: absencePreview.paidAbsenceHours,
          bonus: 0,
          total: absencePreview.earnings,
          labels: [] as string[],
        };

  function selectKind(next: ShiftKind) {
    if (
      (next === "urlaub" || next === "krank" || next === "frei" || next === "sonstige") &&
      onRequestAbsence &&
      !isEditing
    ) {
      onRequestAbsence(next, entryDate);
      onOpenChange(false);
      return;
    }
    setKind(next);
  }

  function onStartChange(value: string) {
    setStart(value);
    // Entering/changing times on a holiday means the user worked → force "arbeit".
    if (holiday && kind === "feiertag") setKind("arbeit");
  }

  function onEndChange(value: string) {
    setEnd(value);
    if (holiday && kind === "feiertag") setKind("arbeit");
  }

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

  function applyObjectSelection(id: string) {
    if (!id) {
      setObjectId(undefined);
      return;
    }
    const obj = objects.find((o) => o.id === id);
    if (!obj) {
      setObjectId(undefined);
      return;
    }
    const fields = applyObjectToFormFields(obj);
    setObjectId(fields.objectId);
    setWorkplace(fields.workplace);
    setStreet(fields.street);
    setHouseNo(fields.houseNo);
    setFloor(fields.floor);
    setDoorSide(fields.doorSide);
    setZip(fields.zip);
    setCity(fields.city);
  }

  function onObjectSaved(obj: WorkObject) {
    const fields = applyObjectToFormFields(obj);
    setObjectId(fields.objectId);
    setWorkplace(fields.workplace);
    setStreet(fields.street);
    setHouseNo(fields.houseNo);
    setFloor(fields.floor);
    setDoorSide(fields.doorSide);
    setZip(fields.zip);
    setCity(fields.city);
    setObjectDetailsOpen(true);
  }

  function save() {
    if (kind === "arbeit" && (!start || !end)) {
      setFieldError({
        ...(start ? {} : { start: t("entry.requiredStart") }),
        ...(end ? {} : { end: t("entry.requiredEnd") }),
      });
      return;
    }
    setFieldError({});
    const editingId = editingIdRef.current;
    const existing = editingId ? getShift(editingId) : undefined;
    const next: Shift = withEntryDate(
      {
        id: editingId || existing?.id || "new",
        kind,
        date: entryDate,
        start,
        end,
        breakMinutes: Number(breakMinutes) || 0,
      },
      entryDate,
    );
    const rateValue = parseRateInput(rate);
    if (rateValue !== undefined) next.rate = rateValue;
    if (jobId) next.jobId = jobId;
    if (note.trim()) next.note = note.trim();
    if (overtime) next.overtime = true;
    if (customerId) next.customerId = customerId;
    if (projectId) next.projectId = projectId;
    if (objectId) next.objectId = objectId;
    if (workplace.trim()) next.workplace = workplace.trim();
    const pendingTask = normalizeCatalogText(customTask);
    const entryTasks = [...tasks];
    if (pendingTask) {
      const predefined = findPredefinedTaskValue(pendingTask, predefinedTaskLabels);
      const value = predefined ?? pendingTask;
      if (!entryTasks.includes(value)) entryTasks.push(value);
    }
    if (entryTasks.length > 0) next.tasks = entryTasks;
    if (photos.length > 0) next.photos = photos;
    if (gps) next.gps = gps;
    if (street.trim()) next.street = street.trim();
    if (houseNo.trim()) next.houseNo = houseNo.trim();
    if (zip.trim()) next.zip = zip.trim();
    if (city.trim()) next.city = city.trim();
    if (floor.trim()) next.floor = floor.trim();
    if (doorSide.trim()) next.doorSide = doorSide.trim();
    const code = normalizeWorkCode(newCode || workCode);
    const label = normalizeCatalogText(newCodeLabel);
    if (code) {
      next.workCode = code;
      if (label) {
        next.workCodeLabel = label;
      } else {
        const snapshot = snapshotWorkCodeLabel({
          selectedCode: code,
          catalog: customCodes,
          previousCode: existing?.workCode ?? shift?.workCode,
          previousLabel: existing?.workCodeLabel ?? shift?.workCodeLabel,
        });
        if (snapshot) next.workCodeLabel = snapshot;
      }
    }
    const noteSource = existing ?? shift;
    if (noteSource?.workCodeNote?.trim()) next.workCodeNote = noteSource.workCodeNote.trim();
    next.createdAt = noteSource?.createdAt ?? isoDate(new Date());
    persistDialogShift(next, editingId);
    toast.success(editingId ? t("shift.updated") : t("shift.saved"));
    onOpenChange(false);
  }


  const selfEmployed = job?.mode === "selbststaendig";
  const isWork = kind === "arbeit";
  const hourlyPay = isWork && job?.payType !== "monthly" && !selfEmployed;
  const longDate = formatEntryDate(entryDate, locale);
  const placeLine = [street, houseNo]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  const cityLine = [zip, city]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  const objectTitle =
    selectedObject?.name || workplace.trim() || placeLine || t("entry.chooseObject");
  const objectMeta =
    (selectedObject ? objectAddressPreview(selectedObject) : "") ||
    [placeLine, cityLine].filter(Boolean).join(" · ");

  function bumpBreak(delta: number) {
    const next = Math.max(0, (Number(breakMinutes) || 0) + delta);
    setBreakMinutes(String(next));
  }

  const noteField = (
    <div className="grid gap-1">
      <div className="flex items-center justify-between">
        <Label htmlFor="notiz">{t("label.note")}</Label>
        {voiceSupported() ? (
          <Button type="button" variant="ghost" className="h-11" onClick={voice}>
            <Mic className="size-4" /> {t("shift.voice")}
          </Button>
        ) : null}
      </div>
      <Textarea
        id="notiz"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onFocus={keepFieldVisible}
        placeholder={t("shift.notePlaceholder")}
      />
    </div>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:left-[50%] sm:top-[50%] sm:h-[min(92dvh,840px)] sm:max-w-md sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl [&>button]:hidden"
          data-testid="shift-dialog"
          data-mode={isEditing ? "edit" : "new"}
          data-shift-id={resolvedShiftId || undefined}
          data-work={isWork ? "1" : "0"}
        >
          <header
            data-testid="entry-header"
            className="shrink-0 border-b bg-background px-2 pt-[max(0.25rem,env(safe-area-inset-top))]"
          >
            <button
              type="button"
              className="inline-flex h-11 items-center gap-1 px-2 text-sm font-medium"
              onClick={() => onOpenChange(false)}
            >
              <ChevronLeft className="size-5" />
              {t("action.back")}
            </button>
            <DialogHeader className="space-y-0.5 px-3 pb-3 text-left">
              <DialogTitle className="text-left text-lg">
                {isEditing ? t("shift.editTitle") : t("shift.newTitle")}
              </DialogTitle>
              <DialogDescription className="text-left text-sm font-medium text-foreground">
                {longDate}
                {holiday ? ` · ${holiday}` : ""}
              </DialogDescription>
            </DialogHeader>
          </header>

          <div
            data-testid="entry-editor-scroll"
            className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4"
          >
            <label className="relative flex min-h-11 items-center gap-3 rounded-2xl border bg-card px-3 py-2.5">
              <CalendarDays className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("label.date")}
                </span>
                <span className="block truncate text-sm font-semibold">{longDate}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                id="eintrag-datum"
                data-testid="entry-date"
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                onFocus={keepFieldVisible}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>

            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("label.job")}
              </p>
              {jobs.length > 1 ? (
                <div className="flex flex-wrap gap-2">
                  {jobs.map((j) => (
                    <button
                      key={j.id}
                      type="button"
                      onClick={() => {
                        setJobId(j.id);
                        setRate(String(suggestedRate({ jobId: j.id }, { jobs, settings })));
                      }}
                      className={cn(
                        "inline-flex h-11 items-center gap-2 rounded-full border px-3 text-sm font-medium",
                        jobId === j.id ? "border-primary bg-primary/15 text-foreground" : "bg-card",
                      )}
                    >
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: j.color }} />
                      {j.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-medium">{job?.name ?? t("timer.noJob")}</p>
              )}
            </section>

            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("label.kind")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    data-kind={k}
                    onClick={() => selectKind(k)}
                    className={cn(
                      "h-11 rounded-xl border px-2 text-sm font-medium",
                      kind === k ? "border-primary bg-primary/15" : "bg-card",
                    )}
                  >
                    {t("kind." + k)}
                  </button>
                ))}
              </div>
            </section>

            {holiday ? (
              <div
                className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-3 text-sm text-violet-950 dark:text-violet-100"
                data-testid="holiday-pay-hint"
              >
                <p className="font-medium">{t("shift.holidayBannerTitle", { name: holiday })}</p>
                <p className="mt-1 text-xs text-muted-foreground dark:text-violet-200/80">
                  {kind === "arbeit"
                    ? t(
                        (job?.supplements ?? settings.supplements).holiday.enabled
                          ? "shift.holidayWorkWithBonus"
                          : "shift.holidayWorkNoBonus",
                      )
                    : t("shift.holidayNoWork")}
                </p>
                {kind === "feiertag" ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2 h-11"
                    onClick={() => selectKind("arbeit")}
                  >
                    {t("shift.markAsWorked")}
                  </Button>
                ) : null}
              </div>
            ) : null}

            {isWork ? (
              <>
                <section>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("entry.workTime")}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="grid gap-1">
                      <Label htmlFor="von">{t("label.start")}</Label>
                      <Input
                        id="von"
                        type="time"
                        value={start}
                        onChange={(e) => {
                          setFieldError((prev) => {
                            const next = { ...prev };
                            delete next.start;
                            return next;
                          });
                          onStartChange(e.target.value);
                        }}
                        onFocus={keepFieldVisible}
                        className="h-11"
                      />
                      {fieldError.start ? (
                        <p className="text-xs text-destructive">{fieldError.start}</p>
                      ) : null}
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="bis">{t("label.end")}</Label>
                      <Input
                        id="bis"
                        type="time"
                        value={end}
                        onChange={(e) => {
                          setFieldError((prev) => {
                            const next = { ...prev };
                            delete next.end;
                            return next;
                          });
                          onEndChange(e.target.value);
                        }}
                        onFocus={keepFieldVisible}
                        className="h-11"
                      />
                      {fieldError.end ? (
                        <p className="text-xs text-destructive">{fieldError.end}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-11 shrink-0"
                      aria-label="-"
                      onClick={() => bumpBreak(-15)}
                    >
                      <Minus className="size-4" />
                    </Button>
                    <Input
                      id="pause"
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={breakMinutes}
                      onChange={(e) => setBreakMinutes(e.target.value)}
                      onFocus={keepFieldVisible}
                      aria-label={t("label.breakMinutes")}
                      className="h-11 w-20 text-center"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-11 shrink-0"
                      aria-label="+"
                      onClick={() => bumpBreak(15)}
                    >
                      <Plus className="size-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">{t("entry.minutes")}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold tabular-nums">
                    {formatHours(preview.hours, locale)} {t("shift.duration").toLowerCase()}
                  </p>
                  {preview.bonus > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t("shift.bonusLabel", { labels: preview.labels.join(", ") })} ·{" "}
                      {formatEuro(preview.bonus, locale)}
                    </p>
                  ) : null}
                  {hourlyPay ? (
                    <div className="mt-3 grid gap-1">
                      <Label htmlFor="lohn">{t("label.rateEuro")}</Label>
                      <Input
                        id="lohn"
                        type="number"
                        step="0.5"
                        min="0"
                        inputMode="decimal"
                        value={rate}
                        onChange={(e) => setRate(e.target.value)}
                        onFocus={keepFieldVisible}
                        className="h-11"
                      />
                    </div>
                  ) : null}
                  {!isEditing ? (
                    <p className="mt-2 text-xs text-muted-foreground">{t("shift.multiSameDayHint")}</p>
                  ) : null}
                </section>

                <section>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("worklog.workplace")}
                  </p>
                  <div className="relative rounded-2xl border bg-card px-3 py-3">
                    <p className="pr-6 text-sm font-semibold">{objectTitle}</p>
                    {objectMeta ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{objectMeta}</p>
                    ) : null}
                    <ChevronRight
                      className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Label className="sr-only">{t("object.select")}</Label>
                    <select
                      data-testid="object-select"
                      value={objectId ?? ""}
                      onChange={(e) => applyObjectSelection(e.target.value)}
                      className="absolute inset-0 cursor-pointer opacity-0"
                    >
                      <option value="">{t("object.none")}</option>
                      {objects.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      onClick={() => setObjectDialogOpen(true)}
                    >
                      <Plus className="size-4" /> {t("object.new")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11"
                      aria-expanded={objectDetailsOpen}
                      onClick={() => setObjectDetailsOpen((v) => !v)}
                    >
                      {t("entry.changeObject")}
                    </Button>
                  </div>
                  {objectDetailsOpen ? (
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-1">
                        <Label htmlFor="einsatzort" className="text-xs">
                          {t("worklog.workplace")}
                        </Label>
                        <Input
                          id="einsatzort"
                          value={workplace}
                          placeholder={t("worklog.workplacePlaceholder")}
                          onChange={(e) => setWorkplace(e.target.value)}
                          onFocus={keepFieldVisible}
                          className="h-11"
                        />
                      </div>
                      <div className="grid grid-cols-[2fr_1fr] gap-2">
                        <div className="grid gap-1">
                          <Label htmlFor="strasse" className="text-xs">
                            {t("worklog.street")}
                          </Label>
                          <Input
                            id="strasse"
                            value={street}
                            placeholder={t("worklog.streetPlaceholder")}
                            onChange={(e) => setStreet(e.target.value)}
                            onFocus={keepFieldVisible}
                            className="h-11"
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor="hausnr" className="text-xs">
                            {t("worklog.houseNo")}
                          </Label>
                          <Input
                            id="hausnr"
                            value={houseNo}
                            placeholder="15"
                            onChange={(e) => setHouseNo(e.target.value)}
                            onFocus={keepFieldVisible}
                            className="h-11"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-[1fr_2fr] gap-2">
                        <div className="grid gap-1">
                          <Label htmlFor="plz" className="text-xs">
                            {t("worklog.zip")}
                          </Label>
                          <Input
                            id="plz"
                            value={zip}
                            inputMode="numeric"
                            placeholder={t("worklog.zipPlaceholder")}
                            onChange={(e) => setZip(e.target.value)}
                            onFocus={keepFieldVisible}
                            className="h-11"
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor="ort" className="text-xs">
                            {t("worklog.city")}
                          </Label>
                          <Input
                            id="ort"
                            value={city}
                            placeholder={t("worklog.cityPlaceholder")}
                            onChange={(e) => setCity(e.target.value)}
                            onFocus={keepFieldVisible}
                            className="h-11"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="grid gap-1">
                          <Label htmlFor="etage" className="text-xs">
                            {t("worklog.floor")}
                          </Label>
                          <Input
                            id="etage"
                            value={floor}
                            placeholder={t("worklog.floorPlaceholder")}
                            onChange={(e) => setFloor(e.target.value)}
                            onFocus={keepFieldVisible}
                            className="h-11"
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor="tuerseite" className="text-xs">
                            {t("worklog.doorSide")}
                          </Label>
                          <Input
                            id="tuerseite"
                            value={doorSide}
                            placeholder={t("worklog.doorSidePlaceholder")}
                            onChange={(e) => setDoorSide(e.target.value)}
                            onFocus={keepFieldVisible}
                            className="h-11"
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>

                <section>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("worklog.workCode")}
                  </p>
                  <select
                    data-testid="work-code-select"
                    value={selectedWork?.code ?? ""}
                    onChange={(e) => applyWorkCodeSelection(e.target.value)}
                    className="h-11 w-full rounded-xl border bg-card px-3 text-sm"
                  >
                    <option value="">{t("worklog.none")}</option>
                    <optgroup label={t("worklog.standard")}>
                      {builtinCodes.map(({ code, label }) => (
                        <option key={code} value={code}>
                          {code} · {label}
                        </option>
                      ))}
                    </optgroup>
                    {customCodes.length > 0 ? (
                      <optgroup label={t("worklog.saved")}>
                        {customCodes.map(({ code, label }) => (
                          <option key={`saved-${code}`} value={code}>
                            {code} · {label}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                  {selectedWork ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedWork.code}
                      <span className="mt-0.5 block text-sm font-medium text-foreground">
                        {selectedWork.label}
                      </span>
                    </p>
                  ) : null}
                  {customCodes.length > 0 ? (
                    <div className="mt-3">
                      <p className="mb-1.5 text-xs text-muted-foreground">{t("worklog.myWorkCodes")}</p>
                      <div className="flex flex-wrap gap-2">
                        {customCodes.map((item) => (
                          <button
                            key={item.code}
                            type="button"
                            onClick={() => applyWorkCodeSelection(item.code)}
                            className={cn(
                              "h-11 rounded-full border px-3 text-sm",
                              normalizeWorkCode(item.code) === activeWorkCode
                                ? "border-primary bg-primary/15"
                                : "bg-card",
                            )}
                          >
                            {item.code} · {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-2 h-11 px-0"
                    aria-expanded={newCodeOpen}
                    onClick={() => setNewCodeOpen((v) => !v)}
                  >
                    <Plus className="size-4" /> {t("worklog.newWorkCode")}
                  </Button>
                  <div className={cn("mt-2 grid grid-cols-[5.5rem_1fr] gap-2", !newCodeOpen && "hidden")}>
                    <div className="grid gap-1">
                      <Label htmlFor="leistungsart-code" className="text-xs">
                        {t("worklog.codeShort")}
                      </Label>
                      <Input
                        id="leistungsart-code"
                        data-testid="work-code-input"
                        value={newCode}
                        maxLength={4}
                        placeholder={t("worklog.codeShort")}
                        onChange={(e) => {
                          const v = e.target.value.toUpperCase();
                          setNewCode(v);
                          setWorkCode(normalizeWorkCode(v));
                        }}
                        onFocus={keepFieldVisible}
                        className="h-11"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="leistungsart-label" className="text-xs">
                        {t("worklog.codeLabel")}
                      </Label>
                      <Input
                        id="leistungsart-label"
                        data-testid="work-code-label-input"
                        value={newCodeLabel}
                        placeholder={t("worklog.codeLabel")}
                        onChange={(e) => setNewCodeLabel(e.target.value)}
                        onFocus={keepFieldVisible}
                        className="h-11"
                      />
                    </div>
                  </div>
                </section>

                <section>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("worklog.tasks")}
                  </p>
                  <select
                    data-testid="task-select"
                    value=""
                    onChange={(e) => applyTaskSelection(e.target.value)}
                    className="h-11 w-full rounded-xl border bg-card px-3 text-sm"
                  >
                    <option value="">{t("worklog.chooseTask")}</option>
                    <optgroup label={t("worklog.standard")}>
                      {CLEANING_TASKS.map((key) => (
                        <option key={key} value={templateValue(key)}>
                          {t(`task.${key}`)}
                        </option>
                      ))}
                    </optgroup>
                    {customTasksCatalog.length > 0 ? (
                      <optgroup label={t("worklog.saved")}>
                        {customTasksCatalog.map((label) => (
                          <option key={label} value={label}>
                            {label}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                  {tasks.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {tasks.map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setTasks(tasks.filter((x) => x !== value))}
                          aria-label={t("worklog.removeFromEntry")}
                          className="inline-flex h-11 max-w-full items-center gap-1 rounded-full border bg-primary/10 px-3 text-sm font-medium"
                        >
                          <span className="truncate">{taskEntryLabel(value)}</span>
                          <X className="size-3.5 shrink-0" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {customTasksCatalog.length > 0 ? (
                    <div className="mt-3">
                      <p className="mb-1.5 text-xs text-muted-foreground">{t("worklog.myTasks")}</p>
                      <div className="flex flex-wrap gap-2">
                        {customTasksCatalog.map((label) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => applyTaskSelection(label)}
                            className="h-11 rounded-full border bg-card px-3 text-sm"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-2 h-11 px-0"
                    aria-expanded={newTaskOpen}
                    onClick={() => setNewTaskOpen((v) => !v)}
                  >
                    <Plus className="size-4" /> {t("worklog.newTask")}
                  </Button>
                  <div className={cn("mt-2 flex gap-2", !newTaskOpen && "hidden")}>
                    <Input
                      id="eigene-taetigkeit"
                      data-testid="custom-task-input"
                      value={customTask}
                      placeholder={t("worklog.customTask")}
                      onChange={(e) => setCustomTask(e.target.value)}
                      onFocus={keepFieldVisible}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTaskToEntry();
                        }
                      }}
                      className="h-11"
                      aria-label={t("worklog.customTask")}
                    />
                    <Button type="button" variant="outline" className="h-11 shrink-0" onClick={addTaskToEntry}>
                      {t("worklog.addTask")}
                    </Button>
                  </div>
                </section>
              </>
            ) : null}

            {!isWork ? <section>{noteField}</section> : null}

            <section>
              <button
                type="button"
                className="flex h-11 w-full items-center justify-between text-sm font-semibold"
                aria-expanded={advanced}
                onClick={() => setAdvanced((v) => !v)}
              >
                {advanced ? t("entry.less") : t("entry.more")}
                <ChevronDown className={cn("size-4 transition-transform", advanced && "rotate-180")} />
              </button>
              {advanced ? (
                <div className="space-y-4 pt-1">
                  {selfEmployed ? (
                    <div className="grid gap-3">
                      <div className="grid gap-1">
                        <Label className="text-xs">{t("label.customer")}</Label>
                        <select
                          value={customerId ?? ""}
                          onChange={(e) => setCustomerId(e.target.value || undefined)}
                          className="h-11 rounded-xl border bg-card px-3 text-sm"
                        >
                          <option value="">{t("shift.noCustomer")}</option>
                          {customers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs">{t("label.project")}</Label>
                        <select
                          value={projectId ?? ""}
                          onChange={(e) => setProjectId(e.target.value || undefined)}
                          className="h-11 rounded-xl border bg-card px-3 text-sm"
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

                  {isWork && !hourlyPay ? (
                    <div className="grid gap-1">
                      <Label htmlFor="lohn">{t("label.rateEuro")}</Label>
                      <Input
                        id="lohn"
                        type="number"
                        step="0.5"
                        min="0"
                        inputMode="decimal"
                        value={rate}
                        onChange={(e) => setRate(e.target.value)}
                        onFocus={keepFieldVisible}
                        className="h-11"
                      />
                    </div>
                  ) : null}

                  {isWork ? (
                    <div className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border bg-card px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{t("shift.overtimeTitle")}</p>
                        <p className="text-xs text-muted-foreground">{t("shift.overtimeDesc")}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={overtime}
                        aria-label={t("shift.overtimeAria")}
                        onClick={() => setOvertime((value) => !value)}
                        className={cn(
                          "relative h-11 w-16 shrink-0 rounded-full border transition-colors",
                          overtime ? "border-primary bg-primary" : "border-border bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-1 size-8 rounded-full bg-background shadow",
                            overtime ? "right-1" : "left-1",
                          )}
                        />
                      </button>
                    </div>
                  ) : null}

                  {isWork ? (
                    <div className="grid gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("worklog.photos")}
                      </p>
                      {photos.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {photos.map((src, i) => (
                            <div key={src.slice(-24) + i} className="relative">
                              <img src={src} alt="" className="size-16 rounded-lg object-cover" />
                              <button
                                type="button"
                                aria-label={t("worklog.remove")}
                                onClick={() => setPhotos(photos.filter((_, idx) => idx !== i))}
                                className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                              >
                                <X className="size-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <label className="inline-flex h-11 w-fit cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-medium">
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
                  ) : null}

                  {isWork ? (
                    <div className="grid gap-2" data-testid="worklog-geo-controls">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("worklog.gps")}
                      </p>
                      <p className="text-sm">
                        {gps ? formatGps(gps) : "–"}
                      </p>
                      {street || zip || city ? (
                        <p className="text-xs text-muted-foreground" data-testid="worklog-geo-address">
                          {formatGermanAddress({ street, houseNo, zip, city })}
                        </p>
                      ) : null}
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11"
                          disabled={gpsBusy}
                          onClick={async () => {
                            setGpsBusy(true);
                            try {
                              const pos = await currentPosition();
                              setGps(pos);
                              const previous = { street, houseNo, zip, city };
                              const reverse = await reverseGeocodeGerman(pos.lat, pos.lng);
                              if (reverse) {
                                const next = applyReverseOrKeep(previous, reverse);
                                setStreet(next.street ?? "");
                                setHouseNo(next.houseNo ?? "");
                                setZip(next.zip ?? "");
                                setCity(next.city ?? "");
                                toast.success(t("worklog.gpsAddressOk"));
                              } else {
                                toast.message(t("worklog.gpsAddressFail"));
                              }
                            } catch {
                              toast.error(t("worklog.gpsError"));
                            } finally {
                              setGpsBusy(false);
                            }
                          }}
                        >
                          <MapPin className="size-4" />
                          {gpsBusy ? t("worklog.gpsLookingUp") : t("worklog.gpsAdd")}
                        </Button>
                        {gps ? (
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-11"
                            onClick={() => setGps(undefined)}
                          >
                            <X className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {isWork ? noteField : null}
                </div>
              ) : null}
            </section>

            {isEditing ? (
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full text-destructive"
                data-testid="entry-delete"
                onClick={() => {
                  const id = editingIdRef.current ?? resolvedShiftId;
                  if (id) removeShift(id);
                  toast.success(t("shift.deleted"));
                  onOpenChange(false);
                }}
              >
                <Trash2 className="size-4" /> {t("entry.deleteEntry")}
              </Button>
            ) : null}
          </div>

          <div className="shrink-0 flex gap-2 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1"
              onClick={() => onOpenChange(false)}
            >
              {t("action.cancel")}
            </Button>
            <Button type="button" data-testid="entry-save" className="h-11 flex-1" onClick={save}>
              {t("action.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ObjectDialog
        open={objectDialogOpen}
        onOpenChange={setObjectDialogOpen}
        onSaved={onObjectSaved}
      />
    </>
  );
}
