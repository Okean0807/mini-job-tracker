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
import { deleteCustomTask, upsertCustomTask } from "@/lib/minijob/store";

interface CustomTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: string | null;
}

export function CustomTaskDialog({ open, onOpenChange, item }: CustomTaskDialogProps) {
  const { t } = useT();
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!open) return;
    setLabel(item ?? "");
  }, [open, item]);

  function submit() {
    if (!label.trim()) {
      toast.error(t("worklog.taskRequired"));
      return;
    }
    upsertCustomTask(label, item ?? undefined);
    toast.success(t("worklog.taskSaveOk"));
    onOpenChange(false);
  }

  function remove() {
    if (!item) return;
    deleteCustomTask(item);
    toast.success(t("worklog.taskDeleteOk"));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? t("worklog.editTask") : t("worklog.newTask")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="ct-label">{t("worklog.customTask")}</Label>
          <Input
            id="ct-label"
            value={label}
            placeholder={t("worklog.customTask")}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {item ? (
            <Button type="button" variant="destructive" onClick={remove}>
              <Trash2 className="size-4" /> {t("object.delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("action.cancel")}
            </Button>
            <Button type="button" onClick={submit}>
              {t("object.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
