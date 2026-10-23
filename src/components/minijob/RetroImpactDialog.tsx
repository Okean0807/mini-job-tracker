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
import type { SickSplitImpact } from "@/lib/minijob/service";

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${monthNames()[(m ?? 1) - 1] ?? key} ${y}`;
}

/** "YYYY-MM-DD" → "DD.MM." (ohne Date-Parsing, zeitzonenfest). */
function dayLabel(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

export function RetroImpactDialog({
  impact,
  onConfirm,
  onCancel,
  sickSplit,
}: {
  /** null = geschlossen */
  impact: RetroImpact | null;
  /** t653u: Trennung eines Krankheitsfalls (Lücke ≥ 6 Tage) – Vorher/Nachher + Block → Fall. */
  sickSplit?: SickSplitImpact | undefined;
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
        {impact?.range ? (
          <div className="space-y-1 text-sm" data-testid="retro-impact-range">
            <p
              data-testid="retro-impact-range-row"
              data-days-before={impact.range.daysBefore}
              data-days-after={impact.range.daysAfter}
              data-before={impact.range.before.toFixed(2)}
              data-after={impact.range.after.toFixed(2)}
            >
              {t("retro.range", {
                daysBefore: String(impact.range.daysBefore),
                before: formatEuro(impact.range.before),
                daysAfter: String(impact.range.daysAfter),
                after: formatEuro(impact.range.after),
              })}
            </p>
            {impact.range.lostInRange.length ? (
              <p
                className="text-amber-700 dark:text-amber-400"
                data-testid="retro-impact-range-lost"
                data-days={impact.range.lostInRange.join(",")}
              >
                {t("retro.rangeLost", { days: impact.range.lostInRange.map(dayLabel).join(", ") })}
              </p>
            ) : null}
          </div>
        ) : null}
        {impact?.cases && impact.cases.before !== impact.cases.after ? (
          <div className="space-y-1 text-sm" data-testid="retro-impact-cases">
            <p
              data-testid="retro-impact-cases-row"
              data-before={impact.cases.before}
              data-after={impact.cases.after}
            >
              {t("retro.cases", {
                before: String(impact.cases.before),
                after: String(impact.cases.after),
              })}
            </p>
            {impact.cases.newCaseStart ? (
              <p
                className="text-amber-700 dark:text-amber-400"
                data-testid="retro-impact-new-case"
                data-start={impact.cases.newCaseStart}
              >
                {t("retro.newCase", { date: dayLabel(impact.cases.newCaseStart) })}
              </p>
            ) : null}
          </div>
        ) : null}
        {impact && sickSplit ? (
          <div
            className="space-y-1 rounded-md border border-amber-300 p-2 text-sm text-amber-800 dark:text-amber-300"
            data-testid="retro-impact-split"
          >
            <p className="font-medium">{t("retro.splitTitle")}</p>
            <p
              data-testid="retro-impact-split-totals"
              data-before={`${sickSplit.before.cases}/${sickSplit.before.days}/${sickSplit.before.paidDays}/${sickSplit.before.eur.toFixed(2)}`}
              data-after={`${sickSplit.after.cases}/${sickSplit.after.days}/${sickSplit.after.paidDays}/${sickSplit.after.eur.toFixed(2)}`}
            >
              {t("retro.splitTotals", {
                casesBefore: String(sickSplit.before.cases),
                casesAfter: String(sickSplit.after.cases),
                daysBefore: String(sickSplit.before.days),
                daysAfter: String(sickSplit.after.days),
                paidBefore: String(sickSplit.before.paidDays),
                paidAfter: String(sickSplit.after.paidDays),
                eurBefore: formatEuro(sickSplit.before.eur),
                eurAfter: formatEuro(sickSplit.after.eur),
              })}
            </p>
            <ul className="space-y-0.5">
              {sickSplit.moves.map((m) => (
                <li
                  key={m.from}
                  data-testid="retro-impact-split-move"
                  data-from={m.from}
                  data-to={m.to}
                  data-days={m.days}
                  data-from-case={m.fromCaseStart}
                  data-to-case={m.toCaseStart}
                  data-to-new={m.toCaseNew ? "1" : "0"}
                >
                  {t("retro.splitMove", {
                    range:
                      m.from === m.to ? dayLabel(m.from) : `${dayLabel(m.from)}–${dayLabel(m.to)}`,
                    days: String(m.days),
                    fromCase: m.fromCaseStart
                      ? t("retro.splitCase", { date: dayLabel(m.fromCaseStart) })
                      : t("retro.splitNoCase"),
                    toCase: t(m.toCaseNew ? "retro.splitNewCase" : "retro.splitCase", {
                      date: dayLabel(m.toCaseStart),
                    }),
                  })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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
