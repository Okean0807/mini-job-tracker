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
import { shiftPayroll } from "./payroll";
import { generateAbsence } from "./schedule";
import type { FixedDay, Job, Shift } from "./types";

/**
 * Unbezahlte Abwesenheit darf im Export nicht wie ein bezahlter Arbeitstag aussehen: kein Intervall
 * "08:00–12:00" neben 0 h / 0 €, sondern der Grund. Betrag und Stunden bleiben die der Payroll-Regeln.
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
  startDate: "2026-09-01",
  week: [true, true, true, true, true, false, false].map(day),
} as Job;
const ctxBase = { jobs: [JOB], bundesland: "BE", defaultRate: 15 };
const norm = (v: unknown) => String(v).replace(/\u00a0/g, " ");

// Krankheitsfall 15.09.–30.10.2026: 27.–30.10. = Tag 43 ff. (unbezahlt, "sick-exceeded")
const sick = generateAbsence(JOB, "krank", "2026-09-15", "2026-10-30", "BE");
const oct = sick.filter((s) => s.date.startsWith("2026-10"));
const REASON_EXCEEDED = "6-Wochen-Frist je Krankheitsfall überschritten";

beforeEach(() => {
  vi.clearAllMocks();
  json_to_sheet.mockReturnValue({ "!cols": undefined });
  book_new.mockReturnValue({});
  write.mockReturnValue(new Uint8Array([80, 75]).buffer);
  output.mockReturnValue(new Uint8Array([37, 80, 68, 70]).buffer);
});

const rowsOf = () => (json_to_sheet.mock.calls[0] as unknown as [Record<string, unknown>[]])[0];
const tableOf = () =>
  (autoTableMock.mock.calls[0] as unknown as [unknown, { body: string[][] }])[1].body;

describe("Tag 43+ eines Krankheitsfalls", () => {
  it("Payroll (unverändert): unbezahlt, 0 h, 0 €, Grund sick-exceeded", () => {
    const p = shiftPayroll(
      sick.find((s) => s.date === "2026-10-27")!,
      {
        job: JOB,
        defaultRate: 15,
        history: sick,
      },
    );
    expect([p.paid, p.paidAbsenceHours, p.earnings, p.reason]).toEqual([
      false,
      0,
      0,
      "sick-exceeded",
    ]);
  });

  it("XLSX: kein Intervall, 0 Stunden, 0 €, Grund in der Spalte Vergütung", () => {
    exportXlsx(oct, "t", { ...ctxBase, history: sick });
    for (const date of ["27.10.2026", "28.10.2026", "29.10.2026", "30.10.2026"]) {
      const r = rowsOf().find((row) => String(row["Datum"]).startsWith(date))!;
      expect(r["Beginn"], date).toBe("");
      expect(r["Ende"], date).toBe("");
      expect(r["Gesamtstunden bezahlt"], date).toBe(0);
      expect(r["Bezahlte Abwesenheitsstunden"], date).toBe(0);
      expect(r["Verdienst (€)"], date).toBe(0);
      expect(r["Vergütung"], date).toBe(REASON_EXCEEDED);
    }
  });

  it("XLSX: Tag 42 davor bleibt bezahlt mit Intervall und Grund Lohnfortzahlung", () => {
    exportXlsx(oct, "t", { ...ctxBase, history: sick });
    const r = rowsOf().find((row) => String(row["Datum"]).startsWith("26.10.2026"))!;
    expect(r["Beginn"]).toBe("08:00");
    expect(r["Gesamtstunden bezahlt"]).toBe(4);
    expect(r["Verdienst (€)"]).toBe(60);
    expect(r["Vergütung"]).toBe("Lohnfortzahlung im Krankheitsfall (§ 3 EntgFG)");
  });

  it("PDF: Zeitspalte zeigt den Grund statt 08:00–12:00; Stunden und Betrag 0", () => {
    exportPdf(oct, "t", { ...ctxBase, history: sick });
    const body = tableOf();
    for (const date of ["27.10.2026", "28.10.2026", "29.10.2026", "30.10.2026"]) {
      const row = body.find((r) => String(r[0]).startsWith(date))!;
      expect(norm(row[3]), date).toContain(REASON_EXCEEDED);
      expect(norm(row[3]), date).not.toContain("08:00");
      expect(norm(row[5]), date).toBe("0,00 h");
      expect(norm(row[7]), date).toBe("0,00 €");
    }
    const paid = body.find((r) => String(r[0]).startsWith("26.10.2026"))!;
    expect(norm(paid[3])).toBe("08:00–12:00");
    expect(norm(paid[7])).toBe("60,00 €");
  });
});

describe("Weitere unbezahlte Fälle nennen ihren Grund", () => {
  const frei = {
    id: "f",
    jobId: "J",
    kind: "frei",
    date: "2026-11-03",
    start: "08:00",
    end: "12:00",
    breakMinutes: 0,
  } as Shift;
  const waiting = {
    id: "k",
    jobId: "J",
    kind: "krank",
    date: "2026-09-10", // < 28 Tage nach Beschäftigungsbeginn 01.09.
    start: "08:00",
    end: "12:00",
    breakMinutes: 0,
  } as Shift;
  const offDay = {
    id: "o",
    jobId: "J",
    kind: "krank",
    date: "2026-10-31", // Samstag, kein Plantag
    start: "08:00",
    end: "12:00",
    breakMinutes: 0,
  } as Shift;

  it.each([
    [frei, "Unbezahlte Abwesenheit"],
    [waiting, "Wartezeit von 4 Wochen noch nicht erfüllt"],
    [offDay, "Kein regulärer Arbeitstag"],
  ])("%#: Intervall entfällt, Grund steht im Export", (shift, reason) => {
    exportXlsx([shift], "t", { ...ctxBase, history: [shift] });
    const r = rowsOf()[0]!;
    expect(r["Beginn"]).toBe("");
    expect(r["Gesamtstunden bezahlt"]).toBe(0);
    expect(r["Verdienst (€)"]).toBe(0);
    expect(r["Vergütung"]).toBe(reason);
  });
});

describe("Arbeit bleibt unverändert", () => {
  it("Arbeitsschicht zeigt Intervall, Stunden, Betrag und leeren Vergütungshinweis", () => {
    const w = {
      id: "w",
      jobId: "J",
      kind: "arbeit",
      date: "2026-11-02",
      start: "08:00",
      end: "12:00",
      breakMinutes: 0,
    } as Shift;
    exportXlsx([w], "t", { ...ctxBase, history: [w] });
    const r = rowsOf()[0]!;
    expect([
      r["Beginn"],
      r["Ende"],
      r["Gearbeitete Stunden"],
      r["Verdienst (€)"],
      r["Vergütung"],
    ]).toEqual(["08:00", "12:00", 4, 60, ""]);
  });
});
