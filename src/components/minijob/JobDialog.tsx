import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/lib/i18n";
import { isoDate, weekdayNames } from "@/lib/minijob/calc";
import { weeklyPlanHours } from "@/lib/minijob/schedule";
import { resolvePayType } from "@/lib/minijob/work-mode";
import { parseRateInput } from "@/lib/minijob/rate";
import { INDUSTRY_MINIMUM_WAGE_SECTORS, industryMinimumWageFor } from "@/lib/minijob/industry-minimum-wage";
import { deleteJob, newId, nextJobColor, saveJob } from "@/lib/minijob/store";
import {
  DEFAULT_SUPPLEMENTS,
  EMPTY_WEEK,
  JOB_COLORS,
  type FixedDay,
  type Job,
  type Supplement,
  type Supplements,
  type WorkMode,
} from "@/lib/minijob/types";
import { cn } from "@/lib/utils";

interface JobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job?: Job | null;
  defaultRate: number;
}

const WORK_MODES: WorkMode[] = ["flex", "fest", "selbststaendig"];

export function JobDialog({ open, onOpenChange, job, defaultRate }: JobDialogProps) {
  const { t, locale } = useT();
  const [name, setName] = useState("");
  const [color, setColor] = useState(JOB_COLORS[0]!);
  const [rate, setRate] = useState(String(defaultRate));
  const [mode, setMode] = useState<WorkMode>("flex");
  const [industrySectorId, setIndustrySectorId] = useState("");
  const [industryGroupId, setIndustryGroupId] = useState("");
  const [employer, setEmployer] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [week, setWeek] = useState<FixedDay[]>(EMPTY_WEEK);
  const [weeklyTarget, setWeeklyTarget] = useState("20");
  const [payType, setPayType] = useState<"monthly" | "hourly">("hourly");
  const [monthlyGross, setMonthlyGross] = useState("");
  const [weeklyTargetTouched, setWeeklyTargetTouched] = useState(false);
  const [supplements, setSupplements] = useState<Supplements>(DEFAULT_SUPPLEMENTS);
  const [notes, setNotes] = useState("");
  const [payday, setPayday] = useState("15");
  const [startDate, setStartDate] = useState("");
  const [payrollDelay, setPayrollDelay] = useState(1);

  const weekdays = weekdayNames(locale);

  useEffect(() => {
    if (!open) return;
    setName(job?.name ?? "");
    setColor(job?.color ?? nextJobColor());
    setRate(typeof job?.rate === "number" ? String(job.rate) : job ? "" : String(defaultRate));
    setMode(job?.mode ?? "flex");
    setIndustrySectorId(job?.industrySectorId ?? "");
    setIndustryGroupId(job?.industryGroupId ?? "");
    setEmployer(job?.employer ?? "");
    setContact(job?.contact ?? "");
    setPhone(job?.phone ?? "");
    setEmail(job?.email ?? "");
    setAddress(job?.address ?? "");
    setWeek(job?.week ?? EMPTY_WEEK);
    const initialWeek = job?.week ?? EMPTY_WEEK;
    const planned = weeklyPlanHours({
      id: "tmp",
      name: "tmp",
      color: "#000",
      mode: "fest",
      week: initialWeek,
    });
    setWeeklyTarget(String(job?.weeklyTarget ?? (planned || 20)));
    setWeeklyTargetTouched(Boolean(job?.weeklyTarget));
    setPayType(job ? resolvePayType(job) : "hourly");
    setMonthlyGross(job?.monthlyGross != null ? String(job.monthlyGross) : "");
    setSupplements(job?.supplements ?? DEFAULT_SUPPLEMENTS);
    setNotes(job?.notes ?? "");
    setPayday(String(job?.payday ?? 15));
    setStartDate(job?.startDate ?? "");
    setPayrollDelay(job?.payrollDelay ?? 1);
  }, [open, job, defaultRate]);

  function save() {
    if (!name.trim()) {
      toast.error(t("job.errorName"));
      return;
    }
    const next: Job = {
      id: job?.id ?? newId(),
      name: name.trim(),
      color,
      mode,
      ...(industrySectorId && industryGroupId ? { industrySectorId, industryGroupId } : {}),
      employer: employer.trim(),
      contact: contact.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      notes: notes.trim(),
      payday: Math.min(31, Math.max(1, Number(payday) || 15)),
      payrollDelay,
      supplements,
    };
    if (startDate) next.startDate = startDate;
    if (mode === "fest") {
      if (job?.week) {
        const weekChanged = JSON.stringify(job.week) !== JSON.stringify(week);
        if (weekChanged) {
          next.weekHistory = [
            ...(job.weekHistory ?? []),
            {
              effectiveFrom: isoDate(new Date()),
              week: job.week.map((d) => ({ ...d })),
              ...(typeof job.weeklyTarget === "number" ? { weeklyTarget: job.weeklyTarget } : {}),
            },
          ];
        } else if (job.weekHistory?.length) {
          next.weekHistory = job.weekHistory;
        }
      }
      next.week = week;
      const planned = weeklyPlanHours(next);
      const target = Number(weeklyTarget.replace(",", ".")) || planned || 0;
      next.weeklyTarget = target;
      next.payType = payType;
      if (payType === "monthly") {
        const gross = Number(monthlyGross.replace(",", ".")) || 0;
        if (gross > 0) next.monthlyGross = gross;
        // keep rate if previously set (additive; do not delete)
        const rateValue = parseRateInput(rate);
        if (rateValue !== undefined) next.rate = rateValue;
        else if (typeof job?.rate === "number") next.rate = job.rate;
      } else {
        const rateValue = parseRateInput(rate);
        if (rateValue !== undefined) next.rate = rateValue;
        if (typeof job?.monthlyGross === "number") next.monthlyGross = job.monthlyGross;
      }
    } else {
      const rateValue = parseRateInput(rate);
      if (rateValue !== undefined) next.rate = rateValue;
      if (week.some((d) => d.active) || job?.week) {
        // Keep week data inactive when switching away from fest (never delete).
        next.week = week;
        if (job?.weeklyTarget != null) next.weeklyTarget = job.weeklyTarget;
        if (job?.weekHistory?.length) next.weekHistory = job.weekHistory;
      }
      if (job?.payType) next.payType = job.payType;
      if (job?.monthlyGross != null) next.monthlyGross = job.monthlyGross;
    }
    saveJob(next);
    toast.success(job ? t("job.updated") : t("job.created"));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{job ? t("job.editTitle") : t("job.newTitle")}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="basis">
          <TabsList className="w-full">
            <TabsTrigger value="basis" className="flex-1">
              {t("job.tabBasis")}
            </TabsTrigger>
            <TabsTrigger value="kontakt" className="flex-1">
              {t("job.tabContact")}
            </TabsTrigger>
            <TabsTrigger value="zuschlag" className="flex-1">
              {t("job.tabSupplements")}
            </TabsTrigger>
            <TabsTrigger value="lohn" className="flex-1">
              {t("job.tabPay")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basis" className="mt-4 space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="job-name">{t("label.name")}</Label>
              <Input id="job-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="grid gap-2">
              <Label>{t("label.color")}</Label>
              <div className="flex flex-wrap gap-2">
                {JOB_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={t("job.colorAria", { color: c })}
                    onClick={() => setColor(c)}
                    style={{ backgroundColor: c }}
                    className={cn(
                      "size-8 rounded-full border-2",
                      color === c ? "border-foreground" : "border-transparent",
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label>{t("job.workMode")}</Label>
              <div className="grid gap-2">
                {WORK_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      if (m === mode) return;
                      // Never delete shifts/jobs; fest week stays in state (inactive when not fest).
                      if (mode === "fest" && m !== "fest") {
                        toast.message(t("job.modeSwitchKeepData"));
                      }
                      if (m === "fest" && (!week.length || week.every((d) => !d.active))) {
                        setWeek(EMPTY_WEEK.map((d) => ({ ...d })));
                      }
                      setMode(m);
                    }}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-left text-sm",
                      mode === m ? "border-primary bg-primary/10 font-semibold" : "bg-card",
                    )}
                  >
                    {t("mode." + m)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2 rounded-xl border bg-muted/30 p-3">
              <div className="text-sm font-medium">{t("job.industryMinimumWage")}</div>
              <label className="grid gap-1.5">
                <span className="text-xs text-muted-foreground">{t("job.industry")}</span>
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={industrySectorId}
                  onChange={(e) => {
                    setIndustrySectorId(e.target.value);
                    setIndustryGroupId("");
                  }}
                >
                  <option value="">{t("job.industryNone")}</option>
                  {INDUSTRY_MINIMUM_WAGE_SECTORS.map((sector) => (
                    <option key={sector.id} value={sector.id}>{sector.label}</option>
                  ))}
                </select>
              </label>
              {industrySectorId ? (
                <label className="grid gap-1.5">
                  <span className="text-xs text-muted-foreground">{t("job.industryGroup")}</span>
                  <select
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    value={industryGroupId}
                    onChange={(e) => setIndustryGroupId(e.target.value)}
                  >
                    <option value="">{t("job.industryNone")}</option>
                    {(INDUSTRY_MINIMUM_WAGE_SECTORS.find((s) => s.id === industrySectorId)?.groups ?? []).map((group) => (
                      <option key={group.id} value={group.id}>{group.label}{group.description ? ` — ${group.description}` : ""}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {industrySectorId && industryGroupId ? (() => {
                const floor = industryMinimumWageFor(new Date(), industrySectorId, industryGroupId);
                const entered = parseRateInput(rate);
                if (floor == null) return null;
                return (
                  <div className={cn("text-xs", entered != null && entered + 0.0001 < floor ? "text-destructive" : "text-muted-foreground")}>
                    {t("job.industryFloor", { rate: `${floor.toFixed(2).replace(".", ",")} €` })}
                    {entered != null && entered + 0.0001 < floor ? ` ${t("job.industryWarning")}` : ""}
                  </div>
                );
              })() : null}
            </div>

            {mode === "fest" ? (
              <div className="grid gap-2">
                <Label>{t("job.payType")}</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["hourly", "monthly"] as const).map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setPayType(pt)}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-sm",
                        payType === pt ? "border-primary bg-primary/10 font-semibold" : "bg-card",
                      )}
                    >
                      {t(pt === "hourly" ? "job.payTypeHourly" : "job.payTypeMonthly")}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t("job.help.payType")}</p>
              </div>
            ) : null}

            {mode !== "fest" || payType === "hourly" ? (
              <div className="grid gap-2">
                <Label htmlFor="job-rate">{t("label.rateEuro")}</Label>
                <Input
                  id="job-rate"
                  type="number"
                  step="0.5"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </div>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="job-monthly">{t("job.monthlyGross")}</Label>
                <Input
                  id="job-monthly"
                  type="number"
                  step="1"
                  inputMode="decimal"
                  value={monthlyGross}
                  onChange={(e) => setMonthlyGross(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("job.help.monthlyGross")}</p>
              </div>
            )}

            {mode === "fest" ? (
              <div className="space-y-3 rounded-xl border p-3">
                <p className="text-sm font-semibold">{t("job.weeklyPlan")}</p>
                <p className="text-xs text-muted-foreground">{t("job.help.wochenstunden")}</p>
                {week.map((day, idx) => (
                  <div key={weekdays[idx]} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">{weekdays[idx]}</span>
                      <Switch
                        checked={day.active}
                        onCheckedChange={(checked) => {
                          const next = week.map((d, i) => (i === idx ? { ...d, active: checked } : d));
                          setWeek(next);
                          if (!weeklyTargetTouched) {
                            setWeeklyTarget(
                              String(
                                weeklyPlanHours({
                                  id: "tmp",
                                  name: "tmp",
                                  color: "#000",
                                  mode: "fest",
                                  week: next,
                                }),
                              ),
                            );
                          }
                        }}
                        aria-label={t("job.weekdayActive", { day: weekdays[idx] ?? "" })}
                      />
                    </div>
                    {day.active ? (
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          type="time"
                          value={day.start}
                          onChange={(e) => {
                            const next = week.map((d, i) =>
                              i === idx ? { ...d, start: e.target.value } : d,
                            );
                            setWeek(next);
                            if (!weeklyTargetTouched) {
                              setWeeklyTarget(
                                String(
                                  weeklyPlanHours({
                                    id: "tmp",
                                    name: "tmp",
                                    color: "#000",
                                    mode: "fest",
                                    week: next,
                                  }),
                                ),
                              );
                            }
                          }}
                        />
                        <Input
                          type="time"
                          value={day.end}
                          onChange={(e) => {
                            const next = week.map((d, i) =>
                              i === idx ? { ...d, end: e.target.value } : d,
                            );
                            setWeek(next);
                            if (!weeklyTargetTouched) {
                              setWeeklyTarget(
                                String(
                                  weeklyPlanHours({
                                    id: "tmp",
                                    name: "tmp",
                                    color: "#000",
                                    mode: "fest",
                                    week: next,
                                  }),
                                ),
                              );
                            }
                          }}
                        />
                        <Input
                          type="number"
                          min="0"
                          value={day.breakMinutes}
                          onChange={(e) => {
                            const next = week.map((d, i) =>
                              i === idx ? { ...d, breakMinutes: Number(e.target.value) || 0 } : d,
                            );
                            setWeek(next);
                            if (!weeklyTargetTouched) {
                              setWeeklyTarget(
                                String(
                                  weeklyPlanHours({
                                    id: "tmp",
                                    name: "tmp",
                                    color: "#000",
                                    mode: "fest",
                                    week: next,
                                  }),
                                ),
                              );
                            }
                          }}
                          aria-label={t("job.breakMinutesAria")}
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
                <div className="grid gap-2">
                  <Label htmlFor="soll">{t("job.weeklyTarget")}</Label>
                  <Input
                    id="soll"
                    type="number"
                    inputMode="decimal"
                    value={weeklyTarget}
                    onChange={(e) => {
                      setWeeklyTargetTouched(true);
                      setWeeklyTarget(e.target.value);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">{t("job.help.sollzeit")}</p>
                  <p className="text-xs text-muted-foreground">{t("job.help.istzeit")}</p>
                  <p className="text-xs text-muted-foreground">{t("job.help.arbeitszeitkonto")}</p>
                </div>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="kontakt" className="mt-4 space-y-3">
            <Field label={t("label.employer")} value={employer} onChange={setEmployer} />
            <Field label={t("label.contact")} value={contact} onChange={setContact} />
            <Field label={t("label.phone")} value={phone} onChange={setPhone} type="tel" />
            <Field label={t("label.email")} value={email} onChange={setEmail} type="email" />
            <Field label={t("label.address")} value={address} onChange={setAddress} />
            <Field label={t("job.notes")} value={notes} onChange={setNotes} />
          </TabsContent>

          <TabsContent value="lohn" className="mt-4 space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="job-start">{t("job.startDate")}</Label>
              <Input
                id="job-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("job.startDateHint")}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="job-payday">{t("job.payday")}</Label>
              <Input
                id="job-payday"
                type="number"
                min="1"
                max="31"
                inputMode="numeric"
                value={payday}
                onChange={(e) => setPayday(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("job.payroll")}</Label>
              <div className="grid grid-cols-2 gap-2">
                {[0, 1].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setPayrollDelay(d)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-sm",
                      payrollDelay === d ? "border-primary bg-primary/10 font-semibold" : "bg-card",
                    )}
                  >
                    {d === 0 ? t("job.payrollSame") : t("job.payrollNext")}
                  </button>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="zuschlag" className="mt-4 space-y-3">
            <SupplementRow
              label={t("supp.saturday")}
              value={supplements.saturday}
              onChange={(v) => setSupplements({ ...supplements, saturday: v })}
            />
            <SupplementRow
              label={t("supp.sunday")}
              value={supplements.sunday}
              onChange={(v) => setSupplements({ ...supplements, sunday: v })}
            />
            <SupplementRow
              label={t("supp.holiday")}
              value={supplements.holiday}
              onChange={(v) => setSupplements({ ...supplements, holiday: v })}
            />
            <SupplementRow
              label={t("supp.night")}
              value={supplements.night}
              onChange={(v) => setSupplements({ ...supplements, night: v })}
            />
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">{t("job.nightFrom")}</Label>
                <Input
                  type="time"
                  value={supplements.nightStart}
                  onChange={(e) => setSupplements({ ...supplements, nightStart: e.target.value })}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">{t("job.nightTo")}</Label>
                <Input
                  type="time"
                  value={supplements.nightEnd}
                  onChange={(e) => setSupplements({ ...supplements, nightEnd: e.target.value })}
                />
              </div>
            </div>
            <SupplementRow
              label={t("supp.overtime")}
              value={supplements.overtime}
              onChange={(v) => setSupplements({ ...supplements, overtime: v })}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-2 gap-2 sm:justify-between">
          {job ? (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                deleteJob(job.id);
                toast.success(t("job.deleted"));
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

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function SupplementRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Supplement;
  onChange: (value: Supplement) => void;
}) {
  const { t } = useT();
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Switch
          checked={value.enabled}
          onCheckedChange={(enabled) => onChange({ ...value, enabled })}
          aria-label={t("job.supplementAria", { label })}
        />
      </div>
      {value.enabled ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border text-xs">
            <button
              type="button"
              onClick={() => onChange({ ...value, mode: "prozent" })}
              className={cn("px-2 py-1.5", value.mode === "prozent" && "bg-primary text-primary-foreground")}
            >
              {t("job.percent")}
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...value, mode: "fest" })}
              className={cn("px-2 py-1.5", value.mode === "fest" && "bg-primary text-primary-foreground")}
            >
              {t("job.perHourShort")}
            </button>
          </div>
          <Input
            type="number"
            inputMode="decimal"
            value={value.value}
            onChange={(e) => onChange({ ...value, value: Number(e.target.value) || 0 })}
            className="h-9"
          />
        </div>
      ) : null}
    </div>
  );
}
