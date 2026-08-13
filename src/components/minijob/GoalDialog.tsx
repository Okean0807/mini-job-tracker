import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { useT } from "@/lib/i18n";
import { deleteGoal, newId, saveGoal } from "@/lib/minijob/store";
import type { Goal, Job } from "@/lib/minijob/types";
import { cn } from "@/lib/utils";

interface GoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal?: Goal | null;
  jobs: Job[];
}

export function GoalDialog({ open, onOpenChange, goal, jobs }: GoalDialogProps) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("500");
  const [kind, setKind] = useState<"auto" | "manual">("auto");
  const [share, setShare] = useState("100");
  const [manualSaved, setManualSaved] = useState("0");
  const [jobId, setJobId] = useState("");
  const [from, setFrom] = useState("");
  const [deadline, setDeadline] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(goal?.name ?? "");
    setTarget(String(goal?.target ?? 500));
    setKind(goal?.kind ?? "auto");
    setShare(String(goal?.share ?? 100));
    setManualSaved(String(goal?.manualSaved ?? 0));
    setJobId(goal?.jobId ?? "");
    setFrom(goal?.from ?? "");
    setDeadline(goal?.deadline ?? "");
    setNote(goal?.note ?? "");
  }, [open, goal]);

  function num(value: string): number {
    return Number(value.replace(",", ".")) || 0;
  }

  function submit() {
    if (!name.trim()) {
      toast.error(t("goal.nameRequired"));
      return;
    }
    const next: Goal = {
      id: goal?.id ?? newId(),
      name: name.trim(),
      target: num(target),
      kind,
    };
    if (kind === "auto") next.share = Math.max(1, Math.min(100, num(share) || 100));
    else next.manualSaved = num(manualSaved);
    if (jobId) next.jobId = jobId;
    if (from) next.from = from;
    if (deadline) next.deadline = deadline;
    if (note.trim()) next.note = note.trim();
    saveGoal(next);
    toast.success(t("goal.saveOk"));
    onOpenChange(false);
  }

  function remove() {
    if (!goal) return;
    deleteGoal(goal.id);
    toast.success(t("goal.deleteOk"));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{goal ? t("goal.edit") : t("goal.new")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="goal-name">{t("goal.name")}</Label>
            <Input
              id="goal-name"
              value={name}
              placeholder={t("goal.namePh")}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="goal-target">{t("goal.target")}</Label>
            <Input
              id="goal-target"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("goal.kind")}</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["auto", "manual"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-sm font-medium",
                    kind === k ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
                  )}
                >
                  {t(`goal.kind.${k}`)}
                </button>
              ))}
            </div>
          </div>

          {kind === "auto" ? (
            <div className="space-y-1.5">
              <Label htmlFor="goal-share">{t("goal.share")}</Label>
              <Input
                id="goal-share"
                inputMode="numeric"
                value={share}
                onChange={(e) => setShare(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="goal-saved">{t("goal.saved")}</Label>
              <Input
                id="goal-saved"
                inputMode="decimal"
                value={manualSaved}
                onChange={(e) => setManualSaved(e.target.value)}
              />
            </div>
          )}

          {kind === "auto" && jobs.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="goal-job">{t("goal.job")}</Label>
              <select
                id="goal-job"
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">{t("goal.allJobs")}</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            {kind === "auto" ? (
              <div className="space-y-1.5">
                <Label htmlFor="goal-from">{t("goal.from")}</Label>
                <Input
                  id="goal-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="goal-deadline">{t("goal.deadline")}</Label>
              <Input
                id="goal-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="goal-note">{t("goal.note")}</Label>
            <Input id="goal-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {goal ? (
            <Button variant="outline" onClick={remove} className="text-destructive">
              <Trash2 className="size-4" /> {t("goal.delete")}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={submit}>{t("goal.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
