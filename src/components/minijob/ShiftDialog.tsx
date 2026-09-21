import { Camera, ChevronDown, ChevronRight, MapPin, Mic, Plus, Trash2, X } from "lucide-react";
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
import { formatEuro, formatHours, isoDate, shiftBreakdown } from "@/lib/minijob/calc";
import { shiftPayroll } from "@/lib/minijob/payroll";
import { holidayName } from "@/lib/minijob/holidays";
import { parseRateInput, suggestedRate } from "@/lib/minijob/rate";
import { ObjectDialog } from "@/components/minijob/ObjectDialog";
import { addShift, removeShift, upsertShift } from "@/lib/minijob/service";
import { newId, updateSettings } from "@/lib/minijob/store";
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
  addCustomTaskToCatalog,
  addWorkCodeToCatalog,
  builtinWorkCodes,
  mergeWorkCodeCatalog,
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
  jobs: Job[];
  customers: Customer[];
  projects: Project[];
  settings: Settings;
  objects?: WorkObject[];
  /** When set, choosing Urlaub/Krank closes this dialog and opens AbsenceDialog (From–To). */
  onRequestAbsence?: (kind: "urlaub" | "krank" | "frei" | "sonstige", date: string) => void;
}

const KINDS: ShiftKind[] = ["arbeit", "urlaub", "krank", "feiertag", "frei", "sonstige"];

const SECTION_LABEL = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

function SavedCatalogRows({
  items,
  isSelected,
  onSelect,
}: {
  items: { key: string; title: string }[];
  isSelected: (key: string) => boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <ul className="overflow-hidden rounded-xl border bg-card">
      {items.map((item, index) => {
        const active = isSelected(item.key);
        return (
          <li key={item.key} className={index > 0 ? "border-t" : undefined}>
            <button
              type="button"
              onClick={() => onSelect(item.key)}
              className={cn(
                "flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left",
                active ? "bg-primary/10" : "bg-background hover:bg-muted/50",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ShiftDialog({
  open,
  onOpenChange,
  date,
  shift,
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
  const [workCodeNote, setWorkCodeNote] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newCodeLabel, setNewCodeLabel] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [entryDate, setEntryDate] = useState(date);
  const [objectId, setObjectId] = useState<string | undefined>(undefined);
  const [objectDialogOpen, setObjectDialogOpen] = useState(false);
  const customCodes = settings.workCodes ?? [];
  const customTasksCatalog = settings.customTasks ?? [];
  const predefinedTaskLabels = CLEANING_TASKS.map((key) => ({
    key,
    label: t(`task.${key}`),
  }));

  const allCodes = mergeWorkCodeCatalog(customCodes);
  const builtinCodes = builtinWorkCodes();
  const selectedWorkLabel = allCodes.find((c) => c.code === workCode)?.label ?? workCode;

  function addCustomCode() {
    const result = addWorkCodeToCatalog(customCodes, newCode, newCodeLabel);
    if (result.status === "empty") return;
    if (result.status === "conflict") {
      toast.error(t("worklog.codeExists"));
      return;
    }
    if (result.status === "added") {
      updateSettings({ workCodes: result.catalog });
    }
    setWorkCode(result.item.code);
    setNewCode("");
    setNewCodeLabel("");
  }

  function addCustomTaskToEntry() {
    const result = addCustomTaskToCatalog(customTasksCatalog, customTask, predefinedTaskLabels);
    if (result.status === "empty") return;
    if (result.status === "predefined") {
      if (!tasks.includes(result.value)) setTasks([...tasks, result.value]);
      setCustomTask("");
      return;
    }
    if (result.status === "added") {
      updateSettings({ customTasks: result.catalog });
    }
    if (!tasks.includes(result.value)) setTasks([...tasks, result.value]);
    setCustomTask("");
  }

  useEffect(() => {
    if (!open) return;
    const fallbackJob = jobs.find((j) => j.id === settings.activeJobId) ?? jobs[0];
    const initialDate = resolveEntryDate(shift, date);
    setEntryDate(initialDate);
    setObjectId(shift?.objectId);
    setJobId(shift?.jobId ?? fallbackJob?.id);
    // Existing entries keep their kind (incl. Feiertag). New entries on a
    // public holiday default to feiertag so the type matches the calendar day.
    const holidayDefault =
      !shift && holidayName(initialDate, settings.bundesland) ? "feiertag" : "arbeit";
    setKind(shift?.kind ?? holidayDefault);
    setStart(shift?.start ?? "09:00");
    setEnd(shift?.end ?? "17:00");
    setBreakMinutes(String(shift?.breakMinutes ?? 30));
    setRate(
      shift
        ? typeof shift.rate === "number"
          ? String(shift.rate)
          : ""
        : String(suggestedRate({ jobId: fallbackJob?.id }, { jobs, settings })),
    );
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
    setZip(shift?.zip ?? "");
    setCity(shift?.city ?? "");
    setGpsBusy(false);
    setFloor(shift?.floor ?? "");
    setDoorSide(shift?.doorSide ?? "");
    setWorkCode(shift?.workCode ?? "");
    setWorkCodeNote(shift?.workCodeNote ?? "");
    setAdvanced(
      Boolean(
        shift &&
          (shift.workplace ||
            shift.street ||
            shift.zip ||
            shift.city ||
            shift.floor ||
            shift.doorSide ||
            shift.workCode ||
            shift.note ||
            shift.overtime ||
            shift.customerId ||
            (shift.tasks?.length ?? 0) > 0 ||
            (shift.photos?.length ?? 0) > 0 ||
            shift.gps ||
            shift.objectId),
      ),
    );
  }, [open, shift, jobs, settings.activeJobId, settings.defaultRate, settings.bundesland, date]);


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
      !shift
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
    setAdvanced(true);
  }

  function save() {
    const next: Shift = withEntryDate(
      {
        id: shift?.id ?? newId(),
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
    if (tasks.length > 0) next.tasks = tasks;
    if (photos.length > 0) next.photos = photos;
    if (gps) next.gps = gps;
    if (street.trim()) next.street = street.trim();
    if (houseNo.trim()) next.houseNo = houseNo.trim();
    if (zip.trim()) next.zip = zip.trim();
    if (city.trim()) next.city = city.trim();
    if (floor.trim()) next.floor = floor.trim();
    if (doorSide.trim()) next.doorSide = doorSide.trim();
    if (workCode) {
      next.workCode = workCode;
      const label = snapshotWorkCodeLabel({
        selectedCode: workCode,
        catalog: customCodes,
        previousCode: shift?.workCode,
        previousLabel: shift?.workCodeLabel,
      });
      if (label) next.workCodeLabel = label;
    }
    if (workCode && workCodeNote.trim()) next.workCodeNote = workCodeNote.trim();
    next.createdAt = shift?.createdAt ?? isoDate(new Date());
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
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{shift ? t("shift.editTitle") : t("shift.newTitle")}</DialogTitle>
          <DialogDescription>
            {holiday ? holiday : t("label.date")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="eintrag-datum">{t("label.date")}</Label>
            <Input
              id="eintrag-datum"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </div>
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
                      setRate(String(suggestedRate({ jobId: j.id }, { jobs, settings })));
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
                  onClick={() => selectKind(k)}
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

          {holiday ? (
            <div
              className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-xs text-violet-900 dark:text-violet-100"
              data-testid="holiday-pay-hint"
            >
              <p className="font-medium">{t("shift.holidayBannerTitle", { name: holiday })}</p>
              <p className="mt-1 text-muted-foreground dark:text-violet-200/80">
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
                  size="sm"
                  className="mt-2"
                  onClick={() => selectKind("arbeit")}
                >
                  {t("shift.markAsWorked")}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="von">{t("label.start")}</Label>
              <Input id="von" type="time" value={start} onChange={(e) => onStartChange(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bis">{t("label.end")}</Label>
              <Input id="bis" type="time" value={end} onChange={(e) => onEndChange(e.target.value)} />
            </div>
          </div>

          {!shift && kind === "arbeit" ? (
            <p className="text-xs text-muted-foreground">{t("shift.multiSameDayHint")}</p>
          ) : null}

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
              <Label className="text-xs">{t("object.select")}</Label>
              <select
                value={objectId ?? ""}
                onChange={(e) => applyObjectSelection(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">{t("object.none")}</option>
                {objects.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              {selectedObject ? (
                <p className="text-xs text-muted-foreground">
                  {objectAddressPreview(selectedObject) || selectedObject.name}
                </p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-start"
                onClick={() => setObjectDialogOpen(true)}
              >
                {t("object.new")}
              </Button>
            </div>

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

            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="plz" className="text-xs">
                  {t("worklog.zip")}
                </Label>
                <Input
                  id="plz"
                  value={zip}
                  inputMode="numeric"
                  placeholder={t("worklog.zipPlaceholder")}
                  onChange={(e) => setZip(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ort" className="text-xs">
                  {t("worklog.city")}
                </Label>
                <Input
                  id="ort"
                  value={city}
                  placeholder={t("worklog.cityPlaceholder")}
                  onChange={(e) => setCity(e.target.value)}
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

            <div className="grid gap-2">
              <Label className="text-xs">{t("worklog.workCode")}</Label>
              {workCode ? (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setWorkCode("")}
                    aria-label={t("worklog.removeFromEntry")}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium"
                  >
                    <span className="truncate">
                      {workCode} · {selectedWorkLabel}
                    </span>
                    <X className="size-3 shrink-0" />
                  </button>
                </div>
              ) : null}
              <p className={SECTION_LABEL}>{t("worklog.standard")}</p>
              <div className="flex flex-wrap gap-1.5">
                {builtinCodes.map(({ code, label }) => (
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
              {customCodes.length > 0 ? (
                <div className="grid gap-1.5">
                  <p className={SECTION_LABEL}>{t("worklog.myWorkCodes")}</p>
                  <SavedCatalogRows
                    items={customCodes.map((c) => ({
                      key: c.code,
                      title: `${c.code} · ${c.label}`,
                    }))}
                    isSelected={(code) => workCode === code}
                    onSelect={(code) => setWorkCode(workCode === code ? "" : code)}
                  />
                </div>
              ) : null}
              <div className="grid gap-1.5">
                <p className={SECTION_LABEL}>{t("worklog.newWorkCode")}</p>
                <div className="grid grid-cols-[4.5rem_1fr] gap-1.5">
                  <div className="grid gap-1">
                    <Label className="text-[11px]">{t("worklog.codeShort")}</Label>
                    <Input
                      value={newCode}
                      maxLength={4}
                      placeholder={t("worklog.codeShort")}
                      onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-[11px]">{t("worklog.codeLabel")}</Label>
                    <Input
                      value={newCodeLabel}
                      placeholder={t("worklog.codeLabel")}
                      onChange={(e) => setNewCodeLabel(e.target.value)}
                    />
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" className="w-full" onClick={addCustomCode}>
                  <Plus className="size-4" /> {t("worklog.addTask")}
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-xs">{t("worklog.tasks")}</Label>
              {tasks.some((x) => !x.startsWith("#")) ? (
                <div className="flex flex-wrap gap-1.5">
                  {tasks
                    .filter((x) => !x.startsWith("#"))
                    .map((x) => (
                      <button
                        key={x}
                        type="button"
                        onClick={() => setTasks(tasks.filter((y) => y !== x))}
                        aria-label={t("worklog.removeFromEntry")}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium"
                      >
                        <span className="truncate">{x}</span>
                        <X className="size-3 shrink-0" />
                      </button>
                    ))}
                </div>
              ) : null}
              <p className={SECTION_LABEL}>{t("worklog.standard")}</p>
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
              {customTasksCatalog.length > 0 ? (
                <div className="grid gap-1.5">
                  <p className={SECTION_LABEL}>{t("worklog.myTasks")}</p>
                  <SavedCatalogRows
                    items={customTasksCatalog.map((label) => ({ key: label, title: label }))}
                    isSelected={(label) => tasks.includes(label)}
                    onSelect={(label) =>
                      setTasks(
                        tasks.includes(label)
                          ? tasks.filter((x) => x !== label)
                          : [...tasks, label],
                      )
                    }
                  />
                </div>
              ) : null}
              <div className="grid gap-1.5">
                <p className={SECTION_LABEL}>{t("worklog.newTask")}</p>
                <div className="flex gap-2">
                  <Input
                    value={customTask}
                    placeholder={t("worklog.customTask")}
                    onChange={(e) => setCustomTask(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={addCustomTaskToEntry}
                  >
                    <Plus className="size-4" /> {t("worklog.addTask")}
                  </Button>
                </div>
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

            <div
              className="flex flex-col gap-2"
              data-testid="worklog-geo-controls"
              style={{
                paddingBottom: "max(0.25rem, env(safe-area-inset-bottom, 0px))",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-xs">
                  <p className="font-medium">{t("worklog.gps")}</p>
                  <p className="truncate text-muted-foreground">
                    {gps ? formatGps(gps) : "–"}
                  </p>
                  {(street || zip || city) ? (
                    <p className="mt-0.5 truncate text-muted-foreground" data-testid="worklog-geo-address">
                      {formatGermanAddress({ street, houseNo, zip, city })}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  {gps ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11"
                      onClick={() => setGps(undefined)}
                    >
                      <X className="size-4" />
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={gpsBusy}
                    onClick={async () => {
                      setGpsBusy(true);
                      try {
                        const pos = await currentPosition();
                        // Always keep coords separate — never copy into address fields.
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
                          // Failure: leave editable address untouched; gps already set.
                          toast.message(t("worklog.gpsAddressFail"));
                        }
                      } catch {
                        toast.error(t("worklog.gpsError"));
                      } finally {
                        setGpsBusy(false);
                      }
                    }}
                  >
                    <MapPin className="size-4" />{" "}
                    {gpsBusy ? t("worklog.gpsLookingUp") : t("worklog.gpsAdd")}
                  </Button>
                </div>
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
                removeShift(shift.id);
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

    <ObjectDialog
      open={objectDialogOpen}
      onOpenChange={setObjectDialogOpen}
      onSaved={onObjectSaved}
    />
    </>
  );
}
