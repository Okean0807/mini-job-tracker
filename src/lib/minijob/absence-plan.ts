import { eachIsoDateInclusive } from "./absence-range";
import { absenceDraftForDate } from "./schedule";
import { newId } from "./store";
import type { Job, Shift, ShiftKind } from "./types";

/**
 * Zeitraum einer Abwesenheit speichern, OHNE bestehende Einträge unnötig zu löschen.
 *
 * Bisher wurden beim Bearbeiten alle Einträge des Blocks gelöscht und neu erzeugt: IDs und Notizen
 * gingen verloren, und Tage, die der aktuelle Wochenplan nicht mehr kennt, verschwanden. Jetzt wird
 * nur die Differenz angewendet:
 * - Einträge des bearbeiteten Blocks INNERHALB des neuen Zeitraums bleiben (ID, Notiz, Zeiten);
 * - Einträge des Blocks AUSSERHALB des neuen Zeitraums werden gelöscht (nur diese);
 * - fehlende Tage werden mit dem am Datum gültigen Wochenplan ergänzt, aber nie dort, wo der Job
 *   schon einen Eintrag hat (keine Duplikate, Arbeit wird nicht überschrieben);
 * - geänderte Art: die Einträge werden an Ort und Stelle umgestellt (Notiz bleibt);
 * - geänderter Job: Einträge ziehen mit um, außer der neue Job hat an dem Tag schon einen Eintrag;
 * - unverändert speichern ist ein No-op.
 */
export interface AbsenceEditInput {
  job: Job;
  kind: ShiftKind;
  from: string;
  to: string;
  bundesland: string;
  /** IDs des bearbeiteten Blocks (contiguousAbsenceRange). Leer = neue Abwesenheit. */
  previousIds?: readonly string[];
  /** Alle bekannten Einträge. */
  existing: readonly Shift[];
}

export interface AbsenceEditPlan {
  /** Neu anzulegende Einträge. */
  created: Shift[];
  /** Geänderte, bereits vorhandene Einträge (gleiche ID). */
  updated: Shift[];
  /** IDs, die aus dem Zeitraum gefallen sind. */
  deleteIds: string[];
}

export function planAbsenceEdit(input: AbsenceEditInput): AbsenceEditPlan {
  const { job, kind, bundesland } = input;
  const lo = input.from <= input.to ? input.from : input.to;
  const hi = input.from <= input.to ? input.to : input.from;
  const previousIds = new Set(input.previousIds ?? []);
  const previous = input.existing.filter((s) => previousIds.has(s.id));
  const inRange = (date: string) => date >= lo && date <= hi;

  // Ein Krankheitsfall pro Zeitraum: vorhandene ID weiterverwenden, sonst eine neue.
  const keptCaseId = previous.find((s) => s.jobId === job.id && s.sickCaseId)?.sickCaseId;
  const caseId = kind === "krank" ? (keptCaseId ?? newId()) : undefined;

  // Tage, die der Job nach dem Speichern belegt hält (andere Einträge + behaltene).
  const occupied = new Set(
    input.existing.filter((s) => s.jobId === job.id && !previousIds.has(s.id)).map((s) => s.date),
  );

  const updated: Shift[] = [];
  const deleteIds: string[] = [];

  for (const entry of previous) {
    if (!inRange(entry.date)) {
      deleteIds.push(entry.id);
      continue;
    }
    const sameJob = entry.jobId === job.id;
    if (!sameJob && occupied.has(entry.date)) {
      // Der neue Job hat an dem Tag schon einen Eintrag: nichts doppelt anlegen.
      deleteIds.push(entry.id);
      continue;
    }
    occupied.add(entry.date);
    if (sameJob && entry.kind === kind) continue; // unverändert behalten
    const { sickCaseId: _oldCase, rate: _oldRate, ...rest } = entry;
    updated.push({
      ...rest,
      jobId: job.id,
      kind,
      ...(sameJob && typeof entry.rate === "number"
        ? { rate: entry.rate }
        : typeof job.rate === "number"
          ? { rate: job.rate }
          : {}),
      ...(caseId ? { sickCaseId: caseId } : {}),
    });
  }

  const created: Shift[] = [];
  for (const date of eachIsoDateInclusive(lo, hi)) {
    if (occupied.has(date)) continue;
    const draft = absenceDraftForDate(job, kind, date, bundesland, caseId);
    if (draft) created.push(draft);
  }

  return { created, updated, deleteIds };
}

export function isEmptyAbsencePlan(plan: AbsenceEditPlan): boolean {
  return plan.created.length === 0 && plan.updated.length === 0 && plan.deleteIds.length === 0;
}
