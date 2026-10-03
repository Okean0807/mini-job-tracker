import { t } from "@/lib/i18n";
import { td } from "./document-i18n";

import { newId } from "./store";
import type { Job, Shift } from "./types";

/** Übersetzte Spaltenüberschriften für Export/Vorlage (nur für die Anzeige, der Parser ist sprachunabhängig). */
export function csvHeaders(): string[] {
  return [
    td("label.date"),
    td("label.start"),
    td("label.end"),
    td("label.break"),
    td("label.rate"),
    td("label.job"),
    td("label.note"),
  ];
}

export function csvTemplate(): string {
  return [
    csvHeaders().join(";"),
    `01.03.2026;09:00;17:00;30;13,50;Café Nord;${td("csv.template.note")}`,
    "2026-03-02;18:00;23:30;0;15,00;Café Nord;",
  ].join("\n");
}

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


/**
 * Spreadsheet apps (Excel, LibreOffice) treat cells starting with = + - @ or
 * tab/CR as formulas. User-controlled job names / notes must not trigger that
 * when a MiniJob CSV is opened. Prefix a single quote (Excel text marker).
 */
export function neutralizeCsvFormula(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

/** Undo neutralizeCsvFormula after re-import so round-trips keep the original text. */
export function stripCsvFormulaGuard(value: string): string {
  if (/^'[=+\-@\t\r]/.test(value)) return value.slice(1);
  return value;
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
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(v);
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

/** Lohnspalte: leer = nicht gesetzt (undefined), sonst der Wert (auch 0). */
function parseRateCell(value: string): number | null | undefined {
  if (!value.trim()) return undefined;
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

  const delimiter =
    (lines[0]!.match(/;/g)?.length ?? 0) >= (lines[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";

  // Sprachunabhängige Erkennung: Kopfzeile liegt vor, wenn die erste Zelle
  // sich nicht als Datum parsen lässt (unabhängig vom verwendeten Wort/Sprache).
  const firstCells = splitLine(lines[0]!, delimiter);
  const hasHeader = parseDate(firstCells[0] ?? "") === null;
  const body = hasHeader ? lines.slice(1) : lines;

  body.forEach((line, index) => {
    const cells = splitLine(line, delimiter);
    const errors: string[] = [];
    const [
      dateCell = "",
      startCell = "",
      endCell = "",
      breakCell = "",
      rateCell = "",
      jobCell = "",
      noteCell = "",
    ] = cells;

    const date = parseDate(dateCell);
    if (!date) errors.push(t("csv.error.date"));
    const start = parseTime(startCell);
    if (!start) errors.push(t("csv.error.start"));
    const end = parseTime(endCell);
    if (!end) errors.push(t("csv.error.end"));
    const breakMinutes = parseNumber(breakCell);
    if (breakMinutes === null || breakMinutes < 0) errors.push(t("csv.error.break"));
    const rate = parseRateCell(rateCell);
    if (rate === null || (rate !== undefined && rate < 0)) errors.push(t("csv.error.rate"));

    const row: CsvRow = {
      line: index + (hasHeader ? 2 : 1),
      raw: cells,
      errors,
    };

    const jobName = stripCsvFormulaGuard(jobCell.trim());
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
      };
      // Leere Lohnspalte = nicht gesetzt -> Fallback Job > Standard bleibt der
      // zentralen Lohnauflösung überlassen. Eine importierte 0 bleibt 0 EUR/h.
      if (rate !== undefined && rate !== null) shift.rate = rate;
      if (job) shift.jobId = job.id;
      const note = stripCsvFormulaGuard(noteCell.trim());
      if (note) shift.note = note;
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
  const lines = [csvHeaders().join(";")];
  for (const s of [...shifts].sort((a, b) => (a.date > b.date ? 1 : -1))) {
    lines.push(
      [
        s.date,
        s.start,
        s.end,
        String(s.breakMinutes ?? 0),
        typeof s.rate === "number" ? String(s.rate).replace(".", ",") : "",
        // Job name + note are free text → neutralize CSV/formula injection.
        neutralizeCsvFormula(jobs.find((j) => j.id === s.jobId)?.name ?? ""),
        neutralizeCsvFormula(s.note ?? ""),
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

/** Stable duplicate key for idempotent CSV imports. IDs are deliberately ignored. */
export function shiftImportKey(shift: Shift, jobs: Job[]): string {
  const jobName = jobs.find((j) => j.id === shift.jobId)?.name?.trim().toLowerCase() ?? "";
  return [
    shift.date,
    shift.start,
    shift.end,
    String(shift.breakMinutes ?? 0),
    typeof shift.rate === "number" ? String(shift.rate) : "",
    jobName,
    shift.kind,
    shift.note?.trim() ?? "",
  ].join("|");
}

export function duplicateShiftIndexes(incoming: Shift[], existing: Shift[], jobs: Job[]): Set<number> {
  const existingKeys = new Set(existing.map((s) => shiftImportKey(s, jobs)));
  const duplicates = new Set<number>();
  incoming.forEach((shift, index) => {
    const key = shiftImportKey(shift, jobs);
    if (existingKeys.has(key)) duplicates.add(index);
    existingKeys.add(key); // also deduplicates repeated rows within the same file
  });
  return duplicates;
}
