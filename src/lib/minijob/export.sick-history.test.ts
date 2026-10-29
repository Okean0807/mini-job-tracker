import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  write,
  json_to_sheet,
  book_new,
  book_append_sheet,
  output,
  text,
  setFontSize,
  jsPdfCtor,
  autoTableMock,
  saveAndRegisterBytes,
} = vi.hoisted(() => {
  const write = vi.fn(() => new Uint8Array([80, 75]).buffer);
  const json_to_sheet = vi.fn(() => ({ "!cols": undefined as unknown }));
  const book_new = vi.fn(() => ({}));
  const book_append_sheet = vi.fn();
  const output = vi.fn(() => new Uint8Array([37, 80, 68, 70]).buffer);
  const text = vi.fn();
  const setFontSize = vi.fn();
  const jsPdfCtor = vi.fn(function (this: unknown) {
    return { setFontSize, text, save: vi.fn(), output };
  });
  const autoTableMock = vi.fn();
  const saveAndRegisterBytes = vi.fn((opts: { filename: string; category: string }) => ({
    id: "gen-1",
    name: opts.filename,
    category: opts.category,
    mimeType: "application/octet-stream",
    size: 2,
    createdAt: new Date().toISOString(),
    dataUrl: "",
    source: "generated" as const,
  }));
  return {
    write,
    json_to_sheet,
    book_new,
    book_append_sheet,
    output,
    text,
    setFontSize,
    jsPdfCtor,
    autoTableMock,
    saveAndRegisterBytes,
  };
});

vi.mock("xlsx", () => ({
  utils: {
    json_to_sheet,
    book_new,
    book_append_sheet,
  },
  write,
  writeFile: vi.fn(),
}));

vi.mock("jspdf", () => ({
  jsPDF: jsPdfCtor,
}));

vi.mock("jspdf-autotable", () => ({
  default: autoTableMock,
}));

vi.mock("./generated-docs", () => ({
  saveAndRegisterBytes,
}));

import { exportPdf, exportXlsx } from "./export";
import { formatEuro, formatHours } from "./calc";
import { payrollTotals } from "./payroll";
import { makeResolver } from "./resolve";
import { generateAbsence } from "./schedule";
import { DEFAULT_SETTINGS, type FixedDay, type Job, type Shift } from "./types";

/**
 * QA P1 (Rest): Der PDF-/XLSX-Export aus der Statistik bewertete jeden Eintrag nur mit den exportierten
 * Einträgen als Historie. Ein im Vormonat begonnener Krankheitsfall „begann“ dadurch erst im
 * exportierten Monat, der Tag nach dem 42. Tag stand bezahlt im Bericht – der Bildschirmbetrag (volle
 * Historie) war ein anderer. Jetzt bewertet `ctx.history` mit der vollen Historie; exportiert werden
 * weiterhin genau die übergebenen Einträge.
 */
const day = (): FixedDay => ({ active: true, start: "08:00", end: "13:00", breakMinutes: 0 }); // 5 h
const JOB: Job = {
  id: "J",
  name: "Fest",
  color: "#123456",
  rate: 15,
  mode: "fest",
  employmentType: "minijob",
  startDate: "2026-01-01",
  week: [0, 1, 2, 3, 4, 5, 6].map(day),
} as Job;

const settings = { ...DEFAULT_SETTINGS, bundesland: "BE" };
const resolver = makeResolver([JOB], settings);
const baseCtx = { jobs: [JOB], bundesland: "BE", defaultRate: 15 };

// Fall 10.08.–09.10.2026: Kalendertag 42 = 20.09. (bezahlt), 21.09. = Tag 43 (unbezahlt)
const all: Shift[] = generateAbsence(JOB, "krank", "2026-08-10", "2026-10-09", "BE");
const september = all.filter((s) => s.date.startsWith("2026-09"));
const norm = (v: unknown) => String(v).replace(/\u00a0/g, " ");

beforeEach(() => {
  vi.clearAllMocks();
  json_to_sheet.mockReturnValue({ "!cols": undefined });
  book_new.mockReturnValue({});
  write.mockReturnValue(new Uint8Array([80, 75]).buffer);
  output.mockReturnValue(new Uint8Array([37, 80, 68, 70]).buffer);
});

const xlsxRows = () => (json_to_sheet.mock.calls[0] as unknown as [Record<string, unknown>[]])[0];
const pdfTable = () =>
  (autoTableMock.mock.calls[0] as unknown as [unknown, { body: string[][]; foot: string[][] }])[1];

describe("Export: Bildschirmsumme = Exportsumme (Krankheitsfall aus dem Vormonat)", () => {
  const screen = payrollTotals(september, resolver, all);

  it("Referenz: Bildschirm zählt 01.–20.09. (20 Tage × 75 €), nicht den ganzen Monat", () => {
    expect(screen.earnings).toBe(1500);
    expect(screen.paidAbsenceHours).toBe(100);
  });

  it("XLSX: Summenzeile und Tag 43 stimmen mit dem Bildschirm überein", () => {
    exportXlsx(september, "Bericht-September", { ...baseCtx, history: all });
    const rows = xlsxRows();
    expect(rows).toHaveLength(september.length + 1); // genau die Monatszeilen + Summe
    const totalRow = Object.values(rows[rows.length - 1]!);
    expect(totalRow[9]).toBe(screen.earnings);
    expect(totalRow[6]).toBe(screen.paidAbsenceHours);
    const day43 = rows.find((r) => String(Object.values(r)[0]).startsWith("21.09.2026"))!;
    expect(Object.values(day43)[9]).toBe(0);
    expect(Object.values(day43)[6]).toBe(0);
    const day42 = rows.find((r) => String(Object.values(r)[0]).startsWith("20.09.2026"))!;
    expect(Object.values(day42)[9]).toBe(75);
  });

  it("PDF: Fußsumme und Tag 43 stimmen mit dem Bildschirm überein", () => {
    exportPdf(september, "Bericht-September", { ...baseCtx, history: all });
    const { body, foot } = pdfTable();
    expect(body).toHaveLength(september.length);
    expect(norm(foot[0]![7])).toBe(norm(formatEuro(screen.earnings, "de")));
    expect(norm(foot[0]![5])).toBe(norm(formatHours(screen.paidAbsenceHours, "de")));
    const row43 = body.find((r) => String(r[0]).startsWith("21.09.2026"))!;
    expect(norm(row43[7])).toBe(norm(formatEuro(0, "de")));
    const row42 = body.find((r) => String(r[0]).startsWith("20.09.2026"))!;
    expect(norm(row42[7])).toBe(norm(formatEuro(75, "de")));
  });

  it("Zeilen und Zeitraum bleiben unverändert: nur die übergebenen Einträge, nicht die ganze Historie", () => {
    exportXlsx(september, "Bericht-September", { ...baseCtx, history: all });
    const dates = xlsxRows()
      .slice(0, -1)
      .map((r) => String(Object.values(r)[0]));
    expect(dates.every((d) => d.endsWith(".09.2026"))).toBe(true);
    expect(dates).toHaveLength(30);
    expect(all.length).toBeGreaterThan(september.length);
  });

  it("ohne `history` gilt wie bisher der Export selbst als Historie (Abwärtskompatibilität)", () => {
    exportXlsx(september, "Bericht-September", baseCtx);
    const totalRow = Object.values(xlsxRows().at(-1)!);
    // Der Fall „beginnt“ am 01.09.: alle 30 Septembertage bezahlt – genau der alte Fehler, wenn
    // der Aufrufer nur einen Ausschnitt exportiert und keine Historie mitgibt.
    expect(totalRow[9]).toBe(30 * 75);
  });

  it("Jahresexport: ein im Dezember begonnener Fall wird im Januar-Export korrekt bewertet", () => {
    const winter = generateAbsence(JOB, "krank", "2025-12-10", "2026-02-08", "BE");
    const year2026 = winter.filter((s) => s.date.startsWith("2026"));
    const expected = payrollTotals(year2026, resolver, winter);
    exportXlsx(year2026, "Bericht-2026", { ...baseCtx, history: winter });
    const totalRow = Object.values(xlsxRows().at(-1)!);
    expect(totalRow[9]).toBe(expected.earnings);
    expect(expected.earnings).toBeLessThan(year2026.length * 75);
  });
});

describe("Einstellungen-Export (alle Einträge) und Fallback bleiben unverändert", () => {
  it("Export aller Einträge mit und ohne `history` ist identisch", () => {
    exportXlsx(all, "alle", baseCtx);
    const without = JSON.stringify(xlsxRows());
    vi.clearAllMocks();
    json_to_sheet.mockReturnValue({ "!cols": undefined });
    book_new.mockReturnValue({});
    write.mockReturnValue(new Uint8Array([80, 75]).buffer);
    exportXlsx(all, "alle", { ...baseCtx, history: all });
    expect(JSON.stringify(xlsxRows())).toBe(without);
  });
});
