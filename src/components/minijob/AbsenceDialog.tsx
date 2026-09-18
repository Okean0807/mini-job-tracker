import { useEffect, useMemo, useState } from "react";
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
import { useT } from "@/lib/i18n";
import { contiguousAbsenceRange, isAbsenceKind } from "@/lib/minijob/absence-range";
import { addAbsence, removeAbsenceRange } from "@/lib/minijob/service";
import type { Job, Shift, ShiftKind } from "@/lib/minijob/types";
import { cn } from "@/lib/utils";

const ABSENCE_KINDS: Array<"urlaub" | "krank"> = ["urlaub", "krank"];

interface AbsenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: Job[];
  shifts: Shift[];
  /** Prefill when editing an existing absence entry. */
  seed?: Shift | null;
  /** Optional default start date (e.g. selected calendar day). */
  defaultFrom?: string;
  activeJobId?: string | undefined;
}

export function AbsenceDialog({
  open,
  onOpenChange,
  jobs,
  shifts,
  seed = null,
  defaultFrom,
  activeJobId,
}: AbsenceDialogProps) {
  const { t } = useT();
  const activeJobs = useMemo(() => jobs.filter((j) => !j.archived), [jobs]);
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const [kind, setKind] = useState<"urlaub" | "krank">("urlaub");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const editing = Boolean(seed && isAbsenceKind(seed.kind));

  useEffect(() => {
    if (!open) return;
    const fallbackJob =
      activeJobs.find((j) => j.id === (seed?.jobId ?? activeJobId)) ?? activeJobs[0];
    setJobId(fallbackJob?.id);
    if (seed && isAbsenceKind(seed.kind)) {
      const range = contiguousAbsenceRange(seed, shifts);
      setKind(seed.kind);
      setFrom(range.from);
      setTo(range.to);
    } else {
      setKind("urlaub");
      const start = defaultFrom ?? new Date().toISOString().slice(0, 10);
      setFrom(start);
      setTo(start);
    }
  }, [open, seed, shifts, activeJobs, activeJobId, defaultFrom]);

  const job = activeJobs.find((j) => j.id === jobId);
  const invalid = !job || !from || !to || from > to;

  function save() {
    if (!job || invalid) return;
    if (editing && seed && isAbsenceKind(seed.kind)) {
      // Drop previous contiguous block (possibly other kind) then write the new range.
      const prev = contiguousAbsenceRange(seed, shifts);
      removeAbsenceRange(seed.jobId ?? job.id, seed.kind, prev.from, prev.to);
      const created = addAbsence(job, kind, from, to);
      toast.success(t("absence.updated", { count: created.length }));
    } else {
      const created = addAbsence(job, kind, from, to);
      if (created.length === 0) {
        toast.message(t("absence.noneCreated"));
      } else {
        toast.success(t("absence.created", { count: created.length }));
      }
    }
    onOpenChange(false);
  }

  function removeRange() {
    if (!job || invalid) return;
    const n = removeAbsenceRange(job.id, kind, from, to);
    toast.success(t("absence.deleted", { count: n }));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t("absence.editTitle") : t("absence.newTitle")}</DialogTitle>
          <DialogDescription>{t("absence.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {activeJobs.length > 1 ? (
            <div className="grid gap-2">
              <Label>{t("label.job")}</Label>
              <div className="flex flex-wrap gap-2">
                {activeJobs.map((j) => (
                  <button
                    key={j.id}
                    type="button"
                    onClick={() => setJobId(j.id)}
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
            <div className="grid grid-cols-2 gap-1.5">
              {ABSENCE_KINDS.map((k) => (
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
              <Label htmlFor="absence-from">{t("absence.from")}</Label>
              <Input
                id="absence-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="absence-to">{t("absence.to")}</Label>
              <Input
                id="absence-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{t("absence.hint")}</p>
        </div>

        <DialogFooter className="mt-2 gap-2 sm:justify-between">
          {editing ? (
            <Button variant="ghost" className="text-destructive" onClick={removeRange}>
              {t("absence.deleteRange")}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={save} disabled={invalid}>
            {t("action.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
