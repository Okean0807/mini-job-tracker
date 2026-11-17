import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import {
  deleteActiveSnapshot,
  deleteAllActiveSnapshots,
  getActiveSnapshotFile,
  listActiveSnapshots,
} from "@/lib/minijob/backup-safety-active";
import { SnapshotError, type SnapshotSummary } from "@/lib/minijob/backup-safety";
import { onScopeChange } from "@/lib/minijob/store";

/**
 * Wiederherstellungspunkte des AKTIVEN Kontos: anzeigen, herunterladen, löschen.
 * Bewusst KEIN Zurückspielen (folgt mit dem geführten Ablauf in einer späteren Phase).
 */
export function RecoveryPointsSection() {
  const { t } = useT();
  const [items, setItems] = useState<SnapshotSummary[] | null>(null);
  const [error, setError] = useState<"unavailable" | "read" | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listActiveSnapshots();
      setItems(list);
      setError(null);
    } catch (e) {
      setItems([]);
      setError(e instanceof SnapshotError && e.code === "unavailable" ? "unavailable" : "read");
    }
  }, []);

  useEffect(() => {
    // Kontowechsel: Liste sofort verwerfen, damit nie fremde Einträge stehen bleiben.
    const off = onScopeChange(() => {
      setItems(null);
      void refresh();
    });
    void refresh();
    return off;
  }, [refresh]);

  async function download(id: string) {
    try {
      const file = await getActiveSnapshotFile(id);
      const blob = new Blob([file.text], { type: file.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("backup.snap.downloaded"));
    } catch (e) {
      toast.error(
        e instanceof SnapshotError && e.code === "verification-failed"
          ? t("backup.snap.verifyError")
          : t("backup.snap.actionError"),
      );
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("backup.snap.deleteConfirm"))) return;
    try {
      await deleteActiveSnapshot(id);
      toast.success(t("backup.snap.deleted"));
    } catch {
      toast.error(t("backup.snap.actionError"));
    }
    await refresh();
  }

  async function removeAll() {
    if (!window.confirm(t("backup.snap.deleteAllConfirm"))) return;
    try {
      await deleteAllActiveSnapshots();
      toast.success(t("backup.snap.deletedAll"));
    } catch {
      toast.error(t("backup.snap.actionError"));
    }
    await refresh();
  }

  return (
    <section
      className="space-y-3 rounded-2xl border bg-card p-4 shadow-card"
      data-testid="recovery-points"
    >
      <h2 className="text-sm font-semibold">{t("backup.snap.title")}</h2>
      <p className="text-xs text-muted-foreground">{t("backup.snap.desc")}</p>
      <p className="text-xs text-muted-foreground" data-testid="recovery-privacy">
        {t("backup.snap.privacy")}
      </p>

      {items === null ? (
        <p className="text-xs text-muted-foreground">{t("backup.snap.loading")}</p>
      ) : error ? (
        <p className="text-xs text-destructive">
          {error === "unavailable" ? t("backup.snap.unavailable") : t("backup.snap.loadError")}
        </p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("backup.snap.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => {
            const other = s.totalRecords - s.counts.shifts - s.counts.jobs;
            return (
              <li key={s.id} className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="text-xs font-medium">{t(`backup.snap.kind.${s.kind}`)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(s.verifiedAt).toLocaleString()}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("backup.snap.counts", {
                    shifts: s.counts.shifts,
                    jobs: s.counts.jobs,
                    other,
                  })}
                  {" · "}
                  {t("backup.snap.size", { size: Math.max(1, Math.round(s.bytes / 1024)) })}
                </p>
                {s.shiftDateRange ? (
                  <p className="text-[11px] text-muted-foreground">
                    {t("backup.snap.range", {
                      from: s.shiftDateRange.earliest,
                      to: s.shiftDateRange.latest,
                    })}
                  </p>
                ) : null}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => void download(s.id)}>
                    {t("backup.snap.download")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void remove(s.id)}>
                    {t("backup.snap.delete")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {items && items.length > 0 ? (
        <Button variant="outline" size="sm" onClick={() => void removeAll()}>
          {t("backup.snap.deleteAll")}
        </Button>
      ) : null}
    </section>
  );
}
