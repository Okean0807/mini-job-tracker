/**
 * XLSX is intentionally confined to this write-only adapter.
 * Never add workbook parsing/read APIs here: the application must not accept
 * untrusted XLS/XLSX workbooks through SheetJS.
 */
import * as XLSX from "xlsx";

export type XlsxSheet = ReturnType<typeof XLSX.utils.json_to_sheet>;
export type XlsxBook = ReturnType<typeof XLSX.utils.book_new>;

export function createXlsxBook(): XlsxBook {
  return XLSX.utils.book_new();
}

export function createXlsxSheet(rows: Record<string, unknown>[]): XlsxSheet {
  return XLSX.utils.json_to_sheet(rows);
}

export function appendXlsxSheet(book: XlsxBook, sheet: XlsxSheet, name: string): void {
  XLSX.utils.book_append_sheet(book, sheet, name);
}

export function writeXlsx(book: XlsxBook): ArrayBuffer {
  return XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}
