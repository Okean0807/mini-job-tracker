import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  write,
  json_to_sheet,
  book_new,
  book_append_sheet,
  output,
  text,
  jsPdfCtor,
  autoTableMock,
} = vi.hoisted(() => {
  const write = vi.fn(() => new Uint8Array([80, 75]).buffer);
  const json_to_sheet = vi.fn(() => ({ "!cols": undefined as unknown }));
  const book_new = vi.fn(() => ({}));
  const book_append_sheet = vi.fn();
  const output = vi.fn(() => new Uint8Array([37, 80, 68, 70]).buffer);
  const text = vi.fn();
  const autoTableMock = vi.fn();
  // jsPDF-Attrappe: jede Zeichenmethode ist ein No-op, `text` wird aufgezeichnet.
  const jsPdfCtor = vi.fn(function (this: unknown) {
    return new Proxy(
      {},
      {
        get: (_t, key) => (key === "output" ? output : key === "text" ? text : vi.fn()),
      },
    );
  });
  return {
    write,
    json_to_sheet,
    book_new,
    book_append_sheet,
    output,
    text,
    jsPdfCtor,
    autoTableMock,
  };
});

vi.mock("xlsx", () => ({
  utils: { json_to_sheet, book_new, book_append_sheet },
  write,
  writeFile: vi.fn(),
}));
vi.mock("jspdf", () => ({ jsPDF: jsPdfCtor }));
vi.mock("jspdf-autotable", () => ({ default: autoTableMock }));
vi.mock("./generated-docs", () => ({
  saveAndRegisterBytes: vi.fn(() => ({ id: "gen-1" })),
}));

import { buildAnnualReport } from "./annual";
import { exportAnnualPdf, exportAnnualXlsx } from "./annual-export";
import { shiftsInMonth, shiftsInYear } from "./calc";
import { exportPdf, exportXlsx, PDF_LIST_MIN_WIDTHS } from "./export";
import { sollHoursFor, summarizeHours } from "./hours-summary";
import { payrollTotals } from "./payroll";
import { makeResolver } from "./resolve";
import { generateAbsence } from "./schedule";
import { DEFAULT_SETTINGS, type FixedDay, type Job, type Shift } from "./types";

/**
 * Ein Datensatz, fünf Darstellungen: Statistik, Monatsliste (PDF/XLSX), Jahresliste (PDF/XLSX) und
 * Jahresbericht (PDF/XLSX) müssen dieselben vier Stundenkennzahlen zeigen (gearbeitet, bezahlte
 * Abwesenheit, gesamt bezahlt, Soll) – und die Geldbeträge bleiben exakt die der bisherigen Berechnung.
 *
 * Plan Mo–Fr 4 h, 15 €/h. Krankheitsfall 15.09.–30.10.2026: 27.–30.10. liegen nach dem 42. Kalendertag
 * (unbezahlt). November: 3 Arbeitstage + 2 Urlaubstage.
 */
const day = (active: boolean): FixedDay => ({
  active,
  start: "08:00",
  end: "12:00",
  breakMinutes: 0,
});
const JOB: Job = {
  id: "J",
  name: "Fest",
  color: "#123456",
  rate: 15,
  mode: "fest",
  employmentType: "minijob",
  startDate: "2025-01-01",
  week: [true, true, true, true, true, false, false].map(day),
} as Job;
const settings = { ...DEFAULT_SETTINGS, bundesland: "BE" };
const resolver = makeResolver([JOB], settings);
const work = (date: string): Shift =>
  ({
    id: `w${date}`,
    jobId: "J",
    kind: "arbeit",
    date,
    start: "08:00",
    end: "12:00",
    breakMinutes: 0,
  }) as Shift;

const sick = generateAbsence(JOB, "krank", "2026-09-15", "2026-10-30", "BE");
const vacation = generateAbsence(JOB, "urlaub", "2026-11-05", "2026-11-06", "BE");
const all: Shift[] = [
  ...sick,
  work("2026-11-02"),
  work("2026-11-03"),
  work("2026-11-04"),
  ...vacation,
];
const ctx = { jobs: [JOB], bundesland: "BE", defaultRate: 15, history: all };
const norm = (v: unknown) => String(v).replace(/\u00a0/g, " ");

// Goldwerte der Geldbeträge VOR dieser Änderung (Stand c847eb2, gleiche Daten): unverändert.
const MONEY = { october: 1080, november: 300, year: 2100 };

beforeEach(() => {
  vi.clearAllMocks();
  json_to_sheet.mockReturnValue({ "!cols": undefined });
  book_new.mockReturnValue({});
  write.mockReturnValue(new Uint8Array([80, 75]).buffer);
  output.mockReturnValue(new Uint8Array([37, 80, 68, 70]).buffer);
});

const xlsxRows = (sheet = 0) =>
  (json_to_sheet.mock.calls[sheet] as unknown as [Record<string, unknown>[]])[0];
const pdfTable = () =>
  (
    autoTableMock.mock.calls[0] as unknown as [
      unknown,
      { head: string[][]; body: string[][]; foot: string[][] },
    ]
  )[1];
const pdfTexts = () => text.mock.calls.map((c) => norm(c[0]));

const october = shiftsInMonth(all, 2026, 9);
const november = shiftsInMonth(all, 2026, 10);
const yearList = shiftsInYear(all, 2026);

describe("Oktober 2026 (Szenario aus dem QA: 18 bezahlte Krankheitstage, 4 unbezahlte)", () => {
  const soll = sollHoursFor([JOB], 2026, 9, "BE");

  it("Statistik: gearbeitet 0, bezahlte Abwesenheit 72, gesamt 72, Soll 88; Geld unverändert", () => {
    const h = summarizeHours(october, resolver, all, soll);
    expect(h).toEqual({ worked: 0, paidAbsence: 72, paidTotal: 72, soll: 88 });
    expect(payrollTotals(october, resolver, all).earnings).toBe(MONEY.october);
  });

  it("Monats-XLSX zeigt dieselben vier Zahlen und denselben Betrag", () => {
    exportXlsx(october, "t", { ...ctx, sollHours: soll });
    const rows = xlsxRows();
    const total = rows[rows.length - 1]!;
    expect(total["Gearbeitete Stunden"]).toBe(0);
    expect(total["Bezahlte Abwesenheitsstunden"]).toBe(72);
    expect(total["Gesamtstunden bezahlt"]).toBe(72);
    expect(total["Soll-Stunden"]).toBe(88);
    expect(total["Verdienst (€)"]).toBe(MONEY.october);
  });

  it("Monats-PDF zeigt dieselben vier Zahlen und denselben Betrag", () => {
    exportPdf(october, "t", { ...ctx, sollHours: soll });
    const foot = pdfTable().foot[0]!;
    expect(norm(foot[8])).toBe("0,00 h");
    expect(norm(foot[9])).toBe("72,00 h");
    expect(norm(foot[5])).toBe("72,00 h");
    expect(norm(foot[7])).toBe("1.080,00 €");
    const lines = pdfTexts();
    expect(lines).toContain("Gearbeitete Stunden: 0,00 h");
    expect(lines).toContain("Bezahlte Abwesenheitsstunden: 72,00 h");
    expect(lines).toContain("Gesamtstunden bezahlt: 72,00 h");
    expect(lines).toContain("Soll-Stunden: 88,00 h");
  });
});

describe("November 2026 (Arbeit + Urlaub gemischt)", () => {
  const soll = sollHoursFor([JOB], 2026, 10, "BE");

  it("Statistik, Monats-XLSX und Monats-PDF stimmen überein; Geld unverändert", () => {
    const h = summarizeHours(november, resolver, all, soll);
    expect(h.worked).toBe(12);
    expect(h.paidAbsence).toBe(8);
    expect(h.paidTotal).toBe(20);
    expect(payrollTotals(november, resolver, all).earnings).toBe(MONEY.november);

    exportXlsx(november, "t", { ...ctx, sollHours: soll });
    const total = xlsxRows().at(-1)!;
    expect([
      total["Gearbeitete Stunden"],
      total["Bezahlte Abwesenheitsstunden"],
      total["Gesamtstunden bezahlt"],
      total["Soll-Stunden"],
    ]).toEqual([h.worked, h.paidAbsence, h.paidTotal, h.soll]);
    expect(total["Verdienst (€)"]).toBe(MONEY.november);

    vi.clearAllMocks();
    exportPdf(november, "t", { ...ctx, sollHours: soll });
    const foot = pdfTable().foot[0]!;
    expect([norm(foot[8]), norm(foot[9]), norm(foot[5])]).toEqual(["12,00 h", "8,00 h", "20,00 h"]);
    expect(norm(foot[7])).toBe("300,00 €");
  });
});

describe("Jahr 2026: Jahresliste und Jahresbericht", () => {
  const ySoll = sollHoursFor([JOB], 2026, null, "BE");
  const report = buildAnnualReport(all, [JOB], settings, 2026, resolver);

  it("Statistik-Jahr = Jahresbericht (gleiche Kennzahlen, gleiches Geld)", () => {
    const h = summarizeHours(yearList, resolver, all, ySoll);
    expect(h.worked).toBe(report.hours);
    expect(h.paidAbsence).toBe(report.absenceHours);
    expect(h.paidTotal).toBe(report.paidHours);
    expect(report.sollHours).toBe(ySoll);
    expect(report.earnings).toBe(MONEY.year);
    // 12 h gearbeitet + 128 h bezahlte Abwesenheit
    expect([h.worked, h.paidAbsence, h.paidTotal]).toEqual([12, 128, 140]);
  });

  it("Jahres-XLSX/-PDF (Liste) zeigen dieselben Zahlen wie der Bericht", () => {
    exportXlsx(yearList, "t", { ...ctx, sollHours: ySoll });
    const total = xlsxRows().at(-1)!;
    expect(total["Gearbeitete Stunden"]).toBe(report.hours);
    expect(total["Bezahlte Abwesenheitsstunden"]).toBe(report.absenceHours);
    expect(total["Gesamtstunden bezahlt"]).toBe(report.paidHours);
    expect(total["Soll-Stunden"]).toBe(ySoll);
    expect(total["Verdienst (€)"]).toBe(report.earnings);

    vi.clearAllMocks();
    exportPdf(yearList, "t", { ...ctx, sollHours: ySoll });
    const foot = pdfTable().foot[0]!;
    expect(norm(foot[8])).toBe("12,00 h");
    expect(norm(foot[9])).toBe("128,00 h");
    expect(norm(foot[5])).toBe("140,00 h");
  });

  it("Jahresbericht-XLSX: Monatsblatt und Übersicht tragen alle vier Kennzahlen", () => {
    exportAnnualXlsx(report);
    const overview = xlsxRows(0).map(
      (r) => `${r["Kennzahl"] ?? Object.values(r)[0]}=${norm(Object.values(r)[1])}`,
    );
    expect(overview).toContain("Gearbeitete Stunden=12,00 h");
    expect(overview).toContain("Bezahlte Abwesenheitsstunden=128,00 h");
    expect(overview).toContain("Gesamtstunden bezahlt=140,00 h");
    expect(overview.some((l) => l.startsWith("Soll-Stunden="))).toBe(true);
    const months = xlsxRows(1);
    const totalRow = months.at(-1)!;
    expect(totalRow["Gearbeitete Stunden"]).toBe(12);
    expect(totalRow["Bezahlte Abwesenheitsstunden"]).toBe(128);
    expect(totalRow["Gesamtstunden bezahlt"]).toBe(140);
    expect(totalRow["Verdienst (€)"]).toBe(MONEY.year);
  });

  it("Jahresbericht-PDF: Monatstabelle mit getrennten Stundenspalten und Summenzeile", () => {
    exportAnnualPdf(report);
    const monthTable = autoTableMock.mock.calls
      .map((c) => (c as unknown as [unknown, { head: string[][]; foot?: string[][] }])[1])
      .find((o) => o.head[0]?.includes("Gesamtstunden bezahlt"))!;
    expect(monthTable.head[0]).toEqual(
      expect.arrayContaining([
        "Gearbeitete Stunden",
        "Bezahlte Abwesenheitsstunden",
        "Gesamtstunden bezahlt",
      ]),
    );
    const foot = monthTable.foot![0]!.map(norm);
    expect(foot).toEqual(expect.arrayContaining(["12,00 h", "128,00 h", "140,00 h", "2.100,00 €"]));
  });
});

describe("Soll ohne festen Wochenplan", () => {
  it("ist nicht verfügbar (null → '–'), nie eine erfundene 0", () => {
    const hourly = { ...JOB, id: "H", mode: "flex" } as Job;
    expect(sollHoursFor([hourly], 2026, 9, "BE")).toBeNull();
    exportXlsx(october, "t", { ...ctx, sollHours: null });
    expect(xlsxRows().at(-1)!["Soll-Stunden"]).toBe("–");
    vi.clearAllMocks();
    exportPdf(october, "t", { ...ctx, sollHours: null });
    expect(pdfTexts()).toContain("Soll-Stunden: –");
  });
});

describe("Listen-PDF: Layout-Einstellungen (Lesbarkeit; das Rendering prüft zusätzlich der visuelle Check)", () => {
  it("Querformat A4, jede der 10 Spalten hat eine Mindestbreite, Datum >= 22 mm", () => {
    exportPdf(october, "t", { ...ctx, sollHours: 88 });
    expect(jsPdfCtor).toHaveBeenCalledWith({ orientation: "landscape", format: "a4" });
    const opts = (
      autoTableMock.mock.calls[0] as unknown as [
        unknown,
        { head: string[][]; columnStyles: Record<number, { minCellWidth: number }> },
      ]
    )[1];
    expect(opts.head[0]).toHaveLength(PDF_LIST_MIN_WIDTHS.length);
    PDF_LIST_MIN_WIDTHS.forEach((w, i) => expect(opts.columnStyles[i]!.minCellWidth).toBe(w));
    expect(opts.columnStyles[0]!.minCellWidth).toBeGreaterThanOrEqual(22);
    // alle Mindestbreiten zusammen passen in A4 quer (297 mm - 2 x 14 mm Rand)
    expect(PDF_LIST_MIN_WIDTHS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(269);
  });
});
