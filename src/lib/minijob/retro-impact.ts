/**
 * D3 (Owner R4): Rückwirkende Änderungen nie still übernehmen.
 *
 * Vor dem Speichern (Eintrag anlegen/ändern/löschen, Abwesenheitszeitraum
 * anlegen/ändern/löschen) wird berechnet, ob sich die Bewertung ANDERER, bereits
 * gespeicherter Einträge ändert – z. B. weil ein nachgetragener Krankheitstag
 * eine bestehende Kette verlängert (42-Tage-Grenze), ein Urlaubsentgelt vom
 * 13-Wochen-Durchschnitt abhängt oder eine O-2-Bestätigung ihre Gültigkeit
 * verliert. Betroffene Monate werden mit Vorher/Nachher gezeigt; gespeichert
 * wird erst nach ausdrücklicher Bestätigung. Abbrechen ändert nichts.
 *
 * Reine Berechnung – ändert keine Daten. Dieselbe Bewertung (shiftPayroll +
 * gültige Bestätigungen) nutzen Dashboard, Verlauf und Exporte; daher zeigt die
 * Vorschau genau die Werte, die nach dem Speichern überall gelten.
 */
import { monthKey, payrollTotals, shiftPayroll } from "./payroll";
import { makeResolver } from "./resolve";
import { currentSickConfirmations } from "./sick-confirmation";
import type { Job, Settings, Shift } from "./types";

export interface RetroImpactMonth {
  /** "YYYY-MM" */
  month: string;
  /** Monatsentgelt vor der Änderung (alle Einträge des Monats). */
  before: number;
  /** Monatsentgelt nach der Änderung. */
  after: number;
}

export interface RetroImpact {
  /** Monate, in denen sich die Bewertung anderer Einträge ändert. */
  months: RetroImpactMonth[];
  /** Monate, deren O-2-Bestätigung durch die Änderung aufgehoben würde (D5). */
  lapsedMonths: string[];
}

const EPSILON = 0.005;

/**
 * @param before Bestand vor der Änderung
 * @param after Bestand nach der Änderung
 * @param changedIds Ids der direkt geänderten/neuen/gelöschten Einträge (deren
 *   eigene Werte zeigt der jeweilige Dialog bereits; hier zählen nur ANDERE).
 */
export function retroImpact(
  before: Shift[],
  after: Shift[],
  jobs: Job[],
  settings: Pick<
    Settings,
    "sickContinuousConfirmations" | "supplements" | "bundesland" | "defaultRate"
  >,
  changedIds: Iterable<string>,
): RetroImpact {
  const changed = new Set(changedIds);
  const confirmedBefore = currentSickConfirmations(
    settings.sickContinuousConfirmations,
    before,
    jobs,
  );
  const confirmedAfter = currentSickConfirmations(
    settings.sickContinuousConfirmations,
    after,
    jobs,
  );
  const resolveBefore = makeResolver(jobs, {
    ...(settings as Settings),
    sickContinuousConfirmations: confirmedBefore,
  });
  const resolveAfter = makeResolver(jobs, {
    ...(settings as Settings),
    sickContinuousConfirmations: confirmedAfter,
  });
  const beforeById = new Map(before.map((s) => [s.id, s]));
  const affected = new Set<string>();
  for (const shift of after) {
    if (changed.has(shift.id)) continue;
    const old = beforeById.get(shift.id);
    if (!old) continue;
    const was = shiftPayroll(old, { ...resolveBefore(old), history: before });
    const now = shiftPayroll(shift, { ...resolveAfter(shift), history: after });
    if (Math.abs(was.earnings - now.earnings) > EPSILON || was.paid !== now.paid) {
      affected.add(monthKey(shift.date));
    }
  }
  const months = [...affected].sort().map((month) => ({
    month,
    before: payrollTotals(
      before.filter((s) => monthKey(s.date) === month),
      resolveBefore,
      before,
    ).earnings,
    after: payrollTotals(
      after.filter((s) => monthKey(s.date) === month),
      resolveAfter,
      after,
    ).earnings,
  }));
  const stillValid = new Set(confirmedAfter.map((c) => c.month));
  const lapsedMonths = confirmedBefore.map((c) => c.month).filter((m) => !stillValid.has(m));
  return { months, lapsedMonths };
}

/** true = vor dem Speichern muss der Nutzer die Auswirkung bestätigen. */
export function needsRetroConfirmation(impact: RetroImpact): boolean {
  return impact.months.length > 0 || impact.lapsedMonths.length > 0;
}
