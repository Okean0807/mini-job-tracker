/**
 * O-2 (DECISIONS R2, Sick pay): Bestätigung der Neuberechnung nach der
 * Krankheitsfall-Fortsetzungsregel. Listet betroffene Monate mit
 * vorher/nachher. Ohne ausdrückliche Bestätigung wird NICHTS geändert.
 *
 * DECISIONS R3 Punkt 4: Der Hinweis lässt sich auf diesem Bildschirm
 * ausblenden, ohne Bestätigungen zu löschen oder zu setzen. Ändert sich die
 * Vorschau (z. B. nach Import/Ersetzen der Daten), erscheint er erneut.
 */
import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { formatEuro, monthNames } from "@/lib/minijob/calc";
import { sickRecalcPreview } from "@/lib/minijob/payroll";
import type { ResolveOptions } from "@/lib/minijob/resolve";
import type { Shift } from "@/lib/minijob/types";

export function SickRecalcNotice({
  shifts,
  resolve,
  onConfirm,
}: {
  shifts: Shift[];
  resolve: (shift: Shift) => ResolveOptions;
  /** Wird NUR beim Klick auf „neu berechnen“ mit den ausgewählten Monaten aufgerufen. */
  onConfirm: (months: string[]) => void;
}) {
  const { t } = useT();
  const preview = useMemo(() => sickRecalcPreview(shifts, resolve), [shifts, resolve]);
  const [open, setOpen] = useState(false);
  const [deselected, setDeselected] = useState<Set<string>>(() => new Set());
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const previewKey = useMemo(
    () =>
      preview.map((m) => `${m.month}:${m.days}:${m.before}:${m.after}:${m.reviewDays}`).join("|"),
    [preview],
  );

  if (preview.length === 0 || hiddenFor === previewKey) return null;
  const selected = preview.map((m) => m.month).filter((m) => !deselected.has(m));
  const label = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return `${monthNames()[(m ?? 1) - 1] ?? key} ${y}`;
  };

  return (
    <div
      data-testid="sick-recalc-notice"
      className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="w-full space-y-2">
        <p className="font-medium">{t("sickRecalc.title")}</p>
        <p className="text-xs leading-relaxed">{t("sickRecalc.body", { count: preview.length })}</p>
        {open ? (
          <>
            <ul className="space-y-1.5" data-testid="sick-recalc-months">
              {preview.map((m) => (
                <li key={m.month} data-month={m.month} className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4"
                    aria-label={label(m.month)}
                    checked={!deselected.has(m.month)}
                    onChange={(e) => {
                      const next = new Set(deselected);
                      if (e.target.checked) next.delete(m.month);
                      else next.add(m.month);
                      setDeselected(next);
                    }}
                  />
                  <span>
                    <span className="font-medium">{label(m.month)}</span>
                    {": "}
                    <span data-testid="sick-recalc-row">
                      {t("sickRecalc.row", {
                        days: m.days,
                        before: formatEuro(m.before),
                        after: formatEuro(m.after),
                      })}
                    </span>
                    {m.reviewDays > 0 ? (
                      <span className="block" data-testid="sick-recalc-review-days">
                        {t("sickRecalc.reviewDays", { count: m.reviewDays })}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {selected.length === 0 ? (
              <p className="text-xs">{t("sickRecalc.noneSelected")}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                data-testid="sick-recalc-confirm"
                disabled={selected.length === 0}
                onClick={() => {
                  onConfirm(selected);
                  setOpen(false);
                }}
              >
                {t("sickRecalc.confirm")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="sick-recalc-cancel"
                onClick={() => {
                  setOpen(false);
                  setDeselected(new Set());
                }}
              >
                {t("sickRecalc.cancel")}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              data-testid="sick-recalc-review"
              onClick={() => setOpen(true)}
            >
              {t("sickRecalc.review")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              data-testid="sick-recalc-hide"
              onClick={() => setHiddenFor(previewKey)}
            >
              {t("sickRecalc.hide")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
