import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isoDate } from "@/lib/minijob/calc";
import { getData } from "@/lib/minijob/store";
import { useT } from "@/lib/i18n";

import { BackupRestoreSummary, useBackupRestore } from "./BackupRestore";

export function LocalBackup({ shiftCount }: { shiftCount: number }) {
  const { t } = useT();

  function download() {
    const blob = new Blob([JSON.stringify(getData(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `minijob-backup-${isoDate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("set.localBackup.created"));
  }

  // Gleicher Ablauf wie „Daten importieren“: prüfen, bestätigen, dann ersetzen.
  const restore = useBackupRestore();
  function upload(file: File) {
    void restore.pick(file);
  }

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-card">
      <h2 className="text-sm font-semibold">{t("set.localBackup.title")}</h2>
      <p className="text-xs text-muted-foreground">
        {t("set.localBackup.desc", { count: shiftCount })}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={download}>
          {t("set.localBackup.export")}
        </Button>
        <Button variant="outline" asChild>
          <label className="cursor-pointer">
            {t("set.localBackup.import")}
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload(file);
                e.target.value = "";
              }}
            />
          </label>
        </Button>
      </div>
      <Dialog open={restore.pending !== null} onOpenChange={(v) => !v && restore.cancel()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("restore.title")}</DialogTitle>
            <DialogDescription>{t("set.localBackup.title")}</DialogDescription>
          </DialogHeader>
          {restore.pending ? (
            <BackupRestoreSummary
              prepared={restore.pending}
              onCancel={restore.cancel}
              onConfirm={restore.confirm}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
