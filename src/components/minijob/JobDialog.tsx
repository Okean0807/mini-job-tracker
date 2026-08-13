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
import { WEEKDAYS_DE } from "@/lib/minijob/calc";
import { deleteJob, newId, nextJobColor, saveJob } from "@/lib/minijob/store";
import {
  DEFAULT_SUPPLEMENTS,
  EMPTY_WEEK,
  JOB_COLORS,
  WORK_MODE_LABEL,
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

export function JobDialog({ open, onOpenChange, job, defaultRate }: JobDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(JOB_COLORS[0]!);
  const [rate, setRate] = useState(String(defaultRate));
  const [mode, setMode] = useState<WorkMode>("flex");
  const [employer, setEmployer] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [week, setWeek] = useState<FixedDay[]>(EMPTY_WEEK);
  const [weeklyTarget, setWeeklyTarget] = useState("20");
  const [supplements, setSupplements] = useState<Supplements>(DEFAULT_SUPPLEMENTS);

  useEffect(() => {
    if (!open) return;
    setName(job?.name ?? "");
    setColor(job?.color ?? nextJobColor());
    setRate(String(job?.rate ?? defaultRate));
    setMode(job?.mode ?? "flex");
    setEmployer(job?.employer ?? "");
    setContact(job?.contact ?? "");
    setPhone(job?.phone ?? "");
    setEmail(job?.email ?? "");
    setAddress(job?.address ?? "");
    setWeek(job?.week ?? EMPTY_WEEK);
    setWeeklyTarget(String(job?.weeklyTarget ?? 20));
    setSupplements(job?.supplements ?? DEFAULT_SUPPLEMENTS);
  }, [open, job, defaultRate]);

  function save() {
    if (!name.trim()) {
      toast.error("Bitte einen Namen für den Job eingeben.");
      return;
    }
    const next: Job = {
      id: job?.id ?? newId(),
      name: name.trim(),
      color,
      rate: Number(rate.replace(",", ".")) || 0,
      mode,
      employer: employer.trim(),
      contact: contact.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      supplements,
    };
    if (mode === "fest") {
      next.week = week;
      next.weeklyTarget = Number(weeklyTarget.replace(",", ".")) || 0;
    }
    saveJob(next);
    toast.success(job ? "Job aktualisiert" : "Job angelegt");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{job ? "Job bearbeiten" : "Neuer Job"}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="basis">
          <TabsList className="w-full">
            <TabsTrigger value="basis" className="flex-1">
              Basis
            </TabsTrigger>
            <TabsTrigger value="kontakt" className="flex-1">
              Kontakt
            </TabsTrigger>
            <TabsTrigger value="zuschlag" className="flex-1">
              Zuschläge
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basis" className="mt-4 space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="job-name">Name</Label>
              <Input id="job-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="grid gap-2">
              <Label>Farbe</Label>
              <div className="flex flex-wrap gap-2">
                {JOB_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Farbe ${c}`}
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
              <Label>Arbeitsmodell</Label>
              <div className="grid gap-2">
                {(Object.keys(WORK_MODE_LABEL) as WorkMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-left text-sm",
                      mode === m ? "border-primary bg-primary/10 font-semibold" : "bg-card",
                    )}
                  >
                    {WORK_MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="job-rate">Stundenlohn (€)</Label>
              <Input
                id="job-rate"
                type="number"
                step="0.5"
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>

            {mode === "fest" ? (
              <div className="space-y-3 rounded-xl border p-3">
                <p className="text-sm font-semibold">Wochenplan</p>
                {week.map((day, idx) => (
                  <div key={WEEKDAYS_DE[idx]} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">{WEEKDAYS_DE[idx]}</span>
                      <Switch
                        checked={day.active}
                        onCheckedChange={(checked) =>
                          setWeek(week.map((d, i) => (i === idx ? { ...d, active: checked } : d)))
                        }
                        aria-label={`${WEEKDAYS_DE[idx]} aktiv`}
                      />
                    </div>
                    {day.active ? (
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          type="time"
                          value={day.start}
                          onChange={(e) =>
                            setWeek(
                              week.map((d, i) => (i === idx ? { ...d, start: e.target.value } : d)),
                            )
                          }
                        />
                        <Input
                          type="time"
                          value={day.end}
                          onChange={(e) =>
                            setWeek(
                              week.map((d, i) => (i === idx ? { ...d, end: e.target.value } : d)),
                            )
                          }
                        />
                        <Input
                          type="number"
                          min="0"
                          value={day.breakMinutes}
                          onChange={(e) =>
                            setWeek(
                              week.map((d, i) =>
                                i === idx ? { ...d, breakMinutes: Number(e.target.value) || 0 } : d,
                              ),
                            )
                          }
                          aria-label="Pause in Minuten"
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
                <div className="grid gap-2">
                  <Label htmlFor="soll">Sollstunden pro Woche</Label>
                  <Input
                    id="soll"
                    type="number"
                    inputMode="decimal"
                    value={weeklyTarget}
                    onChange={(e) => setWeeklyTarget(e.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="kontakt" className="mt-4 space-y-3">
            <Field label="Arbeitgeber" value={employer} onChange={setEmployer} />
            <Field label="Ansprechpartner" value={contact} onChange={setContact} />
            <Field label="Telefon" value={phone} onChange={setPhone} type="tel" />
            <Field label="E-Mail" value={email} onChange={setEmail} type="email" />
            <Field label="Adresse" value={address} onChange={setAddress} />
          </TabsContent>

          <TabsContent value="zuschlag" className="mt-4 space-y-3">
            <SupplementRow
              label="Samstag"
              value={supplements.saturday}
              onChange={(v) => setSupplements({ ...supplements, saturday: v })}
            />
            <SupplementRow
              label="Sonntag"
              value={supplements.sunday}
              onChange={(v) => setSupplements({ ...supplements, sunday: v })}
            />
            <SupplementRow
              label="Feiertag"
              value={supplements.holiday}
              onChange={(v) => setSupplements({ ...supplements, holiday: v })}
            />
            <SupplementRow
              label="Nacht"
              value={supplements.night}
              onChange={(v) => setSupplements({ ...supplements, night: v })}
            />
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">Nacht ab</Label>
                <Input
                  type="time"
                  value={supplements.nightStart}
                  onChange={(e) => setSupplements({ ...supplements, nightStart: e.target.value })}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Nacht bis</Label>
                <Input
                  type="time"
                  value={supplements.nightEnd}
                  onChange={(e) => setSupplements({ ...supplements, nightEnd: e.target.value })}
                />
              </div>
            </div>
            <SupplementRow
              label="Überstunden"
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
                toast.success("Job gelöscht");
                onOpenChange(false);
              }}
            >
              <Trash2 className="size-4" /> Löschen
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={save}>Speichern</Button>
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
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Switch
          checked={value.enabled}
          onCheckedChange={(enabled) => onChange({ ...value, enabled })}
          aria-label={`${label}-Zuschlag`}
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
              %
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...value, mode: "fest" })}
              className={cn("px-2 py-1.5", value.mode === "fest" && "bg-primary text-primary-foreground")}
            >
              €/h
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
