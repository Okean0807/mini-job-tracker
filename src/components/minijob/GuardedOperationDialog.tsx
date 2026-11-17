import { useEffect, useSyncExternalStore } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/lib/i18n";
import {
  getPendingConfirmation,
  registerConfirmationUi,
  subscribeConfirmation,
} from "@/lib/minijob/guarded-confirm";
import type { ManifestSummary } from "@/lib/minijob/guarded-operation";

function Side({ label, side, empty }: { label: string; side: ManifestSummary; empty: string }) {
  const { t } = useT();
  const other = side.totalRecords - side.counts.shifts - side.counts.jobs;
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-muted/30 p-2">
      <p className="text-[11px] font-medium">{label}</p>
      <p className="break-words text-[11px] text-muted-foreground">
        {side.totalRecords === 0
          ? empty
          : t("guarded.dialog.counts", {
              shifts: side.counts.shifts,
              jobs: side.counts.jobs,
              other,
            })}
      </p>
      {side.shiftDateRange ? (
        <p className="text-[11px] text-muted-foreground">
          {side.shiftDateRange.earliest} – {side.shiftDateRange.latest}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Zeigt den Vergleich jeder zerstörerischen Operation und verlangt die ausdrückliche
 * Bestätigung. Einmal global eingehängt; ohne diesen Dialog gilt jede Operation als NICHT bestätigt.
 */
export function GuardedOperationDialog() {
  const { t } = useT();
  const pending = useSyncExternalStore(subscribeConfirmation, getPendingConfirmation, () => null);
  useEffect(() => registerConfirmationUi(), []);
  const preview = pending?.preview ?? null;
  const rows = preview
    ? preview.collections.filter((c) => c.lost > 0 || c.added > 0 || c.changed > 0)
    : [];

  return (
    <AlertDialog
      open={preview !== null}
      onOpenChange={(open) => {
        if (!open) pending?.resolve(false);
      }}
    >
      <AlertDialogContent
        className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto"
        data-testid="guarded-dialog"
      >
        {preview ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`guarded.dialog.title.${preview.kind}`)}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(`guarded.dialog.replaces.${preview.replaces}`)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid grid-cols-2 gap-2">
              <Side
                label={t("guarded.dialog.current")}
                side={preview.current}
                empty={t("guarded.dialog.none")}
              />
              <Side
                label={t("guarded.dialog.incoming")}
                side={preview.incoming}
                empty={t("guarded.dialog.none")}
              />
            </div>
            {preview.identical ? (
              <p className="text-xs">{t("guarded.dialog.identical")}</p>
            ) : (
              <ul className="space-y-1 text-xs" data-testid="guarded-diff">
                {rows.map((c) => (
                  <li key={c.name} className="break-words">
                    <span className="font-medium">{t(`guarded.col.${c.name}`)}:</span>{" "}
                    {[
                      c.lost > 0 ? `${t("guarded.dialog.lost")} ${c.lost}` : null,
                      c.added > 0 ? `${t("guarded.dialog.added")} ${c.added}` : null,
                      c.changed > 0 ? `${t("guarded.dialog.changed")} ${c.changed}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </li>
                ))}
              </ul>
            )}
            {preview.settingsChangedKeys.length > 0 ? (
              <p className="break-words text-[11px] text-muted-foreground">
                {t("guarded.dialog.settings", { keys: preview.settingsChangedKeys.join(", ") })}
              </p>
            ) : null}
            {preview.integrity.length > 0 ? (
              <p className="text-[11px] text-destructive">
                {t("guarded.dialog.integrity", { n: preview.integrity.length })}
              </p>
            ) : null}
            {preview.snapshot.required ? (
              <p className="text-[11px] text-muted-foreground">{t("guarded.dialog.snapshot")}</p>
            ) : null}
            {preview.replaces === "local" ? (
              <p className="text-[11px] text-muted-foreground">{t("guarded.dialog.device")}</p>
            ) : null}
            <AlertDialogFooter className="gap-2">
              <AlertDialogCancel onClick={() => pending?.resolve(false)}>
                {t("guarded.dialog.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction onClick={() => pending?.resolve(true)}>
                {t("guarded.dialog.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
