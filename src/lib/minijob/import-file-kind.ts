/**
 * Client import routing by file name. Spreadsheet workbooks are rejected
 * before any byte is read: the SheetJS parser is not used for untrusted input
 * (see scripts/assert-xlsx-boundary.mjs); only CSV/TXT and JSON backups import.
 */
export type ImportFileKind = "json" | "spreadsheet" | "text";

/** Hard cap for every client import file, including JSON backups. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const SPREADSHEET_EXTENSIONS = [".xlsx", ".xls", ".xlsm", ".xlsb", ".ods"];

export function importFileKind(fileName: string): ImportFileKind {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (SPREADSHEET_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "spreadsheet";
  return "text";
}
