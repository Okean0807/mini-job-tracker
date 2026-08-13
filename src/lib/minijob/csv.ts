import { newId } from "./store";
import type { Job, Shift } from "./types";

export const CSV_HEADERS = [
  "Datum",
  "Beginn",
  "Ende",
  "Pause",
  "Stundenlohn",
  "Job",
  "Notiz",
] as const;

export const CSV_TEMPLATE = [
  CSV_HEADERS.join(";"),
  "01.03.2026;09:00;17:00;30;13,50;Café Nord;Frühschicht",
  "2026-03-02;18:00;23:30;0;15,00;Café Nord;",
].join("\n");

export interface CsvRow {
  line: number;
  raw: string[];
  shift?: Shift;
  jobName?: string;
  errors: string[];
}

export interface CsvParseResult {
  rows: CsvRow[];
  valid: CsvRow[];
  invalid: CsvRow[];
  /** Jobnamen, die noch nicht existieren und angelegt werden */
  newJobs: string[];
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseDate(value: string): string | null {
  const v = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}

function parseTime(value: string): string | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function parseNumber(value: string): number | null {
  if (!value.trim()) return 0;
  const n = Number(value.replace(/\s|€/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** CSV-Text in prüfbare Schichten umwandeln. */
export function parseCsv(
  text: string,
  options: { jobs: Job[]; defaultRate: number },
): CsvParseResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  const rows: CsvRow[] = [];
  const newJobs = new Set<string>();
  if (lines.length === 0) return { rows, valid: [], invalid: [], newJobs: [] };

  const delimiter = (lines[0]!.match(/;/g)?.length ?? 0) >= (lines[0]!.match(/,/g)?.length ?? 0)
    ? ";"
    : ",";

  const first = splitLine(lines[0]!, delimiter).map((c) => c.toLowerCase());
  const hasHeader = first.some((c) => c.includes("datum") || c.includes("date"));
  const body = hasHeader ? lines.slice(1) : lines;

  body.forEach((line, index) => {
    const cells = splitLine(line, delimiter);
    const errors: string[] = [];
    const [dateCell = "", startCell = "", endCell = "", breakCell = "", rateCell = "", jobCell = "", noteCell = ""] =
      cells;

    const date = parseDate(dateCell);
    if (!date) errors.push("Datum ungültig");
    const start = parseTime(startCell);
    if (!start) errors.push("Beginn ungültig");
    const end = parseTime(endCell);
    if (!end) errors.push("Ende ungültig");
    const breakMinutes = parseNumber(breakCell);
    if (breakMinutes === null || breakMinutes < 0) errors.push("Pause ungültig");
    const rate = parseNumber(rateCell);
    if (rate === null || rate < 0) errors.push("Stundenlohn ungültig");

    const row: CsvRow = {
      line: index + (hasHeader ? 2 : 1),
      raw: cells,
      errors,
    };

    const jobName = jobCell.trim();
    if (jobName) {
      row.jobName = jobName;
      if (!options.jobs.some((j) => j.name.toLowerCase() === jobName.toLowerCase())) {
        newJobs.add(jobName);
      }
    }

    if (errors.length === 0) {
      const job = options.jobs.find((j) => j.name.toLowerCase() === jobName.toLowerCase());
      const shift: Shift = {
        id: newId(),
        kind: "arbeit",
        date: date!,
        start: start!,
        end: end!,
        breakMinutes: breakMinutes!,
        rate: rate! || job?.rate || options.defaultRate,
      };
      if (job) shift.jobId = job.id;
      if (noteCell.trim()) shift.note = noteCell.trim();
      row.shift = shift;
    }

    rows.push(row);
  });

  return {
    rows,
    valid: rows.filter((r) => r.errors.length === 0),
    invalid: rows.filter((r) => r.errors.length > 0),
    newJobs: [...newJobs],
  };
}

export function shiftsToCsv(shifts: Shift[], jobs: Job[]): string {
  const esc = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [CSV_HEADERS.join(";")];
  for (const s of [...shifts].sort((a, b) => (a.date > b.date ? 1 : -1))) {
    lines.push(
      [
        s.date,
        s.start,
        s.end,
        String(s.breakMinutes ?? 0),
        String(s.rate ?? 0).replace(".", ","),
        jobs.find((j) => j.id === s.jobId)?.name ?? "",
        s.note ?? "",
      ]
        .map(esc)
        .join(";"),
    );
  }
  return lines.join("\n");
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob(["\uFEFF" + text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
