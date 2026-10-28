import { AlertTriangle, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  applyPreparedBackup,
  issueSummary,
  prepareBackupFile,
  undoBackupRestore,
  type ApplyResult,
  type BackupSource,
  type PreparedBackup,
} from "@/lib/minijob/backup-restore";
import { getData } from "@/lib/minijob/store";
import { isoDate } from "@/lib/minijob/calc";
import { useT } from "@/lib/i18n";

/** Aktuellen Stand als JSON-Datei herunterladen (ohne BOM, damit er wieder importierbar ist). */
export function downloadCurrentBackup() {
  const blob = new Blob([JSON.stringify(getData(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `minijob-backup-${isoDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

interface Options {
  /** Fehler/Hinweis anzeigen (zusätzlich zum Toast). */
  onError?: (message: string) => void;
  /** Wiederherstellung wurde angewendet. */
  onRestored?: () => void;
}

/**
 * Gemeinsamer Ablauf beider Wiederherstellungswege: Datei prüfen → Bestätigung
 * anzeigen → erst dann ersetzen (mit „Rückgängig“). Vor der Bestätigung ändert
 * sich nichts.
 */
export function useBackupRestore({ onError, onRestored }: Options = {}) {
  const { t } = useT();
  const [pending, setPending] = useState<PreparedBackup | null>(null);

  function report(message: string) {
    toast.error(message);
    onError?.(message);
  }

  async function pick(file: BackupSource) {
    setPending(null);
    let result;
    try {
      result = await prepareBackupFile(file);
    } catch {
      return report(t("restore.error"));
    }
    switch (result.status) {
      case "ready":
        setPending(result.prepared);
        return;
      case "too-large":
        return report(t("imp.fileTooLarge"));
      case "read-error":
        return report(t("imp.readError"));
      case "parse-error":
        return report(t("imp.jsonError"));
      case "invalid":
        return report(t("restore.invalid", { reason: issueSummary(result.issues) }));
      case "stale":
        return report(t("restore.stale"));
    }
  }

  function cancel() {
    setPending(null);
  }

  function failure(result: ApplyResult) {
    if (result.status === "stale") report(t("restore.stale"));
    else if (result.status === "persist-failed") report(t("restore.persistFailed"));
    else report(t("restore.error"));
  }

  function confirm() {
    if (!pending) return;
    const prepared = pending;
    setPending(null);
    const result = applyPreparedBackup(prepared);
    if (result.status !== "restored") return failure(result);
    const { previous } = result;
    toast.success(t("restore.success"), {
      duration: 20_000,
      action: {
        label: t("restore.undo"),
        onClick: () => {
          const undone = undoBackupRestore(previous, prepared.generation);
          if (undone.status === "restored") toast.success(t("restore.undone"));
          else failure(undone);
        },
      },
    });
    onRestored?.();
  }

  return { pending, pick, cancel, confirm };
}

interface SummaryProps {
  prepared: PreparedBackup;
  onCancel: () => void;
  onConfirm: () => void;
}

export function BackupRestoreSummary({ prepared, onCancel, onConfirm }: SummaryProps) {
  const { t } = useT();
  const { current, incoming } = prepared;
  const wipesWork =
    incoming.shifts === 0 && incoming.jobs === 0 && (current.shifts > 0 || current.jobs > 0);
  return (
    <div className="space-y-3" data-testid="restore-summary">
      <p className="flex gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>{t("restore.warn")}</span>
      </p>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl border p-3">
          <dt className="text-xs text-muted-foreground">{t("restore.current")}</dt>
          <dd data-testid="restore-current">
            {t("restore.counts", { shifts: current.shifts, jobs: current.jobs })}
          </dd>
        </div>
        <div className="rounded-xl border p-3">
          <dt className="text-xs text-muted-foreground">{t("restore.incoming")}</dt>
          <dd data-testid="restore-incoming">
            {t("restore.counts", { shifts: incoming.shifts, jobs: incoming.jobs })}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">{t("restore.replaced")}</p>
      {wipesWork ? (
        <p
          role="alert"
          className="text-xs font-medium text-destructive"
          data-testid="restore-wipes"
        >
          {t("restore.empty")}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("restore.syncHint")}</p>
      <Button variant="outline" className="w-full" onClick={downloadCurrentBackup}>
        <Download className="size-4" /> {t("restore.download")}
      </Button>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={onCancel}
          data-testid="restore-cancel"
        >
          {t("restore.cancel")}
        </Button>
        <Button
          variant="destructive"
          className="flex-1"
          onClick={onConfirm}
          data-testid="restore-confirm"
        >
          {t("restore.confirm")}
        </Button>
      </div>
    </div>
  );
}
