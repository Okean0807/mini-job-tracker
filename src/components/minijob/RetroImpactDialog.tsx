/**
 * D3 (Owner R4): Bestätigung rückwirkender Auswirkungen vor dem Speichern.
 * Zeigt betroffene Monate mit Vorher/Nachher und aufgehobene O-2-Bestätigungen.
 * „Abbrechen“ speichert nichts; nur „Übernehmen“ führt die Änderung aus.
 */
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
import { formatEuro, monthNames } from "@/lib/minijob/calc";
import type { RetroImpact } from "@/lib/minijob/retro-impact";

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${monthNames()[(m ?? 1) - 1] ?? key} ${y}`;
}

export function RetroImpactDialog({
  impact,
  onConfirm,
  onCancel,
}: {
  /** null = geschlossen */
  impact: RetroImpact | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  return (
    <AlertDialog open={impact !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <AlertDialogContent data-testid="retro-impact-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("retro.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("retro.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        {impact?.months.length ? (
          <ul className="space-y-1 text-sm" data-testid="retro-impact-months">
            {impact.months.map((m) => (
              <li key={m.month} data-month={m.month} data-testid="retro-impact-row">
                <span className="font-medium">{monthLabel(m.month)}</span>
                {": "}
                {t("retro.row", { before: formatEuro(m.before), after: formatEuro(m.after) })}
              </li>
            ))}
          </ul>
        ) : null}
        {impact?.lapsedMonths.length ? (
          <p
            className="text-sm text-amber-700 dark:text-amber-400"
            data-testid="retro-impact-lapsed"
          >
            {t("retro.lapsed", { months: impact.lapsedMonths.map(monthLabel).join(", ") })}
          </p>
        ) : null}
        <AlertDialogFooter>
          {/* Schließen (Abbrechen, Esc) läuft genau einmal über onOpenChange. */}
          <AlertDialogCancel data-testid="retro-impact-cancel">
            {t("retro.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="retro-impact-confirm"
            onClick={(event) => {
              // Nicht zusätzlich über onOpenChange als "Abbrechen" schließen;
              // der Aufrufer schließt durch impact = null.
              event.preventDefault();
              onConfirm();
            }}
          >
            {t("retro.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
