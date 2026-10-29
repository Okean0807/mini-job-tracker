import type { FixedDay, Job } from "./types";

/**
 * Wochenplan gültig an `date` (Phase A weekHistory).
 * History-Einträge speichern den *vorherigen* Plan mit effectiveFrom = Änderungsdatum;
 * für date < effectiveFrom gilt dieser Plan, sonst der aktuelle job.week.
 *
 * Eigene Datei (statt fest-time-account.ts), damit `schedule.ts` den Plan am Datum nutzen kann,
 * ohne einen Importzyklus mit fest-time-account → schedule zu erzeugen.
 */
export function weekForDate(job: Job, date: string): FixedDay[] | undefined {
  const sorted = [...(job.weekHistory ?? [])].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
  const futureChange = sorted.find((e) => e.effectiveFrom > date);
  if (futureChange) return futureChange.week;
  return job.week;
}

/** Wochentag-Index Mo=0 … So=6 eines YYYY-MM-DD-Datums (lokal, ohne UTC-Verschiebung). */
function weekdayIndexOf(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return (new Date(y!, (m ?? 1) - 1, d ?? 1).getDay() + 6) % 7;
}

/**
 * Plan-Status eines Tages für das ANLEGEN von Abwesenheiten. Gleiche Plan-Quelle wie die
 * Payroll (`weekForDate`):
 * - "work":    Plan am Datum vorhanden, Wochentag aktiv (mit `day` für die Zeiten);
 * - "off":     Plan am Datum vorhanden, Wochentag frei → keine Abwesenheit anlegen;
 * - "no-plan": Job hat für dieses Datum überhaupt keinen Wochenplan (flex) → Regel des Aufrufers;
 * - "unknown": Für das Datum gilt laut weekHistory ein historischer Plan, dessen Daten fehlen
 *              oder ungültig sind → NICHT raten (nicht auf den aktuellen Plan zurückfallen).
 */
export type AbsencePlanDay =
  | { status: "work"; day: FixedDay }
  | { status: "off" }
  | { status: "no-plan" }
  | { status: "unknown" };

export function absencePlanDay(
  job: Pick<Job, "week" | "weekHistory">,
  date: string,
): AbsencePlanDay {
  const week = weekForDate(job as Job, date);
  if (week === undefined || week === null) {
    const coveredByHistory = (job.weekHistory ?? []).some(
      (e) => typeof e?.effectiveFrom === "string" && e.effectiveFrom > date,
    );
    return coveredByHistory ? { status: "unknown" } : { status: "no-plan" };
  }
  if (!Array.isArray(week)) return { status: "unknown" };
  const day = week[weekdayIndexOf(date)];
  if (!day || typeof day !== "object") return { status: "unknown" };
  return day.active === true ? { status: "work", day } : { status: "off" };
}
