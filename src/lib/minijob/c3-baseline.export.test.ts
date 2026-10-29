import { beforeEach, describe, expect, it, vi } from "vitest";

const { write, json_to_sheet, book_new, book_append_sheet, output, autoTableMock } = vi.hoisted(
  () => ({
    write: vi.fn(() => new Uint8Array([80, 75]).buffer),
    json_to_sheet: vi.fn(() => ({ "!cols": undefined as unknown })),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
    output: vi.fn(() => new Uint8Array([37, 80, 68, 70]).buffer),
    autoTableMock: vi.fn(),
  }),
);

vi.mock("xlsx", () => ({
  utils: { json_to_sheet, book_new, book_append_sheet },
  write,
  writeFile: vi.fn(),
}));
vi.mock("jspdf", () => ({
  jsPDF: vi.fn(function (this: unknown) {
    return { setFontSize: vi.fn(), text: vi.fn(), output };
  }),
}));
vi.mock("jspdf-autotable", () => ({ default: autoTableMock }));
vi.mock("./generated-docs", () => ({ saveAndRegisterBytes: vi.fn(() => ({ id: "g" })) }));

import { exportPdf, exportXlsx } from "./export";
import type { FixedDay, Job, Shift } from "./types";

/**
 * C3 Etappe 1 – Referenzverhalten der Listen-Exporte (Stand main 926af09) für Frei / Sonstige OHNE Zusatzfelder:
 * kein Zeitintervall, 0 Stunden, 0 €, Grund "Unbezahlte Abwesenheit"; die Summenzeile ist identisch mit und
 * ohne diese Einträge. Spätere Etappen dürfen das nur mit Freigabe ändern.
 */
const day = (active: boolean): FixedDay => ({
  active,
  start: "08:00",
  end: "12:00",
  breakMinutes: 0,
});
const JOB: Job = {
  id: "F",
  name: "Fest",
  color: "#123456",
  rate: 15,
  mode: "fest",
  employmentType: "minijob",
  startDate: "2025-01-01",
  week: [true, true, true, true, true, false, false].map(day),
} as Job;
const mk = (p: Partial<Shift> & { date: string; kind: Shift["kind"] }): Shift =>
  ({
    id: p.date + p.kind,
    jobId: "F",
    start: "08:00",
    end: "12:00",
    breakMinutes: 0,
    ...p,
  }) as Shift;

const core: Shift[] = [
  mk({ date: "2026-11-02", kind: "arbeit" }),
  mk({ date: "2026-11-06", kind: "urlaub" }),
];
const extra: Shift[] = [
  mk({ date: "2026-11-04", kind: "frei", note: "Brückentag" }),
  mk({ date: "2026-11-05", kind: "sonstige", note: "Schulung" }),
];
const withExtra = [...core, ...extra];
const ctx = (list: Shift[]) => ({ jobs: [JOB], bundesland: "BE", defaultRate: 15, history: list });
const norm = (v: unknown) => String(v).replace(/\u00a0/g, " ");

beforeEach(() => {
  vi.clearAllMocks();
  json_to_sheet.mockReturnValue({ "!cols": undefined });
  book_new.mockReturnValue({});
  write.mockReturnValue(new Uint8Array([80, 75]).buffer);
  output.mockReturnValue(new Uint8Array([37, 80, 68, 70]).buffer);
});

const rowsOf = () => (json_to_sheet.mock.calls[0] as unknown as [Record<string, unknown>[]])[0];
const bodyOf = () =>
  (autoTableMock.mock.calls[0] as unknown as [unknown, { body: string[][]; foot: string[][] }])[1];

describe("XLSX: Frei / Sonstige ohne Zusatzfelder", () => {
  it("Zeilen: kein Intervall, 0 h, 0 €, Grund, Notiz bleibt", () => {
    exportXlsx(withExtra, "t", ctx(withExtra));
    const rows = rowsOf();
    const frei = rows.find((r) => String(r["Datum"]).startsWith("04.11.2026"))!;
    const sonst = rows.find((r) => String(r["Datum"]).startsWith("05.11.2026"))!;
    for (const [row, art, note] of [
      [frei, "Frei", "Brückentag"],
      [sonst, "Sonstige", "Schulung"],
    ] as const) {
      expect(row["Art"]).toBe(art);
      expect(row["Beginn"]).toBe("");
      expect(row["Ende"]).toBe("");
      expect(row["Pause (Min.)"]).toBe("");
      expect(row["Gesamtstunden bezahlt"]).toBe(0);
      expect(row["Gearbeitete Stunden"]).toBe(0);
      expect(row["Bezahlte Abwesenheitsstunden"]).toBe(0);
      expect(row["Verdienst (€)"]).toBe(0);
      expect(row["Vergütung"]).toBe("Unbezahlte Abwesenheit");
      expect(row["Notiz"]).toBe(note);
    }
  });
  it("Summenzeile identisch mit und ohne Frei/Sonstige (4 h gearbeitet, 4 h Urlaub, 120 €)", () => {
    exportXlsx(withExtra, "t", ctx(withExtra));
    const a = rowsOf().at(-1);
    vi.clearAllMocks();
    json_to_sheet.mockReturnValue({ "!cols": undefined });
    exportXlsx(core, "t", ctx(withExtra));
    const b = rowsOf().at(-1);
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      "Gearbeitete Stunden": 4,
      "Bezahlte Abwesenheitsstunden": 4,
      "Gesamtstunden bezahlt": 8,
      "Verdienst (€)": 120,
    });
  });
});

describe("PDF: Frei / Sonstige ohne Zusatzfelder", () => {
  it("Zeitspalte nennt den Grund statt des Intervalls; 0,00 h / 0,00 €; Fußsumme unverändert", () => {
    exportPdf(withExtra, "t", ctx(withExtra));
    const { body, foot } = bodyOf();
    for (const date of ["04.11.2026", "05.11.2026"]) {
      const row = body.find((r) => String(r[0]).startsWith(date))!;
      expect(norm(row[3])).toContain("Unbezahlte Abwesenheit");
      expect(norm(row[3])).not.toContain("08:00");
      expect([norm(row[5]), norm(row[7])]).toEqual(["0,00 h", "0,00 €"]);
    }
    expect([norm(foot[0]![5]), norm(foot[0]![7]), norm(foot[0]![8]), norm(foot[0]![9])]).toEqual([
      "8,00 h",
      "120,00 €",
      "4,00 h",
      "4,00 h",
    ]);
  });
});
