import { isPlainRecord } from "./payload";

/**
 * Strikte Prüfung einer vom Nutzer gewählten JSON-Sicherung, *bevor* irgendetwas
 * übernommen wird. Bewusst strenger als `isValidPayload` (das auch Cloud-Payloads
 * prüft und tolerant bleiben muss).
 *
 * Es wird nichts repariert oder ergänzt: eine Sicherung mit unplausiblen Daten
 * wird abgelehnt, statt still verändert zu werden. Altbestände bleiben gültig,
 * weil nur Felder verlangt werden, die jede Version geschrieben hat (id, Datum,
 * Zeiten, Job-Name). `kind`, `breakMinutes`, `settings`, `timer` und die
 * Nebenlisten sind optional (siehe `normalize` im Store).
 */
export interface BackupIssue {
  /** z. B. `shifts[3].date` */
  path: string;
  code:
    | "not-object"
    | "not-array"
    | "not-record"
    | "missing"
    | "type"
    | "format"
    | "range"
    | "duplicate"
    | "unknown-ref";
}

export type BackupValidation = { ok: true } | { ok: false; issues: BackupIssue[] };

const MAX_ISSUES = 20;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^(\d{2}):(\d{2})$/;
const SHIFT_KINDS = ["arbeit", "urlaub", "krank", "feiertag", "frei", "sonstige"];
const WORK_MODES = ["flex", "fest", "selbststaendig"];
const EMPLOYMENT_TYPES = ["minijob", "hauptbeschaeftigung", "kurzfristig", "selbststaendig"];
const SIDE_LISTS = ["customers", "projects", "payments", "goals", "orders", "objects"] as const;

function isIsoDate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function isClock(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const m = CLOCK.exec(value);
  return m !== null && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validateBackup(raw: unknown): BackupValidation {
  const issues: BackupIssue[] = [];
  const add = (path: string, code: BackupIssue["code"]) => {
    if (issues.length < MAX_ISSUES) issues.push({ path, code });
  };

  if (!isPlainRecord(raw)) return { ok: false, issues: [{ path: "$", code: "not-object" }] };
  const root: Record<string, unknown> = raw;

  function list(key: string, required: boolean): Record<string, unknown>[] {
    const value = root[key];
    if (value === undefined) {
      if (required) add(key, "missing");
      return [];
    }
    if (!Array.isArray(value)) {
      add(key, "not-array");
      return [];
    }
    const rows: Record<string, unknown>[] = [];
    value.forEach((row, i) => {
      if (isPlainRecord(row)) rows.push(row);
      else add(`${key}[${i}]`, "not-record");
    });
    return rows;
  }

  function ids(key: string, rows: Record<string, unknown>[]): Set<string> {
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      if (!isNonEmptyString(row["id"])) return add(`${key}[${i}].id`, "missing");
      if (seen.has(row["id"])) return add(`${key}[${i}].id`, "duplicate");
      seen.add(row["id"]);
    });
    return seen;
  }

  const jobs = list("jobs", true);
  const shifts = list("shifts", true);
  const jobIds = ids("jobs", jobs);
  ids("shifts", shifts);

  jobs.forEach((job, i) => {
    const at = (field: string) => `jobs[${i}].${field}`;
    if (!isNonEmptyString(job["name"])) add(at("name"), "missing");
    if (job["rate"] !== undefined && (!isFiniteNumber(job["rate"]) || job["rate"] < 0)) {
      add(at("rate"), isFiniteNumber(job["rate"]) ? "range" : "type");
    }
    if (job["mode"] !== undefined && !WORK_MODES.includes(job["mode"] as string)) {
      add(at("mode"), "format");
    }
    if (
      job["employmentType"] !== undefined &&
      !EMPLOYMENT_TYPES.includes(job["employmentType"] as string)
    ) {
      add(at("employmentType"), "format");
    }
    for (const field of ["startDate", "endDate"]) {
      if (job[field] !== undefined && !isIsoDate(job[field])) add(at(field), "format");
    }
  });

  shifts.forEach((shift, i) => {
    const at = (field: string) => `shifts[${i}].${field}`;
    if (shift["date"] === undefined) add(at("date"), "missing");
    else if (!isIsoDate(shift["date"])) add(at("date"), "format");
    for (const field of ["start", "end"]) {
      if (shift[field] === undefined) add(at(field), "missing");
      else if (!isClock(shift[field])) add(at(field), "format");
    }
    if (shift["kind"] !== undefined && !SHIFT_KINDS.includes(shift["kind"] as string)) {
      add(at("kind"), "format");
    }
    const brk = shift["breakMinutes"];
    if (brk !== undefined && (!isFiniteNumber(brk) || brk < 0 || brk > 24 * 60)) {
      add(at("breakMinutes"), isFiniteNumber(brk) ? "range" : "type");
    }
    const rate = shift["rate"];
    if (rate !== undefined && (!isFiniteNumber(rate) || rate < 0)) {
      add(at("rate"), isFiniteNumber(rate) ? "range" : "type");
    }
    const jobId = shift["jobId"];
    if (jobId !== undefined && jobId !== "") {
      if (typeof jobId !== "string") add(at("jobId"), "type");
      else if (!jobIds.has(jobId)) add(at("jobId"), "unknown-ref");
    }
  });

  for (const key of SIDE_LISTS) {
    const rows = list(key, false);
    ids(key, rows);
    if (key === "payments" || key === "goals" || key === "orders") {
      rows.forEach((row, i) => {
        const jobId = row["jobId"];
        if (jobId === undefined || jobId === "") {
          if (key === "payments") add(`${key}[${i}].jobId`, "missing");
          return;
        }
        if (typeof jobId !== "string") add(`${key}[${i}].jobId`, "type");
        else if (!jobIds.has(jobId)) add(`${key}[${i}].jobId`, "unknown-ref");
      });
    }
  }

  const settings = root["settings"];
  if (settings !== undefined) {
    if (!isPlainRecord(settings)) add("settings", "not-record");
    else {
      for (const field of ["monthlyLimit", "defaultRate"]) {
        const v = settings[field];
        if (v !== undefined && (!isFiniteNumber(v) || v < 0)) {
          add(`settings.${field}`, isFiniteNumber(v) ? "range" : "type");
        }
      }
      // settings.activeJobId wird bewusst nicht gegen die Jobs geprüft: ein veralteter Verweis
      // kommt in eigenen Exporten vor und ist harmlos (die App fällt auf einen vorhandenen Job zurück).
    }
  }

  const timer = root["timer"];
  if (timer !== undefined && timer !== null) {
    if (!isPlainRecord(timer)) add("timer", "not-record");
    else {
      if (!isFiniteNumber(timer["startedAt"]) || timer["startedAt"] <= 0)
        add("timer.startedAt", "format");
      const brk = timer["breakMinutes"];
      if (!isFiniteNumber(brk) || brk < 0) add("timer.breakMinutes", "format");
      const jobId = timer["jobId"];
      if (jobId !== undefined && (typeof jobId !== "string" || !jobIds.has(jobId))) {
        add("timer.jobId", "unknown-ref");
      }
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
