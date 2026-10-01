import type { EmploymentType, Job, Shift } from "../types";

/**
 * Liefert die rechtliche Beschäftigungsart eines Jobs.
 *
 * Neue Datensätze sollten `employmentType` explizit setzen. Für bestehende
 * Daten wird der frühere UI-Modus deterministisch migriert:
 *   flex -> minijob
 *   fest -> hauptbeschaeftigung
 *   selbststaendig -> selbststaendig
 */
export function employmentTypeOf(job: Job | undefined): EmploymentType {
  if (!job) return "minijob";
  if (job.employmentType) return job.employmentType;
  if (job.mode === "fest") return "hauptbeschaeftigung";
  if (job.mode === "selbststaendig") return "selbststaendig";
  return "minijob";
}

/** Beschäftigung ist an diesem Datum aktiv (Grenzen inklusive). */
export function jobActiveOn(job: Job | undefined, date: string): boolean {
  if (!job) return true;
  if (job.startDate && date < job.startDate) return false;
  if (job.endDate && date > job.endDate) return false;
  return true;
}

/** Nur Jobs, deren Entgelt in die Minijob-Grenze gehört. */
export function isMinijobEmployment(job: Job | undefined): boolean {
  return employmentTypeOf(job) === "minijob";
}

/**
 * Prüft eine Schicht auf Minijob-Eignung.
 *
 * Eine nicht zugeordnete Schicht bleibt aus Rückwärtskompatibilität
 * minijobfähig; erst ein explizit zugeordneter Nicht-Minijob wird ausgeschlossen.
 */
export function isEligibleMinijobShift(shift: Shift, job: Job | undefined): boolean {
  if (!job) return true;
  return isMinijobEmployment(job) && jobActiveOn(job, shift.date);
}

/** Liefert alle eindeutig beteiligten Minijob-Jobs. */
export function minijobJobs(jobs: Job[]): Job[] {
  return jobs.filter((job) => isMinijobEmployment(job));
}
