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
import { deleteWorkCodeDef, upsertWorkCodeDef } from "@/lib/minijob/store";
import type { WorkCodeDef } from "@/lib/minijob/types";

interface WorkCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: WorkCodeDef | null;
}

export function WorkCodeDialog({ open, onOpenChange, item }: WorkCodeDialogProps) {
  const { t } = useT();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!open) return;
    setCode(item?.code ?? "");
    setLabel(item?.label ?? "");
  }, [open, item]);

  function submit() {
    if (!code.trim() || !label.trim()) {
      toast.error(t("worklog.workCodeRequired"));
      return;
    }
    upsertWorkCodeDef({ code, label }, item?.code);
    toast.success(t("worklog.workCodeSaveOk"));
    onOpenChange(false);
  }

  function remove() {
    if (!item) return;
    deleteWorkCodeDef(item.code);
    toast.success(t("worklog.workCodeDeleteOk"));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? t("worklog.editWorkCode") : t("worklog.newWorkCode")}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[4.5rem_1fr] gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="wc-code">{t("worklog.codeShort")}</Label>
            <Input
              id="wc-code"
              value={code}
              maxLength={4}
              placeholder={t("worklog.codeShort")}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wc-label">{t("worklog.codeLabel")}</Label>
            <Input
              id="wc-label"
              value={label}
              placeholder={t("worklog.codeLabel")}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
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
