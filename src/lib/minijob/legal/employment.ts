import type { Job, ResolvedEmploymentType, Shift } from "../types";

/**
 * Liefert die rechtliche Beschäftigungsart eines Jobs – einzige Quelle der
 * Wahrheit für alle Module (Grenzen, Rolling, Prognose, Warnungen, Dashboard,
 * Benachrichtigungen, Jahresbericht, KI-Kontext).
 *
 * Maßgeblich ist ausschließlich das Feld `employmentType`. Der Planungsmodus
 * `mode` (flex = freie Erfassung, fest = fester Wochenplan) sagt nichts über
 * den rechtlichen Status aus.
 *
 * Fallback nur für Altbestände ohne `employmentType`:
 *   flex           -> minijob        (bisheriges Standardverhalten der App)
 *   selbststaendig -> selbststaendig (Tätigkeitsart, kein Planungsmodus)
 *   fest           -> "unknown"      (weder Minijob noch Hauptbeschäftigung:
 *                                     Nutzerin muss die Art im Job wählen)
 */
export function employmentTypeOf(job: Job | undefined): ResolvedEmploymentType {
  if (!job) return "minijob";
  if (job.employmentType) return job.employmentType;
  if (job.mode === "selbststaendig") return "selbststaendig";
  if (job.mode === "fest") return "unknown";
  return "minijob";
}

/** Altbestand ohne bestätigte Beschäftigungsart (Hinweis „Beschäftigungsart wählen“). */
export function needsEmploymentTypeReview(job: Job | undefined): boolean {
  return employmentTypeOf(job) === "unknown";
}

/** Aktive (nicht archivierte) Jobs, deren Beschäftigungsart gewählt werden muss. */
export function jobsNeedingEmploymentType(jobs: Job[]): Job[] {
  return jobs.filter((job) => !job.archived && needsEmploymentTypeReview(job));
}

/** Beschäftigung ist an diesem Datum aktiv (Grenzen inklusive). */
export function jobActiveOn(job: Job | undefined, date: string): boolean {
  if (!job) return true;
  if (job.startDate && date < job.startDate) return false;
  if (job.endDate && date > job.endDate) return false;
  return true;
}

/** Nur Jobs, deren Entgelt in die Minijob-Grenze gehört ("unknown" gehört nicht dazu). */
export function isMinijobEmployment(job: Job | undefined): boolean {
  return employmentTypeOf(job) === "minijob";
}

/**
 * Prüft eine Schicht auf Minijob-Eignung.
 *
 * Eine nicht zugeordnete Schicht bleibt aus Rückwärtskompatibilität
 * minijobfähig; ein zugeordneter Nicht-Minijob oder ein ungeklärter
 * Altbestand ("unknown") wird ausgeschlossen.
 */
export function isEligibleMinijobShift(shift: Shift, job: Job | undefined): boolean {
  if (!job) return true;
  return isMinijobEmployment(job) && jobActiveOn(job, shift.date);
}

/** Liefert alle eindeutig beteiligten Minijob-Jobs. */
export function minijobJobs(jobs: Job[]): Job[] {
  return jobs.filter((job) => isMinijobEmployment(job));
}
