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

/**
 * Hinweis „mehrere Minijobs neben einer Hauptbeschäftigung“.
 *
 * Neben einer versicherungspflichtigen Hauptbeschäftigung bleibt nach § 8
 * Abs. 2 SGB IV nur EIN Minijob geringfügig – nach Auskunft der
 * Minijob-Zentrale der zeitlich zuerst aufgenommene; weitere Minijobs werden
 * mit der Hauptbeschäftigung zusammengerechnet. Die Grenzberechnung der App
 * bildet das bewusst NICHT ab (sie rechnet alle Minijobs gemeinsam). Diese
 * Funktion liefert nur einen vorsichtigen Hinweis, keine Rechtsfolge:
 * - "order_known": alle beteiligten Minijobs haben ein Beginndatum und der
 *   früheste ist eindeutig → „voraussichtlich“ erster Minijob benennbar;
 * - "order_unknown": Beginndaten fehlen oder sind gleich → Reihenfolge offen.
 */
export type MultipleMinijobsNotice =
  | { status: "none" }
  | { status: "order_known"; firstJobId: string; furtherJobIds: string[] }
  | { status: "order_unknown"; jobIds: string[] };

export function multipleMinijobsBesideMainJob(jobs: Job[], date: string): MultipleMinijobsNotice {
  const active = jobs.filter((job) => !job.archived && jobActiveOn(job, date));
  const hasMainJob = active.some((job) => employmentTypeOf(job) === "hauptbeschaeftigung");
  const minijobs = active.filter((job) => isMinijobEmployment(job));
  if (!hasMainJob || minijobs.length < 2) return { status: "none" };

  const starts = minijobs.map((job) => job.startDate);
  if (starts.some((start) => !start)) {
    return { status: "order_unknown", jobIds: minijobs.map((job) => job.id) };
  }
  const sorted = [...minijobs].sort((a, b) => a.startDate!.localeCompare(b.startDate!));
  if (sorted[0]!.startDate === sorted[1]!.startDate) {
    return { status: "order_unknown", jobIds: minijobs.map((job) => job.id) };
  }
  return {
    status: "order_known",
    firstJobId: sorted[0]!.id,
    furtherJobIds: sorted.slice(1).map((job) => job.id),
  };
}
